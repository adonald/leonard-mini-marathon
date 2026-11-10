// Cloudflare Pages Function: /api/progress
//
//   GET  /api/progress   -> anyone can read Leonard's progress
//   POST /api/progress   -> Leonard logs a mile (or undoes one) with his secret passcode
//
// Needs two things set up in the Cloudflare dashboard (see README):
//   MILES         a KV namespace binding where the miles are stored
//   LOG_PASSCODE  a secret (encrypted environment variable) holding Leonard's passcode

export const TOTAL_MILES = 26.2;
const DATA_KEY = "miles";
const MAX_NOTE_LENGTH = 140;
const MAX_FAILED_TRIES = 5;
const LOCKOUT_SECONDS = 15 * 60;

const round1 = (n) => Math.round(n * 10) / 10;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function loadMiles(env) {
  const raw = await env.MILES.get(DATA_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summary(miles) {
  const done = round1(miles.reduce((sum, m) => sum + m.distance, 0));
  return { total: TOTAL_MILES, done, finished: done >= TOTAL_MILES, miles };
}

// Compare passcodes without leaking how many characters matched (timing-safe).
async function passcodeMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  // Allow "tomorrow" in UTC so time zones ahead of UTC still work; nothing silly far away.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return value >= "2020-01-01" && value <= tomorrow;
}

function cleanNote(value) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  // Strip control characters, squash whitespace, trim to length.
  const note = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return note.slice(0, MAX_NOTE_LENGTH);
}

export async function onRequestGet({ env }) {
  return json(summary(await loadMiles(env)));
}

export async function onRequestPost({ request, env }) {
  if (!env.MILES || !env.LOG_PASSCODE) {
    return json({ error: "The site isn't fully set up yet (missing MILES or LOG_PASSCODE)." }, 500);
  }

  // Only accept JSON from our own page.
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) return json({ error: "Expected JSON." }, 415);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Wrong website." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "That didn't look right. Try again?" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "That didn't look right." }, 400);

  // Slow down passcode guessing: 5 wrong tries locks this device out for 15 minutes.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const failKey = `fail:${ip}`;
  const fails = parseInt((await env.MILES.get(failKey)) || "0", 10);
  if (fails >= MAX_FAILED_TRIES) {
    return json({ error: "Too many wrong passcodes. Take a 15 minute water break, then try again!" }, 429);
  }

  if (!(await passcodeMatches(body.passcode, env.LOG_PASSCODE))) {
    await env.MILES.put(failKey, String(fails + 1), { expirationTtl: LOCKOUT_SECONDS });
    const left = MAX_FAILED_TRIES - fails - 1;
    return json(
      { error: left > 0 ? `Oops, wrong passcode! ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong passcode. Locked for 15 minutes." },
      401,
    );
  }
  if (fails > 0) await env.MILES.delete(failKey);

  const miles = await loadMiles(env);
  const action = body.action || "add";

  if (action === "check") {
    return json({ ok: true, ...summary(miles) });
  }

  if (action === "undo") {
    if (miles.length === 0) return json({ error: "There are no miles to undo yet." }, 400);
    miles.pop();
    await env.MILES.put(DATA_KEY, JSON.stringify(miles));
    return json({ ok: true, ...summary(miles) });
  }

  if (action !== "add") return json({ error: "Unknown action." }, 400);

  const done = summary(miles).done;
  if (done >= TOTAL_MILES) return json({ error: "You've already finished the whole marathon! 🎉" }, 400);

  const date = body.date || todayISO();
  if (!validDate(date)) return json({ error: "Please pick a real date (not in the future)." }, 400);
  const note = cleanNote(body.note);
  if (note === null) return json({ error: "That note didn't look right." }, 400);

  // Every run is one mile, except the very last little bit (0.2 miles).
  const distance = round1(Math.min(1, TOTAL_MILES - done));
  miles.push({ distance, date, note, loggedAt: new Date().toISOString() });
  await env.MILES.put(DATA_KEY, JSON.stringify(miles));
  return json({ ok: true, ...summary(miles) });
}
