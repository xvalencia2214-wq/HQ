import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DICT, t, setWho, newScreen, currentScreen } from "../public/js/i18n.js";
import { EVENT_TYPES, GROUP_TYPES } from "../server/pricing.js";

const dir = path.resolve("public/js");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith(".js") && files.push(path.join(d, f.name)); })(dir);
const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");

test("English and Spanish have exactly the same keys and placeholders", () => {
  const en = Object.keys(DICT.en).sort(), es = Object.keys(DICT.es).sort();
  assert.deepEqual(es.filter((k) => !en.includes(k)), [], "keys only in Spanish");
  assert.deepEqual(en.filter((k) => !es.includes(k)), [], "keys only in English");
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of en) assert.equal(ph(DICT.es[k]), ph(DICT.en[k]), `placeholders differ for ${k}`);
});

test("every translation key used in the code exists", () => {
  const used = new Set();
  for (const m of src.matchAll(/\bt\("([^"]+)"/g)) if (!m[1].endsWith(".")) used.add(m[1]);
  for (const m of src.matchAll(/\["\w+", "((?:sort|f|g)\.\w+)"\]/g)) used.add(m[1]);
  for (const m of src.matchAll(/fact\("([\w.]+)"/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in DICT.en, `missing key: ${k}`);
  // keys built at runtime
  for (const s of ["pending_payment", "requested", "confirmed", "declined", "cancelled", "completed", "expired"]) assert.ok(`status.${s}` in DICT.en);
  for (const s of ["unpaid", "paid", "refunded", "partial_refund"]) assert.ok(`pay.${s}` in DICT.en);
  for (const s of ["requests", "calendar", "listing", "extras", "media", "payments", "messages"]) assert.ok(`tab.${s}` in DICT.en);
  for (const s of ["reviews"]) assert.ok(`tab.${s}` in DICT.en);
  for (const s of ["photos", "story", "events", "dates", "payouts"]) assert.ok(`pub.${s}` in DICT.en, s); // publish checklist, keyed by what the server reports missing
  for (const s of ["hour", "hours", "day"]) assert.ok(`resp.${s}` in DICT.en, s); // "usually replies within ..."
  for (const s of ["flexible", "moderate", "strict"]) assert.ok(`policy.${s}` in DICT.en);
  for (const e of EVENT_TYPES) assert.ok(`event.${e}` in DICT.en, e);
  for (const e of GROUP_TYPES) assert.ok(`type.${e}` in DICT.en, e);
});

test("no inline scripts or event-handler attributes (the CSP forbids them)", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(src, /\son(click|change|submit|input)=/i);
});

test("every category has its own name for a listing ({who}/{whos}) and its own search-page heading, in both languages", () => {
  for (const c of ["music", "food", "rentals", "decor", "photo", "services", "venues"])
    for (const k of [`who.${c}`, `whos.${c}`, `hero.${c}`, `heroSub.${c}`]) { assert.ok(DICT.en[k], k); assert.ok(DICT.es[k], k); }
  // a sentence never starts with {who}, so the nouns can stay lower-case
  for (const lang of ["en", "es"]) for (const [k, v] of Object.entries(DICT[lang])) assert.ok(!/^\{whos?\}/.test(v), `${lang} ${k}`);
});

test("{who} follows the screen on show: a screen the user already left can't change it, and typed text is never touched", () => {
  const first = newScreen();
  setWho("venues", first);
  assert.equal(t("g.request"), "Request this venue");
  const second = newScreen(); // the user moved on before the old screen finished loading
  assert.equal(t("g.request"), "Request this group");
  setWho("food", first); // the old screen finishes late
  assert.equal(t("g.request"), "Request this group");
  setWho("food", second);
  assert.equal(t("g.request"), "Request this food vendor");
  assert.equal(currentScreen(), second);
  // what people type goes in as it is, braces and all
  assert.equal(t("q.balance", { x: 1 }), "Balance due to the food vendor");
  assert.match(t("show.groupReport", { note: "they said {whos} and {who}" }), /they said \{whos\} and \{who\}/);
  newScreen();
});

test("one of something reads as one: '1 review', '1 musician', '1 day', in both languages", () => {
  newScreen();
  assert.equal(t("g.reviews", { n: 1 }), "1 review"); assert.equal(t("g.reviews", { n: 2 }), "2 reviews");
  assert.equal(t("card.members", { n: 1 }), "1 musician"); assert.equal(t("pl.daysN", { n: 1 }), "1 day");
  for (const lang of ["en", "es"]) for (const k of Object.keys(DICT[lang])) if (k.endsWith("One") && DICT[lang][k.slice(0, -3)] !== undefined)
    assert.ok(!/\{n\}/.test(DICT[lang][k.slice(0, -3)]) || /\{n\}|^1 /.test(DICT[lang][k]) || k === "gl.copyOne", `${lang} ${k} should be the singular of ${k.slice(0, -3)}`);
});
