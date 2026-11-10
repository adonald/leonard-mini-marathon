import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/progress.js";

function fakeKV() {
  const data = new Map();
  return {
    data,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async put(k, v) { data.set(k, v); },
    async delete(k) { data.delete(k); },
  };
}

const ORIGIN = "https://leonard.example";
function post(body, { ip = "1.2.3.4", origin = ORIGIN } = {}) {
  const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
  if (origin) headers.origin = origin;
  return new Request(`${ORIGIN}/api/progress`, { method: "POST", headers, body: JSON.stringify(body) });
}

function setup() {
  return { MILES: fakeKV(), LOG_PASSCODE: "rocket-legs-42" };
}

const today = new Date().toISOString().slice(0, 10);

test("anyone can read progress, starting at zero", async () => {
  const env = setup();
  const res = await onRequestGet({ env });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: 26.2, done: 0, finished: false, miles: [] });
});

test("wrong passcode is rejected and nothing is saved", async () => {
  const env = setup();
  const res = await onRequestPost({ request: post({ passcode: "nope", action: "add" }), env });
  assert.equal(res.status, 401);
  assert.equal(await env.MILES.get("miles"), null);
});

test("missing passcode is rejected", async () => {
  const env = setup();
  const res = await onRequestPost({ request: post({ action: "add" }), env });
  assert.equal(res.status, 401);
});

test("five wrong guesses lock the device out, even with the right passcode", async () => {
  const env = setup();
  for (let i = 0; i < 5; i++) {
    const r = await onRequestPost({ request: post({ passcode: "guess" + i }), env });
    assert.equal(r.status, 401);
  }
  const res = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE }), env });
  assert.equal(res.status, 429);
  // A different device is unaffected.
  const other = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "check" }, { ip: "5.6.7.8" }), env });
  assert.equal(other.status, 200);
});

test("requests from another website are refused", async () => {
  const env = setup();
  const res = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE }, { origin: "https://evil.example" }), env });
  assert.equal(res.status, 403);
});

test("Leonard logs miles, the last one is 0.2, then it's finished", async () => {
  const env = setup();
  let data;
  for (let i = 0; i < 27; i++) {
    const res = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "add", date: today, note: i === 0 ? "  First one!\n" : "" }), env });
    assert.equal(res.status, 200);
    data = await res.json();
  }
  assert.equal(data.done, 26.2);
  assert.equal(data.finished, true);
  assert.equal(data.miles.length, 27);
  assert.equal(data.miles[0].note, "First one!");
  assert.equal(data.miles[26].distance, 0.2);

  const extra = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "add" }), env });
  assert.equal(extra.status, 400);
});

test("undo removes the last mile", async () => {
  const env = setup();
  await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "add", date: today }), env });
  await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "add", date: today }), env });
  const res = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "undo" }), env });
  const data = await res.json();
  assert.equal(data.done, 1);
});

test("future and nonsense dates are rejected; long notes are trimmed", async () => {
  const env = setup();
  for (const date of ["2099-01-01", "2026-02-30", "yesterday"]) {
    const res = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "add", date }), env });
    assert.equal(res.status, 400, date);
  }
  const res = await onRequestPost({ request: post({ passcode: env.LOG_PASSCODE, action: "add", date: today, note: "x".repeat(500) }), env });
  assert.equal((await res.json()).miles[0].note.length, 140);
});
