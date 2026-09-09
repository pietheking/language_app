// Opt-in real PostgreSQL test. It uses random owners and removes only its own rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createStore } from "./database.js";
test(
  "PostgreSQL persistence, duplicate saves and owner isolation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const env = { DATABASE_URL: process.env.TEST_DATABASE_URL };
    let store = createStore(env);
    const owner = randomBytes(32).toString("hex");
    const other = randomBytes(32).toString("hex");
    try {
      await store.migrate();
      const input = {
        text: "Hello '; DROP TABLE saved_translations; --",
        source: "en",
        target: "es",
        translation: "Hola",
        detectedSource: "en",
      };
      const first = await store.save(owner, input);
      const updated = await store.save(owner, {
        ...input,
        translation: "Buenos días",
      });
      assert.equal(first.id, updated.id);
      assert.equal((await store.list(owner)).length, 1);
      assert.equal((await store.list(other)).length, 0);
      assert.equal(await store.remove(other, first.id), false);
      await store.close();
      store = createStore(env);
      assert.equal((await store.list(owner))[0].translation, "Buenos días");
      assert.equal(await store.remove(owner, first.id), true);
      assert.deepEqual(await store.list(owner), []);
    } finally {
      for (const row of await store.list(owner))
        await store.remove(owner, row.id);
      await store.close();
    }
  },
);
