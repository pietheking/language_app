// One-time local setup: DATABASE_URL initially points at an administrator database.
// Creates a separate database/login, then replaces only DATABASE_URL in .env.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const envPath = new URL("./.env", import.meta.url);
const admin = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  if (!process.env.DATABASE_URL) throw new Error("missing");
  await admin.connect();
  const suffix = randomBytes(4).toString("hex");
  const name = "language_app_" + suffix;
  const role = "translator_" + suffix;
  const password = randomBytes(32).toString("hex");
  // Identifiers and password below are generated hex, never user-provided SQL.
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  await admin.query(`CREATE DATABASE ${name} OWNER ${role}`);
  const url = new URL(process.env.DATABASE_URL);
  url.username = role;
  url.password = password;
  url.pathname = "/" + name;
  const content = await readFile(envPath, "utf8");
  await writeFile(
    envPath,
    content.replace(/^DATABASE_URL=.*$/m, "DATABASE_URL=" + url.toString()),
  );
  console.log(
    "Created isolated PostgreSQL database " +
      name +
      " and saved its dedicated login in backend/.env.",
  );
} catch (error) {
  console.error(
    "Local setup failed. PostgreSQL error code: " +
      (error.code || "CONFIGURATION") +
      ". Check DATABASE_URL and administrator permissions.",
  );
  process.exitCode = 1;
} finally {
  await admin.end();
}
