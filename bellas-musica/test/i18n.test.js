import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DICT } from "../public/js/i18n.js";
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
  for (const s of ["flexible", "moderate", "strict"]) assert.ok(`policy.${s}` in DICT.en);
  for (const e of EVENT_TYPES) assert.ok(`event.${e}` in DICT.en, e);
  for (const e of GROUP_TYPES) assert.ok(`type.${e}` in DICT.en, e);
});

test("no inline scripts or event-handler attributes (the CSP forbids them)", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(src, /\son(click|change|submit|input)=/i);
});
