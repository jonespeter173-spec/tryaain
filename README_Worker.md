# IronCoach on Cloudflare Workers (iron5.jonespeter173.workers.dev)

Your site is a **Worker**. Workers don't run the `functions/` folder (that only works on Cloudflare Pages).
These two files make the Worker serve the app **and** run the Garmin relay.

## 1. Add the files to your GitHub repo (top level, next to `www/`)
```
src/worker.js      ← NEW
wrangler.jsonc     ← NEW  ("name" is set to iron5 — must match your Worker name)
www/               ← the IronCoach v1.2 app (index.html must say app.js?v=1.2)
functions/         ← can stay or be deleted; Workers ignore it
```
If the repo already has a `wrangler.toml` or `wrangler.json`, delete it so only `wrangler.jsonc` remains.
Check `www/index.html` on GitHub: it must contain `app.js?v=1.2`. If not, upload the v1.2 `www` contents again.

## 2. Check the Worker build settings
Go to dash.cloudflare.com → **Workers & Pages → iron5 → Settings → Build**:
- **Deploy command:** `npx wrangler deploy`
- **Build command:** *(empty)*
- **Root directory:** `/`

Commit to GitHub. The Worker redeploys automatically. Check **Deployments** shows **Success**.

## 3. Add the Garmin settings
Go to **iron5 → Settings → Variables and Secrets → Add**:

| Name | Type | Value |
|---|---|---|
| `GARMIN_API_KEY` | Secret | your Garmin Personal API key |
| `APP_PASSWORD` | Secret | a long password you make up |
| `GARMIN_API_BASE` | Text | the base URL from Garmin's Personal API Swagger docs |

Click **Deploy** to apply them.
To keep these values on future Git deploys, add them in the dashboard (not in wrangler.jsonc). Wrangler keeps dashboard secrets. If plain-text variables ever get cleared on deploy, add `GARMIN_API_BASE` as a Secret instead.

## 4. Check it works
- `https://iron5.jonespeter173.workers.dev/api/garmin/_status` → `{"error":"Wrong app password"}` means the **relay is live** ✅
- `https://iron5.jonespeter173.workers.dev/app.js?v=1.2` → search for "Garmin live sync" to confirm it's the **new app**
- On your phone, open the site, then go to **⚙️ Settings**: **🔗 Garmin live sync** is the first card, and the bottom says **IronCoach v1.2**.
  If it's still old, use Chrome **⋮ → ⓘ → Site settings → Clear & reset** (back up first), then reload.

Then enter your app password → **Test connection** → activities path → **Save & sync now**.
