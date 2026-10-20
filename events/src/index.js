// mclabs event counter: anonymous daily counts for every mclabs game (README.md, "Events").
//
// POST /v1/events  {"events":[{"app","event","version","date"[,"days"]}, ...]}  (or one event object on its own)
//   Each event adds 1 to the count for its (date, app, event, version, days). Nothing else is stored: no IDs, no IP
//   addresses, no request logs (observability is off in wrangler.toml and nothing here logs).
// GET  /v1/counts?app=&from=&to=   daily counts as JSON, with the read key (Authorization: Bearer <key> or ?key=)
// GET  /?key=                      the same as a small HTML table
const FIELDS = new Set(["app", "event", "version", "date", "days"]);
const NAME = /^[a-z][a-z0-9_]{0,31}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_DAYS = new Set([0, 1, 7]);
const MAX_BATCH = 50;
const MAX_AGE_DAYS = 45; // events queued offline may arrive late; older ones are dropped

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/v1/events") return await ingest(request, env);
      if (request.method === "GET" && url.pathname === "/v1/counts") return await counts(request, url, env, false);
      if (request.method === "GET" && url.pathname === "/") return await counts(request, url, env, true);
      if (request.method === "GET" && url.pathname === "/health") return text("ok");
      return text("not found", 404);
    } catch {
      return text("error", 500); // deliberately no logging
    }
  },
};

async function ingest(request, env) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return text("expected application/json", 415);
  const body = await request.text();
  if (body.length > 16384) return text("too large", 413);
  let data;
  try { data = JSON.parse(body); } catch { return text("bad json", 400); }
  const list = Array.isArray(data?.events) && Object.keys(data).length === 1 ? data.events : [data];
  if (list.length === 0 || list.length > MAX_BATCH) return text("1 to " + MAX_BATCH + " events", 400);

  const apps = new Set((env.APPS || "").split(",").map((s) => s.trim()).filter(Boolean));
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const rows = [];
  for (const e of list) {
    const problem = check(e, apps, today);
    if (problem) return text(problem, 400); // all or nothing, so a client never resends half a batch
    rows.push([e.date, e.app, e.event, e.version, e.event === "opened" ? e.days : -1]);
  }
  const insert = env.DB.prepare(
    "INSERT INTO counts (date, app, event, version, days, n) VALUES (?1, ?2, ?3, ?4, ?5, 1) " +
    "ON CONFLICT (date, app, event, version, days) DO UPDATE SET n = n + 1");
  await env.DB.batch(rows.map((r) => insert.bind(...r)));
  return json({ ok: true, counted: rows.length });
}

function check(e, apps, today) {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return "event must be an object";
  for (const k of Object.keys(e)) if (!FIELDS.has(k)) return "unknown field: " + k;
  if (typeof e.app !== "string" || !apps.has(e.app)) return "unknown app";
  if (typeof e.event !== "string" || !NAME.test(e.event)) return "event must match " + NAME;
  if (typeof e.version !== "string" || !VERSION.test(e.version)) return "bad version";
  if (typeof e.date !== "string" || !DATE.test(e.date)) return "date must be YYYY-MM-DD";
  const t = Date.parse(e.date);
  if (Number.isNaN(t) || t > today + 86400000 || t < today - MAX_AGE_DAYS * 86400000) return "date out of range";
  if (e.event === "opened") {
    if (!OPEN_DAYS.has(e.days)) return "opened needs days: 0, 1 or 7";
  } else if ("days" in e) return "days is only for opened";
  return null;
}

async function counts(request, url, env, html) {
  const auth = request.headers.get("authorization") || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("key") || "";
  if (!env.READ_KEY || !(await same(key, env.READ_KEY))) return text("unauthorised", 401);

  const today = new Date().toISOString().slice(0, 10);
  const from = DATE.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : daysBefore(today, 30);
  const to = DATE.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : today;
  const app = url.searchParams.get("app");
  const byVersion = url.searchParams.get("by") === "version";
  const version = byVersion ? "version" : "'' AS version";
  const group = byVersion ? "date, app, event, version, days" : "date, app, event, days";
  const where = "date BETWEEN ?1 AND ?2" + (app ? " AND app = ?3" : "");
  const stmt = env.DB.prepare(
    `SELECT date, app, event, ${version}, days, SUM(n) AS n FROM counts WHERE ${where} GROUP BY ${group} ORDER BY date DESC, app, event, days`);
  const { results } = await (app ? stmt.bind(from, to, app) : stmt.bind(from, to)).all();
  const rows = results.map((r) => ({ date: r.date, app: r.app, event: r.event, ...(byVersion ? { version: r.version } : {}), ...(r.days >= 0 ? { days: r.days } : {}), count: r.n }));
  if (!html) return json({ from, to, rows });

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const name = (r) => r.event + (r.days !== undefined ? " (day " + r.days + ")" : "");
  const body = rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.app)}</td><td>${esc(name(r))}</td>${byVersion ? `<td>${esc(r.version)}</td>` : ""}<td class=n>${r.count}</td></tr>`).join("");
  return new Response(`<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex>
<title>mclabs events</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:24px 16px;color:#4a3b33;background:#fbf4e8}table{border-collapse:collapse}td,th{padding:4px 12px;border-bottom:1px solid #eadccb;text-align:left}.n{text-align:right}</style>
<h1>Events ${esc(from)} to ${esc(to)}${app ? " · " + esc(app) : ""}</h1><p>Add <code>&amp;app=stitchwork</code>, <code>&amp;from=YYYY-MM-DD</code>, <code>&amp;to=</code> or <code>&amp;by=version</code> to the address.</p>
<table><tr><th>Date</th><th>App</th><th>Event</th>${byVersion ? "<th>Version</th>" : ""}<th class=n>Count</th></tr>${body || "<tr><td colspan=5>No events yet</td></tr>"}</table>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

// Constant-time comparison of the read key, via HMAC so the lengths don't leak either.
async function same(a, b) {
  const k = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

function daysBefore(day, n) { return new Date(Date.parse(day) - n * 86400000).toISOString().slice(0, 10); }
function text(s, status = 200) { return new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8" } }); }
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
