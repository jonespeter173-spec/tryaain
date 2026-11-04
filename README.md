# IronCoach v1.2: training planner with Garmin sync

This is an adaptive training plan for **Ironman, Half Ironman 70.3 and cross-country skate ski races (15/25/50 km)**, with weightlifting, a readiness score, an AI coach and **live Garmin sync**.
It's hosted on **Cloudflare Pages**. The Garmin connection runs on the same site, so the browser doesn't block it and your Garmin key never touches your phone.

```
functions/api/garmin/[[path]].js   ← Garmin relay (Cloudflare runs this automatically)
www/                               ← the app (index.html, app.js, engine.js, ...)
package.json, capacitor.config.json, assets/  ← only needed for an Android Studio build
```

---

## 1. Create a NEW GitHub repository (avoids the "failed to clone" problem)
1. On github.com, click **New repository** and name it `ironcoach-v12`. Tick **Add a README file**, which gives the repo a first commit so Cloudflare can clone it. Click **Create**.
2. Unzip `IronCoach_v1.2.zip` on your computer. Open the **`ironcoach`** folder.
3. In the repo, click **Add file → Upload files** and drag in **the contents** of the `ironcoach` folder: `functions`, `www`, `package.json` and the rest. Don't drag the `ironcoach` folder itself.
4. Click **Commit changes**. The repo's top level must show `functions/` and `www/`:
   ```
   functions/
   www/
   README.md
   package.json ...
   ```
   Open `functions/api/garmin/` on GitHub and check `[[path]].js` is there.

## 2. Create the Cloudflare Pages project
1. Go to dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
   If your repo isn't listed, click **Configure GitHub App** and give Cloudflare access to it.
2. Pick `ironcoach-v12`, then set:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `www`
   - **Root directory:** *(leave empty / `/`)*
3. Click **Save and Deploy**. The app is live at `https://<project>.pages.dev`.

You can delete your old Pages project afterwards.

## 3. Get your Garmin Personal API key
1. Log in to **connect.garmin.com** in a desktop browser, open the **Personal API Key** page, and click **Create Key**.
2. Accept the terms, choose a **1 year** expiry, then click **Create**.
3. **Copy the key now.** It's only shown once.
4. In Garmin's **Personal API Swagger documentation**, note:
   - the **API base URL**
   - the **activities** path and its date-range parameters
   - optionally, a **daily health** path (sleep/HRV/resting HR)

## 4. Add the settings in Cloudflare
Go to your Pages project → **Settings → Variables and Secrets → Add** (Production):

| Name | Type | Value |
|---|---|---|
| `GARMIN_API_KEY` | **Secret** | your Garmin key |
| `APP_PASSWORD` | **Secret** | a long password you make up |
| `GARMIN_API_BASE` | Text | the base URL from Garmin's docs |

Then go to **Deployments → ⋯ (latest) → Retry deployment**. Settings only take effect after a redeploy.

**Quick check:** opening `https://<project>.pages.dev/api/garmin/_status` in a browser should show `{"error":"Wrong app password"}`. That means the relay is live.
If you see the app or a "page not found" error instead, the `functions` folder isn't at the top of the repo.

## 5. Install on your phone and connect Garmin
1. Open `https://<project>.pages.dev` in **Chrome** and tap **⋮ → Add to Home screen → Install**.
2. Go to **⚙️ Settings → 🔗 Garmin live sync** (the first card) and enter your **App password**.
3. Tap **Test connection** and wait for **"✅ Connected to Garmin"**.
4. Enter the **Activities path**, relative to the base URL. Put the date range in placeholders:
   - `{start}` / `{end}` are dates like 2026-07-06
   - `{startSec}` / `{endSec}` are Unix seconds
5. Optionally enter the **Daily health path**, then tap **Save & sync now**.

After that, the app syncs automatically each time you open it (at most every 6 hours) and rebuilds your plan. The demo-data banner disappears once real data is in.

## 6. Add your races
In **🏁 Races**, replace the five sample races with your real ones (name, distance, date, A/B/C priority).

---

## Troubleshooting
| Message / symptom | Fix |
|---|---|
| Build "failed to clone" | Make sure the repo has at least one commit and Cloudflare has access (GitHub → Settings → Applications → Cloudflare → Configure). Don't upload a folder that came with its own `.git` folder. |
| "Garmin relay not found — the functions folder isn't deployed" | `functions/` must be at the repo's top level, and you must deploy from Git (not drag-and-drop). |
| `Wrong app password` | The app password doesn't match `APP_PASSWORD`. |
| `Relay not configured` / `Set GARMIN_API_BASE` | Add the variable, then **Retry deployment**. |
| `Garmin token request failed (401)` | The key is wrong or expired. Create a new key and update `GARMIN_API_KEY`. |
| `HTTP 404` / `HTTP 400` when syncing | Wrong path or date format. Check the Swagger docs, try `{startSec}`/`{endSec}`, or lower **Days per request**. |
| "Garmin returned no activities" | The path works but no list was found in the response. Send the response shape (without your key) for a mapping fix. |
| Old version still showing on the phone | Close the app fully and reopen it twice. This version always checks for updates first. |

## Android Studio APK (optional)
Set `server.url` in `capacitor.config.json` to your `https://<project>.pages.dev` address, so the app talks to your Garmin relay. Then run:
`npm install && npx cap add android && npx @capacitor/assets generate --android && npx cap sync android && npx cap open android`

## Security
- The Garmin key is a Cloudflare secret.
- The relay only allows reading data, requires the app password, and only forwards to `GARMIN_API_BASE`.
- Backups exclude the app password.
- To cut off access instantly, delete the key in Garmin Connect or change `APP_PASSWORD`.

IronCoach is a training aid, not medical advice.
