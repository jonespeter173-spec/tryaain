/**
 * IronCoach – Garmin Personal API relay (Cloudflare Pages Function)
 * Route: /api/garmin/*  (same site as the app → no browser CORS problems)
 *
 * Cloudflare → Pages project → Settings → Variables and Secrets:
 *   GARMIN_API_KEY   (Secret) your Garmin Connect Personal API key
 *   APP_PASSWORD     (Secret) any long password; the app sends it in x-app-password
 *   GARMIN_API_BASE  (Text)   base URL of the Garmin data API from Garmin's Swagger docs
 *
 *   GET /api/garmin/_status          → checks password + gets a Garmin token (no data)
 *   GET /api/garmin/<path>?<query>   → forwarded to GARMIN_API_BASE/<path>?<query>
 */
const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";
let cached = { token: null, exp: 0 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
function safeEqual(a = "", b = "") { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function getToken(env, force = false) {
  if (!force && cached.token && Date.now() < cached.exp) return cached.token;
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { Authorization: `ApiKey ${env.GARMIN_API_KEY}`, Accept: "application/json" } });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Garmin token request failed (${r.status})`), { status: r.status, detail: text.slice(0, 300) });
  let data; try { data = JSON.parse(text); } catch { data = { access_token: text.trim() }; }
  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw Object.assign(new Error("Token response had no access token"), { status: 502, detail: Object.keys(data).join(",") });
  const life = Number(data.expires_in || data.expiresIn) || 23 * 3600;
  cached = { token, exp: Date.now() + Math.max(60, life - 300) * 1000 };
  return token;
}

export async function onRequest({ request, env, params }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "GET") return json({ error: "Only GET is allowed" }, 405);
  if (!env.GARMIN_API_KEY || !env.APP_PASSWORD) return json({ error: "Relay not configured: set GARMIN_API_KEY and APP_PASSWORD in Cloudflare, then redeploy" }, 500);
  if (!safeEqual(request.headers.get("x-app-password") || "", env.APP_PASSWORD)) return json({ error: "Wrong app password" }, 401);
  const path = [].concat(params.path || []).join("/");
  try {
    if (path === "_status") { await getToken(env, true); return json({ ok: true, base: env.GARMIN_API_BASE || null }); }
    if (!env.GARMIN_API_BASE) return json({ error: "Set GARMIN_API_BASE in Cloudflare, then redeploy" }, 500);
    const base = new URL(env.GARMIN_API_BASE);
    const target = new URL(base.pathname.replace(/\/$/, "") + "/" + path + new URL(request.url).search, base.origin);
    if (target.origin !== base.origin) return json({ error: "Blocked: target outside GARMIN_API_BASE" }, 400);
    const go = t => fetch(target, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } });
    let r = await go(await getToken(env));
    if (r.status === 401) r = await go(await getToken(env, true));
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (e) { return json({ error: e.message, detail: e.detail }, e.status && e.status >= 400 ? e.status : 502); }
}
