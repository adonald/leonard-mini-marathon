// GET /api/sponsorship -> how much Leonard has raised, read from his runPudsey page.
//
// The total is fetched from the fundraising page on the server and cached in KV
// for 15 minutes, so family visits don't hammer the runPudsey site. If the page
// can't be read, the last good total is returned instead.

export const SPONSOR_URL = "https://www.runpudsey.co.uk/page/leonards-mini-marathon";
const CACHE_KEY = "sponsorship";
const FRESH_MS = 15 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

// Pull "£62.60 raised so far by 3 supporters" out of the page.
export function parseTotal(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;|&#163;|&#xa3;/gi, "£")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ");
  const m = text.match(/£\s*([\d,]+(?:\.\d{1,2})?)\s*raised(?: so far)?(?: by (\d[\d,]*) (?:supporters?|sponsors?|donors?))?/i);
  if (!m) return null;
  const raised = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(raised)) return null;
  const supporters = m[2] ? Number(m[2].replace(/,/g, "")) : null;
  return { raised, supporters };
}

async function fetchTotal() {
  const res = await fetch(SPONSOR_URL, {
    headers: { "user-agent": "LeonardMiniMarathon/1.0 (family progress page)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`runPudsey returned ${res.status}`);
  const parsed = parseTotal(await res.text());
  if (!parsed) throw new Error("Couldn't find the total on the page");
  return parsed;
}

export async function onRequestGet({ env, fetchTotalImpl = fetchTotal }) {
  let cached = null;
  try {
    cached = JSON.parse((await env.MILES.get(CACHE_KEY)) || "null");
  } catch {}

  if (cached && Date.now() - Date.parse(cached.checkedAt) < FRESH_MS) {
    return json({ ...cached, url: SPONSOR_URL });
  }

  try {
    const fresh = { ...(await fetchTotalImpl()), checkedAt: new Date().toISOString() };
    await env.MILES.put(CACHE_KEY, JSON.stringify(fresh));
    return json({ ...fresh, url: SPONSOR_URL });
  } catch {
    // Show the last total we knew about, or just the link if we never got one.
    return json({ ...(cached || { raised: null, supporters: null }), stale: true, url: SPONSOR_URL });
  }
}
