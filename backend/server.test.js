import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, pcmToWav } from "./server.js";

async function setup(t, options = {}) {
  const calls = [];
  const app = createApp({
    store: options.store,
    env: {
      GEMINI_API_KEY: "test-secret",
      RATE_LIMIT_PER_MINUTE: "100",
      ...options.env,
    },
    fetchImpl:
      options.fetchImpl ||
      (async (url, request) => {
        calls.push({ url, request });
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      translation: "Hola",
                      detectedSource: "en",
                      text: "Hello",
                    }),
                  },
                ],
              },
            },
          ],
        });
      }),
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        app.close(resolve);
        app.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${app.address().port}`;
  const post = (path, data, headers = {}) =>
    fetch(url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof data === "string" ? data : JSON.stringify(data),
    });
  return { url, post, calls };
}
const input = { text: "Hello", source: "en", target: "es" };
test("serves frontend with security headers; never exposes secrets or source", async (t) => {
  const { url } = await setup(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(await page.text(), /savedList/);
  for (const path of ["/backend/.env", "/.env", "/server.js", "/api/unknown"])
    assert.equal((await fetch(url + path)).status, 404);
  assert.equal((await fetch(url + "/Union.png")).status, 200);
});
test("translation contract and server-side provider key", async (t) => {
  const { post, calls } = await setup(t);
  const response = await post("/api/translate", input);
  assert.deepEqual(await response.json(), {
    translation: "Hola",
    detectedSource: "en",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.headers["x-goog-api-key"], "test-secret");
  assert.match(calls[0].url, /gemini-3.5-flash-lite/);
});
test("same language skips model", async (t) => {
  const { post, calls } = await setup(t);
  assert.deepEqual(
    await (await post("/api/translate", { ...input, target: "en" })).json(),
    { translation: "Hello", detectedSource: "en" },
  );
  assert.equal(calls.length, 0);
});
test("validates text, language, JSON, content type, and body size", async (t) => {
  const { post } = await setup(t);
  for (const data of [
    { ...input, text: "" },
    { ...input, text: "x".repeat(5001) },
    { ...input, target: "auto" },
    { ...input, source: "__proto__" },
    "null",
    "{",
  ])
    assert.equal((await post("/api/translate", data)).status, 400);
  assert.equal(
    (await post("/api/translate", input, { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.equal(
    (await post("/api/translate", { ...input, text: "x".repeat(33000) }))
      .status,
    413,
  );
});
test("rejects foreign origins and wrong methods", async (t) => {
  const { post, url, calls } = await setup(t);
  assert.equal(
    (await post("/api/translate", input, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal((await fetch(url + "/api/translate")).status, 405);
  assert.equal(calls.length, 0);
});
test("missing key is actionable", async (t) => {
  const { post } = await setup(t, { env: { GEMINI_API_KEY: "" } });
  const response = await post("/api/translate", input);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /backend\/\.env/);
});
test("throttles per IP and global daily model budget", async (t) => {
  const a = await setup(t, { env: { RATE_LIMIT_PER_MINUTE: "1" } });
  await a.post("/api/translate", input);
  const limited = await a.post("/api/translate", input);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  const b = await setup(t, { env: { DAILY_REQUEST_LIMIT: "1" } });
  await b.post("/api/translate", input);
  assert.equal((await b.post("/api/translate", input)).status, 429);
});
test("handles provider failure and malformed responses without leaking details", async (t) => {
  for (const response of [
    new Response("secret", { status: 401 }),
    Response.json({ candidates: [] }),
    Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
    Response.json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "bad-json" }] } },
      ],
    }),
  ]) {
    const { post } = await setup(t, { fetchImpl: async () => response });
    const result = await post("/api/translate", input);
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /secret/);
  }
});
test("transcribes multipart audio and rejects invalid formats", async (t) => {
  const { url, calls } = await setup(t);
  const form = new FormData();
  form.append(
    "audio",
    new Blob(["audio fixture"], { type: "audio/webm" }),
    "test.webm",
  );
  form.append("source", "en");
  const response = await fetch(url + "/api/transcribe", {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Hello");
  assert.equal(
    JSON.parse(calls[0].request.body).contents[0].parts[0].inlineData.mimeType,
    "audio/webm",
  );
  const bad = new FormData();
  bad.append("audio", new Blob(["bad"], { type: "text/html" }), "bad.html");
  assert.equal(
    (await fetch(url + "/api/transcribe", { method: "POST", body: bad }))
      .status,
    415,
  );
});
test("speech produces WAV and reports unsupported languages", async (t) => {
  const { post } = await setup(t, {
    fetchImpl: async () =>
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/L16;codec=pcm;rate=24000",
                    data: Buffer.alloc(4).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
  });
  const response = await post("/api/speak", { text: "Hello", lang: "en" });
  assert.equal(response.headers.get("content-type"), "audio/wav");
  const wav = Buffer.from(await response.arrayBuffer());
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.length, 48);
  assert.equal(
    (await post("/api/speak", { text: "Hello", lang: "ig" })).status,
    422,
  );
  assert.equal(pcmToWav(Buffer.alloc(2)).readUInt32LE(24), 24000);
});

test("saved translation routes isolate owners, validate requests and hide database errors", async (t) => {
  const records = new Map();
  const store = {
    list: async (owner) => records.get(owner) || [],
    save: async (owner, item) => {
      const row = { ...item, id: "00000000-0000-4000-8000-000000000001" };
      records.set(owner, [row]);
      return row;
    },
    remove: async (owner, id) => {
      const rows = records.get(owner) || [];
      if (!rows.some((r) => r.id === id)) return false;
      records.set(owner, []);
      return true;
    },
  };
  const { url, post } = await setup(t, { store });
  const first = await fetch(url + "/api/saved-translations");
  const cookie = first.headers.get("set-cookie").split(";")[0];
  assert.match(first.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.deepEqual(await first.json(), { items: [] });
  const data = { ...input, translation: "Hola" };
  assert.equal((await post("/api/saved-translations", data)).status, 401);
  assert.equal(
    (
      await post(
        "/api/saved-translations",
        { ...data, target: "bad" },
        { Cookie: cookie },
      )
    ).status,
    400,
  );
  const save = await post("/api/saved-translations", data, { Cookie: cookie });
  assert.equal(save.status, 201);
  const row = await save.json();
  assert.equal(
    (
      await (
        await fetch(url + "/api/saved-translations", {
          headers: { Cookie: cookie },
        })
      ).json()
    ).items.length,
    1,
  );
  const other = await fetch(url + "/api/saved-translations");
  const otherCookie = other.headers.get("set-cookie").split(";")[0];
  assert.deepEqual(await other.json(), { items: [] });
  assert.equal(
    (
      await fetch(url + "/api/saved-translations/" + row.id, {
        method: "DELETE",
        headers: { Cookie: otherCookie },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(url + "/api/saved-translations/" + row.id, {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/saved-translations/" + row.id, {
        method: "DELETE",
        headers: { Cookie: cookie },
      })
    ).status,
    200,
  );
  store.list = async () => {
    throw new Error("secret-password");
  };
  const failure = await fetch(url + "/api/saved-translations");
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /secret-password/);
});
test("database not configured returns actionable error", async (t) => {
  const { url } = await setup(t);
  const response = await fetch(url + "/api/saved-translations");
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /DATABASE_URL/);
});
