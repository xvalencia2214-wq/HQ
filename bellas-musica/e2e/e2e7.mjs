// A real page crash reaches the alert channel; ordinary user-facing errors do not.
//   NODE_PATH=$(npm root -g) node e2e/e2e7.mjs
import http from "node:http";
import { createRequire } from "node:module";
import { startApp } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const hooks = [];
const hook = http.createServer(async (req, res) => { let raw = ""; for await (const c of req) raw += c; hooks.push(JSON.parse(raw || "{}").text || ""); res.end("ok"); });
await new Promise((r) => hook.listen(0, r));
const S = await startApp({ ALERT_WEBHOOK_URL: `http://127.0.0.1:${hook.address().port}/h` });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let step = 0, failed = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await (await browser.newContext()).newPage();
  await p.goto(S.base + "/#/discover"); await p.waitForSelector("#app *");
  await p.evaluate(() => setTimeout(() => { throw new Error("test crash from the page"); }, 0));
  await wait(600);
  ok("a real JavaScript crash is reported with the screen it happened on", hooks.some((h) => /Browser error on #\/discover: .*test crash from the page/.test(h)));
  const before = hooks.length;
  await p.evaluate(() => { Promise.reject(new Error("rejected promise from the page")); });
  await wait(600);
  ok("an unhandled promise rejection is reported too", hooks.length > before && hooks.some((h) => /rejected promise from the page/.test(h)));
  // a normal 4xx (like a wrong password) is not a crash
  const n = hooks.length;
  await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform");
  await p.fill("#a-email", "nobody@example.com"); await p.fill("#a-pw", "wrong password 1"); await p.click("#authform button[type=submit]");
  await p.waitForSelector("#autherr:not(:empty)"); await wait(500);
  ok("a wrong-password error is shown to the person and is NOT sent as a crash", hooks.length === n);
  // at most 3 reports per page load, however much goes wrong
  const m = hooks.length;
  await p.evaluate(() => { for (let i = 0; i < 8; i++) setTimeout(() => { throw new Error("storm " + i); }, i); });
  await wait(800);
  ok("a crash storm sends at most 3 reports from one page", hooks.length - m <= 3);
} catch (e) { failed++; console.log("CRASH", e.message.split("\n")[0]); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close(); hook.close();
process.exit(failed ? 1 : 0);
