import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTotal, onRequestGet } from "../functions/api/sponsorship.js";

function fakeKV() {
  const data = new Map();
  return { data, async get(k) { return data.get(k) ?? null; }, async put(k, v) { data.set(k, v); } };
}

test("reads the total from the fundraising page, whatever the markup", () => {
  assert.deepEqual(parseTotal("<div><span class='amt'>£62.60</span>\n <p>raised so far by 3 supporters</p></div>"), { raised: 62.6, supporters: 3 });
  assert.deepEqual(parseTotal("<h2>&pound;1,250</h2> raised so far by 1 supporter"), { raised: 1250, supporters: 1 });
  assert.deepEqual(parseTotal("<b>£40</b> raised"), { raised: 40, supporters: null });
  assert.equal(parseTotal("<p>I would like to raise £25</p>"), null);
  assert.equal(parseTotal("<html>Page not found</html>"), null);
});

test("fetches once, then serves the cached total", async () => {
  const env = { MILES: fakeKV() };
  let calls = 0;
  const fetchTotalImpl = async () => { calls++; return { raised: 62.6, supporters: 3 }; };
  const first = await (await onRequestGet({ env, fetchTotalImpl })).json();
  const second = await (await onRequestGet({ env, fetchTotalImpl })).json();
  assert.equal(first.raised, 62.6);
  assert.equal(second.supporters, 3);
  assert.equal(calls, 1);
  assert.match(first.url, /runpudsey/);
});

test("if the page can't be read, the last known total is shown", async () => {
  const env = { MILES: fakeKV() };
  env.MILES.data.set("sponsorship", JSON.stringify({ raised: 50, supporters: 2, checkedAt: "2020-01-01T00:00:00Z" }));
  const data = await (await onRequestGet({ env, fetchTotalImpl: async () => { throw new Error("down"); } })).json();
  assert.equal(data.raised, 50);
  assert.equal(data.stale, true);
});

test("with no total ever fetched, it still returns the sponsor link", async () => {
  const env = { MILES: fakeKV() };
  const data = await (await onRequestGet({ env, fetchTotalImpl: async () => { throw new Error("down"); } })).json();
  assert.equal(data.raised, null);
  assert.match(data.url, /runpudsey/);
});
