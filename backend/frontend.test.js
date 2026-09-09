import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const code = await readFile(
  new URL("../frontend/script.js", import.meta.url),
  "utf8",
);
function boot() {
  const elements = new Map(),
    requests = [],
    storage = new Map();
  const element = () => ({
    value: "",
    textContent: "",
    children: [],
    disabled: false,
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    focus() {},
    add(value) {
      this.children.push(value);
    },
    append(...values) {
      this.children.push(...values);
    },
    replaceChildren() {
      this.children = [];
    },
  });
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  get("sourceLang").value = "en";
  get("targetLang").value = "es";
  get("sourceText").value = "Hello";
  vm.runInNewContext(code, {
    document: { getElementById: get, createElement: element },
    window: { addEventListener() {} },
    navigator: {},
    Option: function (label, value) {
      this.value = value;
      this.textContent = label;
    },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout: () => 1,
    clearTimeout() {},
    AbortController,
    AbortSignal,
    URL,
    fetch: (url, options) => {
      if (url.endsWith("health"))
        return Promise.resolve(Response.json({ configured: true }));
      if (url.includes("saved-translations")) {
        if (options.method === "POST")
          storage.set("saved", [
            { ...JSON.parse(options.body), id: "test-id" },
          ]);
        if (options.method === "DELETE") storage.set("saved", []);
        return Promise.resolve(
          Response.json({ items: storage.get("saved") || [] }),
        );
      }
      return new Promise((resolve) => requests.push({ resolve, options }));
    },
  });
  return { get, requests, storage };
}
test("frontend discards responses after clear and after input changes", async () => {
  const { get, requests } = boot();
  const pending = get("translateBtn").onclick();
  get("clearBtn").onclick();
  requests[0].resolve(
    Response.json({ translation: "Stale", detectedSource: "en" }),
  );
  await pending;
  assert.equal(get("sourceText").value, "");
  assert.equal(
    get("resultText").textContent,
    "Your translation will appear here.",
  );
  assert.equal(get("saveBtn").disabled, true);
  get("sourceText").value = "First";
  const second = get("translateBtn").onclick();
  get("sourceText").value = "Second";
  get("sourceText").oninput();
  requests[1].resolve(Response.json({ translation: "Old" }));
  await second;
  assert.equal(
    get("resultText").textContent,
    "Your translation will appear here.",
  );
});
test("frontend renders literal model text and saves, loads, deletes, and swaps", async () => {
  const { get, requests, storage } = boot();
  assert.equal(get("sourceLang").children.length, 11);
  assert.equal(get("targetLang").children.length, 10);
  const pending = get("translateBtn").onclick();
  requests[0].resolve(
    Response.json({ translation: "<b>Hola</b>", detectedSource: "en" }),
  );
  await pending;
  assert.equal(get("resultText").textContent, "<b>Hola</b>");
  await get("saveBtn").onclick();
  assert.equal(storage.get("saved").length, 1);
  get("clearBtn").onclick();
  get("savedList").children[0].children[1].onclick();
  assert.equal(get("sourceText").value, "Hello");
  get("swapLangs").onclick();
  assert.equal(get("sourceLang").value, "es");
  assert.equal(get("targetLang").value, "en");
  assert.equal(get("sourceText").value, "<b>Hola</b>");
  await get("savedList").children[0].children[2].onclick();
  assert.equal(storage.get("saved").length, 0);
});
