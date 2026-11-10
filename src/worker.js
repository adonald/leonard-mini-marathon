// Cloudflare Worker entry point.
// The page in public/ is served as static assets; /api/progress is handled here.
import { onRequestGet, onRequestPost } from "../functions/api/progress.js";
import { onRequestGet as sponsorshipGet } from "../functions/api/sponsorship.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/progress") {
      if (request.method === "GET") return onRequestGet({ request, env });
      if (request.method === "POST") return onRequestPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
    }
    if (url.pathname === "/api/sponsorship") {
      if (request.method === "GET") return sponsorshipGet({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
    }
    return env.ASSETS.fetch(request);
  },
};
