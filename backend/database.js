// PostgreSQL stores saved content; a random browser cookie identifies its owner.
// Every query scopes by owner_hash. SQL parameters keep user text out of SQL syntax.
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export function createStore(env = process.env) {
  if (!env.DATABASE_URL?.trim()) return null;
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
  pool.on("error", () => console.error("PostgreSQL connection interrupted."));
  const fields =
    'id, text, source, target, translation, detected_source AS "detectedSource", saved_at AS "savedAt"';
  return {
    async migrate() {
      await pool.query(
        await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
      );
    },
    async list(owner) {
      return (
        await pool.query(
          `SELECT ${fields} FROM saved_translations WHERE owner_hash=$1 ORDER BY saved_at DESC, id DESC LIMIT 100`,
          [owner],
        )
      ).rows;
    },
    async save(owner, item) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize writes for this owner, including writes from other server processes.
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          BigInt("0x" + owner.slice(0, 15)).toString(),
        ]);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([item.text, item.source, item.target]))
          .digest("hex");
        const saved = await client.query(
          `INSERT INTO saved_translations
          (id, owner_hash, fingerprint, text, source, target, translation, detected_source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (owner_hash, fingerprint) DO UPDATE SET translation=EXCLUDED.translation,
          detected_source=EXCLUDED.detected_source, saved_at=now() RETURNING ${fields}`,
          [
            randomUUID(),
            owner,
            fingerprint,
            item.text,
            item.source,
            item.target,
            item.translation,
            item.detectedSource,
          ],
        );
        await client.query(
          `DELETE FROM saved_translations WHERE owner_hash=$1 AND id IN
          (SELECT id FROM saved_translations WHERE owner_hash=$1 ORDER BY saved_at DESC, id DESC OFFSET 100)`,
          [owner],
        );
        await client.query("COMMIT");
        return saved.rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async remove(owner, id) {
      return (
        (
          await pool.query(
            "DELETE FROM saved_translations WHERE owner_hash=$1 AND id=$2",
            [owner, id],
          )
        ).rowCount > 0
      );
    },
    close: () => pool.end(),
  };
}
