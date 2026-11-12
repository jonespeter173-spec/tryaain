/* IronCoach add-on: send the plan to Intervals.icu as structured workouts (→ Garmin Connect → watch).
   Load AFTER app.js:  <script src="intervals.js?v=1.3"></script>
   Needs the Worker route /api/intervals/* and the INTERVALS_API_KEY secret. */
(function () {
  const KEY = "ic_intervals", PREFIX = "ironcoach-";
  const DEF = { days: 14, strength: true, auto: true, last: null, lastHash: "", lastCount: 0 };
  const cfg = () => ({ ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) });
  const saveCfg = c => localStorage.setItem(KEY, JSON.stringify(c));
  const say = t => (typeof toast === "function" ? toast(t) : console.log(t));
  const E = window.Engine;
  const TYPE = { bike: "Ride", run: "Run", swim: "Swim", ski: "NordicSki", strength: "WeightTraining", other: "Walk" };

  /* ---------- formatting helpers ---------- */
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const dur = m => m < 1 ? `${Math.round(m * 60)}s` : (m % 1 ? `${Math.floor(m)}m${Math.round(m % 1 * 60)}s` : `${m}m`);
  const clean = s => String(s || "").replace(/(\d+)\s*x\s*/gi, "$1 × ").replace(/\n/g, " ").trim();

  /* ---------- workout text builder (Intervals.icu workout-builder syntax) ---------- */
  function builder(total) {
    const L = []; let used = 0;
    const step = (s) => `- ${s.label ? s.label + " " : ""}${s.d} ${s.t}`;
    return {
      add(min, t, label) { if (min <= 0) return; L.push(step({ d: dur(Math.round(min)), t, label })); used += Math.round(min); },
      addDist(d, est, t, label) { L.push(step({ d, t, label })); used += est; },
      rep(name, n, steps) {
        if (n < 1) return; L.push("", `${name} ${n}x`); steps.forEach(s => L.push(step(s))); L.push("");
        used += n * steps.reduce((a, s) => a + s.est, 0);
      },
      left: (reserve = 0) => total - used - reserve,
      text: () => L.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    };
  }
  const fitReps = (want, setMin, room) => Math.max(1, Math.min(want, Math.floor(room / Math.max(setMin, 1))));

  function workoutText(p, a) {
    const T = Math.max(p.min || 0, 10), d = p.desc || "", ttl = p.title || "", b = builder(T);
    const ftp = a.ftp, rp = a.runThr, css = a.css, hr = a.lthr;
    if (p.sport === "bike") {
      const w = (x, y) => `${Math.round(ftp * x)}-${Math.round(ftp * y)}w`, z2 = w(.60, .72);
      const wu = /long/i.test(ttl) ? 15 : 10, cd = 10;
      b.add(wu, "ramp " + w(.45, .62), "Warmup");
      const m = d.match(/(\d+)x(\d+)' at (\d+)-(\d+) W/), rest = +((d.match(/(\d+)' easy/) || [])[1] || 3);
      const last = d.match(/last (\d+)' at (\d+)-(\d+) W/);
      if (/cadence/i.test(ttl)) { const n = fitReps(6, 5, b.left(cd)); b.rep("Cadence", n, [{ d: "1m", t: w(.65, .70) + " 100-110rpm", est: 1 }, { d: "4m", t: z2 + " 90rpm", est: 4 }]); }
      else if (m) { const work = +m[2], n = fitReps(+m[1], work + rest, b.left(cd)); b.rep("Main Set", n, [{ d: dur(work), t: `${m[3]}-${m[4]}w`, est: work }, { d: dur(rest), t: w(.50, .55), est: rest }]); }
      const fin = last ? +last[1] : 0, fill = b.left(cd + fin);
      if (fill >= 5) b.add(fill, z2, "Endurance");
      if (last) b.add(fin, `${last[2]}-${last[3]}w`, "Race power");
      b.add(Math.max(0, Math.min(cd, b.left())), w(.45, .55), "Cooldown");
    } else if (p.sport === "run") {
      const z2 = `${mmss(rp * 1.3)}/km-${mmss(rp * 1.2)}/km Pace`, ez = `${mmss(rp * 1.4)}/km-${mmss(rp * 1.3)}/km Pace`;
      const short = T < 30, wu = short ? 5 : 10, cd = short ? 0 : 5;
      b.add(wu, ez, "Warmup");
      const m = d.match(/(\d+)x(\d+(?:\.\d+)?)(km|') at (\d+:\d+)\/km/), rest = +((d.match(/r(\d+)'/) || d.match(/(\d+)' easy/) || [])[1] || 2);
      const fin = d.match(/final (\d+)' at (\d+:\d+)\/km/), hills = /hill/i.test(ttl) || /hill strides/i.test(d), strides = /strides/i.test(d) && !hills;
      if (m) {
        const pace = `${m[4]}/km Pace`, km = m[3] === "km";
        const est = km ? +m[2] * rp / 60 : +m[2];
        const n = fitReps(+m[1], est + rest, b.left(cd));
        b.rep("Main Set", n, [{ d: km ? `${m[2]}km` : dur(+m[2]), t: pace, est }, { d: dur(rest), t: ez, est: rest }]);
      } else if (hills) {
        const n = fitReps(8, 2, b.left(cd) - 10);
        b.add(Math.max(0, b.left(cd + n * 2)), z2, "Aerobic");
        b.rep("Hill strides", n, [{ d: "30s", t: `${mmss(rp * .92)}/km Pace`, est: .5 }, { d: "90s", t: ez, est: 1.5 }]);
      }
      const finMin = fin ? +fin[1] : 0, strideMin = strides ? 6 : 0, fill = b.left(cd + finMin + strideMin);
      if (fill >= 3) b.add(fill, z2, "Aerobic");
      if (fin) b.add(finMin, `${fin[2]}/km Pace`, "Race pace");
      if (strides) b.rep("Strides", 6, [{ d: "20s", t: `${mmss(rp * .88)}/km Pace`, est: 1 / 3 }, { d: "40s", t: ez, est: 2 / 3 }]);
      if (cd) b.add(Math.max(0, Math.min(cd, b.left())), ez, "Cooldown");
    } else if (p.sport === "swim") {
      const pc = f => `${mmss(css * f)}/100m Pace`, easy = pc(1.18), steady = pc(1.10);
      b.add(Math.min(8, T / 4), easy, "Warmup");
      const m = d.match(/(\d+)x(\d+)m at (\d+:\d+)\/100m/), r = +((d.match(/r(\d+)s/) || [])[1] || 20);
      if (m) {
        const est = (+m[2] / 100) * css / 60 + r / 60, n = fitReps(+m[1], est, b.left(5));
        b.rep("Main Set", n, [{ d: `${m[2]}mtr`, t: `${m[3]}/100m Pace`, est: est - r / 60 }, { d: `${r}s`, t: pc(1.6), est: r / 60 }]);
      } else if (/drill|technique/i.test(ttl + d)) {
        b.add(Math.max(0, b.left(5)), pc(1.15), "Drills");
      }
      const fill = b.left(5); if (fill >= 3) b.add(fill, steady, "Aerobic");
      b.add(Math.max(0, Math.min(5, b.left())), easy, "Cooldown");
    } else if (p.sport === "ski") {
      const pct = bpm => Math.round(bpm / hr * 100), z2 = "81-89% LTHR", ez = "75-81% LTHR";
      const wu = /long/i.test(ttl) ? 15 : 20, cd = 10;
      b.add(Math.min(wu, T / 3), z2, "Warmup");
      const m = d.match(/(\d+)x(\d+)' at (\d+)(?:-(\d+)|(\+))? bpm/), rest = +((d.match(/(\d+)' easy/) || [])[1] || 2);
      if (m) {
        const lo = pct(+m[3]), hi = m[4] ? pct(+m[4]) : lo + 4, work = +m[2], n = fitReps(+m[1], work + rest, b.left(cd));
        b.rep("Main Set", n, [{ d: dur(work), t: `${lo}-${hi}% LTHR`, est: work }, { d: dur(rest), t: ez, est: rest }]);
      } else if (/race-tempo|race effort/i.test(d)) {
        const rt = d.match(/(\d+)x(\d+)'/); if (rt) { const n = fitReps(+rt[1], +rt[2] + 4, b.left(cd) / 2); b.add(Math.max(0, (b.left(cd) - n * (+rt[2] + 4)) / 2), z2, "Endurance"); b.rep("Race tempo", n, [{ d: dur(+rt[2]), t: "92-97% LTHR", est: +rt[2] }, { d: "4m", t: z2, est: 4 }]); }
      }
      const fill = b.left(cd); if (fill >= 3) b.add(fill, z2, "Endurance");
      b.add(Math.max(0, Math.min(cd, b.left())), ez, "Cooldown");
    } else return null;   // strength / other → plain text event
    return b.text();
  }

  /* ---------- events ---------- */
  function buildEvents(c) {
    const a = st.athlete, t = E.todayIso(), end = E.addDays(t, c.days - 1), events = [], byDay = {};
    st.plan.filter(p => p.date >= t && p.date <= end && p.status !== "skipped").forEach(p => (byDay[p.date] = byDay[p.date] || []).push(p));
    Object.entries(byDay).forEach(([date, list]) => {
      list.forEach((p, i) => {
        const base = { start_date_local: `${date}T00:00:00`, external_id: `${PREFIX}${date}-${i}` };
        if (p.intensity === "race") {
          events.push({ ...base, category: "NOTE", name: p.title.replace(/^[^\w]+/, ""), description: clean(p.desc), color: "red" });
          return;
        }
        if (p.sport === "strength" && !c.strength) return;
        const steps = workoutText(p, a), note = clean(p.desc) + (p.note ? ` (${clean(p.note)})` : "");
        events.push({ ...base, category: "WORKOUT", type: TYPE[p.sport] || "Workout", name: p.title,
          moving_time: Math.round((p.min || 0) * 60), description: steps ? `${note}\n\n${steps}` : note });
      });
    });
    const keep = new Set(events.map(e => e.external_id)), del = [];
    for (let d = t; d <= end; d = E.addDays(d, 1)) for (let i = 0; i < 8; i++) { const id = `${PREFIX}${d}-${i}`; if (!keep.has(id)) del.push(id); }
    return { events, del };
  }
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };

  async function call(path, body) {
    const r = await fetch("/api/intervals/" + path, { method: body ? "POST" : "GET",
      headers: { "x-app-password": (st.garmin && st.garmin.password) || "", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    if (typeof data === "string" && /<html/i.test(data)) throw new Error("Intervals route not deployed — update worker.js");
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  }
  async function send(silent) {
    const c = cfg();
    if (!st.plan || !st.plan.length) { if (!silent) say("No plan to send — add a race first"); return; }
    const { events, del } = buildEvents(c), h = hash(JSON.stringify(events));
    if (silent && h === c.lastHash) return;
    try {
      if (!silent) say(`Sending ${events.length} sessions to Intervals.icu…`);
      const r = await call("sync", { events, delete: del });
      Object.assign(c, { last: new Date().toISOString(), lastHash: h, lastCount: r.saved ?? events.length }); saveCfg(c);
      say(`✅ Sent ${c.lastCount} sessions to Intervals.icu`); refreshCard();
    } catch (e) { say("Intervals.icu send failed: " + e.message); }
  }
  async function removeAll() {
    if (!confirm("Remove IronCoach workouts from Intervals.icu for the next " + cfg().days + " days?")) return;
    const c = cfg(), t = E.todayIso(), del = [];
    for (let d = t; d <= E.addDays(t, c.days - 1); d = E.addDays(d, 1)) for (let i = 0; i < 8; i++) del.push(`${PREFIX}${d}-${i}`);
    try { await call("sync", { events: [], delete: del }); c.lastHash = ""; saveCfg(c); say("Removed from Intervals.icu"); }
    catch (e) { say("Remove failed: " + e.message); }
  }
  async function test() {
    try { await call("_status"); say("✅ Intervals.icu connected"); } catch (e) { say("❌ " + e.message); }
  }

  /* ---------- Settings card ---------- */
  const $id = id => document.getElementById(id);
  function readForm() { const c = cfg(); Object.assign(c, { days: +$id("ivDays").value, strength: $id("ivStr").checked, auto: $id("ivAuto").checked }); saveCfg(c); return c; }
  function refreshCard() { const el = $id("ivLast"); if (el) { const c = cfg(); el.textContent = c.last ? `${new Date(c.last).toLocaleString()} (${c.lastCount} sessions)` : "never"; } }
  function inject() {
    if ($id("ivCard") || !$id("gcSync")) return;
    const anchor = $id("gcSync").closest(".card"), c = cfg();
    anchor.insertAdjacentHTML("afterend", `<h2>📤 Send plan to Intervals.icu → Garmin</h2><div class="card" id="ivCard">
      <p class="muted">Sends upcoming sessions as structured workouts to your Intervals.icu calendar. With Intervals.icu linked to Garmin Connect ("Upload planned workouts"), they reach your watch on its next sync. Uses the same app password as Garmin live sync.</p>
      <div class="row"><div><label>Days ahead</label><select id="ivDays">${[7, 14, 21].map(d => `<option ${d === c.days ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      <div><label>&nbsp;</label><label><input id="ivStr" type="checkbox" style="width:auto" ${c.strength ? "checked" : ""}> Include strength</label></div></div>
      <label><input id="ivAuto" type="checkbox" style="width:auto" ${c.auto ? "checked" : ""}> Auto-send when the plan changes</label>
      <p class="muted">Last sent: <span id="ivLast"></span></p>
      <div class="row"><button class="btn sec" id="ivTest">Test</button><button class="btn" id="ivSend">Send plan now</button></div>
      <button class="btn del" id="ivRemove">Remove IronCoach workouts from Intervals.icu</button></div>`);
    refreshCard();
    $id("ivTest").onclick = test;
    $id("ivSend").onclick = () => { readForm(); send(false); };
    $id("ivRemove").onclick = () => { readForm(); removeAll(); };
    ["ivDays", "ivStr", "ivAuto"].forEach(id => $id(id).onchange = readForm);
  }
  new MutationObserver(inject).observe(document.getElementById("view"), { childList: true });
  inject();

  /* ---------- auto-send ---------- */
  const auto = () => { const c = cfg(); if (c.auto && st.garmin && st.garmin.password && location.protocol.startsWith("http")) send(true); };
  setTimeout(auto, 6000);                 // after any Garmin auto-sync has rebuilt the plan
  setInterval(auto, 5 * 60 * 1000);       // picks up edits, check-ins, race changes
  window.IntervalsSync = { send, test, removeAll, buildEvents, workoutText };
})();
