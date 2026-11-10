/**
 * IronCoach – Cloudflare Worker: serves the app from ./www and relays Garmin at /api/garmin/*
 * Worker → Settings → Variables and Secrets (all as Secret):
 *   GARMIN_API_KEY, APP_PASSWORD, GARMIN_API_BASE
 */
const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";
let cached = { token: null, exp: 0 };

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function safeEqual(a = "", b = "") {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* Header combinations to try when asking Garmin for a token */
function tokenVariants(key) {
  return [
    { name: "plain",        headers: { Authorization: `ApiKey ${key}` } },
    { name: "curl-like",    headers: { Authorization: `ApiKey ${key}`, Accept: "*/*", "User-Agent": "curl/8.5.0" } },
    { name: "json-accept",  headers: { Authorization: `ApiKey ${key}`, Accept: "application/json", "User-Agent": "curl/8.5.0" } },
    { name: "json-body",    headers: { Authorization: `ApiKey ${key}`, Accept: "*/*", "Content-Type": "application/json", "User-Agent": "curl/8.5.0" }, body: "{}" },
  ];
}

async function getToken(env, force = false) {
  if (!force && cached.token && Date.now() < cached.exp) return cached.token;
  const key = (env.GARMIN_API_KEY || "").trim();
  const fails = [];
  for (const v of tokenVariants(key)) {
    const r = await fetch(TOKEN_URL, { method: "POST", headers: v.headers, body: v.body });
    const text = await r.text();
    if (r.ok) {
      let data; try { data = JSON.parse(text); } catch { data = { access_token: text.trim() }; }
      const token = data.access_token || data.accessToken || data.token;
      if (!token) throw Object.assign(new Error("Token response had no access token"), { status: 502, detail: text.slice(0, 300) });
      const life = Number(data.expires_in || data.expiresIn) || 23 * 3600;
      cached = { token, exp: Date.now() + Math.max(60, life - 300) * 1000 };
      return token;
    }
    fails.push(`${v.name} → ${r.status}: ${text.slice(0, 150)}`);
    if (r.status === 401 || r.status === 403) break;   // key problem – stop retrying
  }
  throw Object.assign(new Error(`Garmin token request failed (${fails[0].split(": ")[0].split("→ ")[1]})`), { status: 502, detail: fails.join(" | ") });
}

/* Diagnostic: shows Garmin's full reply to each header combination */
async function debugToken(env) {
  const key = (env.GARMIN_API_KEY || "").trim();
  const results = [];
  for (const v of tokenVariants(key)) {
    const r = await fetch(TOKEN_URL, { method: "POST", headers: v.headers, body: v.body });
    const body = await r.text();
    results.push({ variant: v.name, status: r.status, headers: Object.fromEntries(r.headers),
      body: r.ok ? "(token received – hidden)" : body.slice(0, 400) });
    if (r.ok) break;
  }
  return json({ key_length: key.length, key_has_spaces: /\s/.test(env.GARMIN_API_KEY || ""), results });
}

async function garmin(request, env, path) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "GET") return json({ error: "Only GET is allowed" }, 405);
  if (!env.GARMIN_API_KEY || !env.APP_PASSWORD) return json({ error: "Relay not configured: set GARMIN_API_KEY and APP_PASSWORD on the Worker" }, 500);
  const url = new URL(request.url);
  const pw = request.headers.get("x-app-password") || url.searchParams.get("pw") || "";
  if (!safeEqual(pw, env.APP_PASSWORD)) return json({ error: "Wrong app password" }, 401);
  try {
    if (path === "_debug") return debugToken(env);
    if (path === "_status") { await getToken(env, true); return json({ ok: true, base: env.GARMIN_API_BASE || null }); }
    if (!env.GARMIN_API_BASE) return json({ error: "Set GARMIN_API_BASE on the Worker" }, 500);
    const base = new URL(env.GARMIN_API_BASE);
    url.searchParams.delete("pw");
    const target = new URL(base.pathname.replace(/\/$/, "") + "/" + path + url.search, base.origin);
    if (target.origin !== base.origin) return json({ error: "Blocked: target outside GARMIN_API_BASE" }, 400);
    const go = t => fetch(target, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } });
    let r = await go(await getToken(env));
    if (r.status === 401) r = await go(await getToken(env, true));
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return json({ error: e.message, detail: e.detail }, e.status && e.status >= 400 ? e.status : 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/garmin/")) return garmin(request, env, url.pathname.slice("/api/garmin/".length));
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    const res = await env.ASSETS.fetch(request);
    if (/\/(sw\.js|index\.html)?$/.test(url.pathname)) {
      const h = new Headers(res.headers); h.set("cache-control", "no-cache");
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
