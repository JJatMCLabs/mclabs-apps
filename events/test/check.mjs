// End-to-end check against a running counter: node test/check.mjs <base url> <read key>
// Locally: npx wrangler dev (with .dev.vars holding READ_KEY), then node test/check.mjs http://127.0.0.1:8787 <key>
const [base, key] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
let failed = 0;
const post = (body, type = "application/json") => fetch(base + "/v1/events", { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
async function expect(name, res, status) {
  const ok = res.status === status;
  if (!ok) failed++;
  console.log((ok ? "pass  " : "FAIL  ") + name + (ok ? "" : ` (got ${res.status}: ${await res.text()})`));
}
const e = (o = {}) => ({ app: "test", event: "install", version: "1.0", date: today, ...o });

const before = await (await fetch(`${base}/v1/counts?app=test&key=${key}`)).json();
const count = (rows, ev, days) => rows.filter((r) => r.event === ev && r.days === days).reduce((s, r) => s + r.count, 0);

await expect("one event", await post(e()), 200);
await expect("a batch", await post({ events: [e({ event: "tutorial_done" }), e({ event: "opened", days: 1 }), e({ event: "opened", days: 1 })] }), 200);
await expect("an unknown field (an ID) is refused", await post(e({ device: "abc" })), 400);
await expect("an unknown app is refused", await post(e({ app: "someone-else" })), 400);
await expect("opened without days is refused", await post(e({ event: "opened" })), 400);
await expect("opened with days 3 is refused", await post(e({ event: "opened", days: 3 })), 400);
await expect("days on another event is refused", await post(e({ days: 0 })), 400);
await expect("a time instead of a day is refused", await post(e({ date: new Date().toISOString() })), 400);
await expect("a date far in the past is refused", await post(e({ date: "2020-01-01" })), 400);
await expect("a bad event name is refused", await post(e({ event: "Install!" })), 400);
await expect("a batch with one bad event counts none", await post({ events: [e({ event: "job1_finished" }), e({ user: 1 })] }), 400);
await expect("a non-JSON body is refused", await post("app=test", "text/plain"), 415);
await expect("counts need the key", await fetch(`${base}/v1/counts`), 401);
await expect("a wrong key is refused", await fetch(`${base}/v1/counts?key=nope`), 401);
await expect("the table needs the key", await fetch(`${base}/`), 401);

const after = await (await fetch(`${base}/v1/counts?app=test&key=${key}`)).json();
const delta = (ev, days) => count(after.rows, ev, days) - count(before.rows, ev, days);
const sums = [["install", undefined, 1], ["tutorial_done", undefined, 1], ["opened", 1, 2], ["job1_finished", undefined, 0]];
for (const [ev, days, want] of sums) {
  const got = delta(ev, days);
  if (got !== want) failed++;
  console.log((got === want ? "pass  " : "FAIL  ") + `${ev}${days !== undefined ? " day " + days : ""} counted ${got}, expected ${want}`);
}
const page = await fetch(`${base}/?key=${key}&app=test`);
await expect("the table opens with the key", page, 200);
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
