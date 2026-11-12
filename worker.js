/**
 * IronCoach – Cloudflare Worker
 *   • serves the app from ./www
 *   • /api/garmin/*     → Garmin Personal API relay (read)
 *   • /api/intervals/*  → Intervals.icu calendar push (structured workouts → Garmin Connect)
 * Worker → Settings → Variables and Secrets (add all as Secret):
 *   GARMIN_API_KEY, APP_PASSWORD, GARMIN_API_BASE, INTERVALS_API_KEY
 */
const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";
const ICU = "https://intervals.icu/api/v1/athlete/0";
let cached = { token: null, exp: 0 };

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
function safeEqual(a = "", b = "") { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function authed(request, env) {
  const pw = request.headers.get("x-app-password") || new URL(request.url).searchParams.get("pw") || "";
  return env.APP_PASSWORD && safeEqual(pw, env.APP_PASSWORD);
}

/* ---------------- Garmin ---------------- */
function tokenVariants(key) {
  return [
    { name: "plain", headers: { Authorization: `ApiKey ${key}` } },
    { name: "curl-like", headers: { Authorization: `ApiKey ${key}`, Accept: "*/*", "User-Agent": "curl/8.5.0" } },
    { name: "json-accept", headers: { Authorization: `ApiKey ${key}`, Accept: "application/json", "User-Agent": "curl/8.5.0" } },
    { name: "json-body", headers: { Authorization: `ApiKey ${key}`, Accept: "*/*", "Content-Type": "application/json", "User-Agent": "curl/8.5.0" }, body: "{}" },
  ];
}
async function getToken(env, force = false) {
  if (!force && cached.token && Date.now() < cached.exp) return cached.token;
  const key = (env.GARMIN_API_KEY || "").trim(), fails = [];
  for (const v of tokenVariants(key)) {
    const r = await fetch(TOKEN_URL, { method: "POST", headers: v.headers, body: v.body }), text = await r.text();
    if (r.ok) {
      let data; try { data = JSON.parse(text); } catch { data = { access_token: text.trim() }; }
      const token = data.access_token || data.accessToken || data.token;
      if (!token) throw Object.assign(new Error("Token response had no access token"), { status: 502, detail: text.slice(0, 300) });
      cached = { token, exp: Date.now() + Math.max(60, (Number(data.expires_in || data.expiresIn) || 23 * 3600) - 300) * 1000 };
      return token;
    }
    fails.push(`${v.name} → ${r.status}: ${text.slice(0, 150)}`);
    if (r.status === 401 || r.status === 403) break;
  }
  throw Object.assign(new Error(`Garmin token request failed (${fails[0].split(": ")[0].split("→ ")[1]})`), { status: 502, detail: fails.join(" | ") });
}
async function debugToken(env) {
  const key = (env.GARMIN_API_KEY || "").trim(), results = [];
  for (const v of tokenVariants(key)) {
    const r = await fetch(TOKEN_URL, { method: "POST", headers: v.headers, body: v.body }), body = await r.text();
    results.push({ variant: v.name, status: r.status, body: r.ok ? "(token received – hidden)" : body.slice(0, 400) });
    if (r.ok) break;
  }
  return json({ key_length: key.length, key_has_spaces: /\s/.test(env.GARMIN_API_KEY || ""), results });
}
async function garmin(request, env, path) {
  if (request.method !== "GET") return json({ error: "Only GET is allowed" }, 405);
  if (!env.GARMIN_API_KEY || !env.APP_PASSWORD) return json({ error: "Relay not configured: set GARMIN_API_KEY and APP_PASSWORD on the Worker" }, 500);
  if (!authed(request, env)) return json({ error: "Wrong app password" }, 401);
  try {
    if (path === "_debug") return debugToken(env);
    if (path === "_status") { await getToken(env, true); return json({ ok: true, base: env.GARMIN_API_BASE || null }); }
    if (!env.GARMIN_API_BASE) return json({ error: "Set GARMIN_API_BASE on the Worker" }, 500);
    const url = new URL(request.url), base = new URL(env.GARMIN_API_BASE);
    url.searchParams.delete("pw");
    const target = new URL(base.pathname.replace(/\/$/, "") + "/" + path + url.search, base.origin);
    if (target.origin !== base.origin) return json({ error: "Blocked: target outside GARMIN_API_BASE" }, 400);
    const go = t => fetch(target, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } });
    let r = await go(await getToken(env));
    if (r.status === 401) r = await go(await getToken(env, true));
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (e) { return json({ error: e.message, detail: e.detail }, e.status && e.status >= 400 ? e.status : 502); }
}

/* ---------------- Intervals.icu ---------------- */
async function intervals(request, env, path) {
  if (!env.INTERVALS_API_KEY || !env.APP_PASSWORD) return json({ error: "Set INTERVALS_API_KEY (and APP_PASSWORD) on the Worker" }, 500);
  if (!authed(request, env)) return json({ error: "Wrong app password" }, 401);
  const auth = { Authorization: "Basic " + btoa("API_KEY:" + env.INTERVALS_API_KEY.trim()), "Content-Type": "application/json", Accept: "application/json" };
  const fail = async (r, what) => json({ error: `Intervals.icu ${what} failed (HTTP ${r.status})`, detail: (await r.text()).slice(0, 400) }, r.status === 401 || r.status === 403 ? r.status : 502);
  try {
    if (path === "_status" && request.method === "GET") {
      const d = new Date().toISOString().slice(0, 10);
      const r = await fetch(`${ICU}/events?oldest=${d}&newest=${d}`, { headers: auth });
      return r.ok ? json({ ok: true }) : fail(r, "connection test");
    }
    if (path === "sync" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const events = Array.isArray(body.events) ? body.events : [], del = Array.isArray(body.delete) ? body.delete : [];
      if (events.length > 200 || del.length > 400) return json({ error: "Too many events in one request" }, 400);
      if (events.some(e => !String(e.external_id || "").startsWith("ironcoach-")) || del.some(id => !String(id).startsWith("ironcoach-")))
        return json({ error: "Only IronCoach events can be changed" }, 400);
      if (del.length) {
        const r = await fetch(`${ICU}/events/bulk-delete`, { method: "PUT", headers: auth, body: JSON.stringify(del.map(external_id => ({ external_id }))) });
        if (!r.ok) return fail(r, "delete");
      }
      let saved = 0;
      if (events.length) {
        const r = await fetch(`${ICU}/events/bulk?upsert=true`, { method: "POST", headers: auth, body: JSON.stringify(events) });
        if (!r.ok) return fail(r, "upload");
        const out = await r.json().catch(() => []); saved = Array.isArray(out) ? out.length : events.length;
      }
      return json({ ok: true, saved, deleted: del.length });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) { return json({ error: e.message }, 502); }
}

/* ---------------- router ---------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204 });
    if (url.pathname.startsWith("/api/garmin/")) return garmin(request, env, url.pathname.slice(12));
    if (url.pathname.startsWith("/api/intervals/")) return intervals(request, env, url.pathname.slice(15));
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    const res = await env.ASSETS.fetch(request);
    if (/\/(sw\.js|index\.html)?$/.test(url.pathname)) {
      const h = new Headers(res.headers); h.set("cache-control", "no-cache");
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
