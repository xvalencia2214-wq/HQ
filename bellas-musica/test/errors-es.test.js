// Spanish screens must never show an English error. Every message the server can throw is read from the source and
// must have Spanish in server/errors-es.js; field names used by the input checks must be translated too.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { translateError, requestLang } from "../server/errors-es.js";
import { startApp, client } from "./helpers.js";

const files = ["server", "server/routes"].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".js") && f !== "errors-es.js").map((f) => path.join(d, f)));

// The text of each `new HttpError(status, <message>)`, up to its closing parenthesis.
function errorArgs(src) {
  const out = [];
  const re = /HttpError\(/g; let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1, q = "";
    const start = i;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue; }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}
// String literals inside a piece of code ("..." and `...` with ${...} parts).
function literals(code) {
  const out = [];
  for (let i = 0; i < code.length; i++) {
    const q = code[i];
    if (q !== '"' && q !== "`") continue;
    let j = i + 1, s = "", depth = 0;
    for (; j < code.length; j++) {
      const c = code[j];
      if (q === "`" && c === "$" && code[j + 1] === "{") { depth = 1; s += "\u0000"; j += 2; for (; j < code.length && depth; j++) { if (code[j] === "{") depth++; else if (code[j] === "}") depth--; } j--; continue; }
      if (c === "\\") { s += code[j + 1]; j++; continue; }
      if (c === q) break;
      s += c;
    }
    out.push(s);
    i = j;
  }
  return out;
}

const SAMPLES = ["5", "Mariachi Sol de Jalisco", "2026-12-12", "12.50"];
const english = new Set();
for (const f of files) for (const arg of errorArgs(fs.readFileSync(f, "utf8"))) for (const lit of literals(arg)) if (/[a-z]{3}/i.test(lit) && lit.length > 3) english.add(lit);
// messages built before the throw (a no-show report's reason)
for (const lit of ["You already reported this booking.", "Only a confirmed, paid booking can be reported.", "You can report a no-show after the event day has passed.", "Reports must be made within \u0000 days of the event."]) english.add(lit);

test("every server error message has Spanish", () => {
  const missing = [];
  for (const lit of english) {
    if (lit.includes("\u0000") && /^\u0000/.test(lit) === false && !/[a-z]/i.test(lit.replace(/\u0000/g, ""))) continue;
    const tries = [...SAMPLES.map((s) => lit.replace(/\u0000/g, s)), lit.replace("\u0000", "2").replace(/\u0000/g, "s")]; // "for 2 hours"
    const ok = tries.some((msg) => translateError(msg, "es") !== msg);
    if (!ok && !/^(ANDROID_PACKAGE|[a-z_]+$)/.test(lit)) missing.push(lit);
  }
  assert.deepEqual(missing, [], "no Spanish for:\n" + missing.join("\n"));
  assert.ok(english.size > 250, `read ${english.size} messages`);
});

test("field names in the input checks are translated", () => {
  const names = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/\b(?:str|int|oneOf|stringList|dollarsToCents)\([^,()]+(?:\([^()]*\))?[^,()]*, "([^"]+)"/g)) names.add(m[1]);
  assert.ok(names.size > 50, `found ${names.size} field names`);
  const missing = [...names].filter((n) => translateError(`${n} is required`, "es").startsWith(n + ":"));
  assert.deepEqual(missing, []);
  assert.equal(translateError("Phone is too long (max 30)", "es"), "Teléfono: es muy largo (máximo 30).");
  assert.equal(translateError("Guests must be a whole number from 1 to 5000", "es"), "Invitados: debe ser un número entero de 1 a 5000.");
});

test("English stays English, unknown text passes through, Stripe's own errors get a Spanish line", () => {
  assert.equal(translateError("That time was just taken. Please pick another.", "en"), "That time was just taken. Please pick another.");
  assert.equal(translateError("Something brand new", "es"), "Something brand new");
  assert.match(translateError("Your card was declined.", "es", 502), /procesador de pagos/);
  assert.equal(translateError("Line 3: Phone numbers have 10 digits, like 773-555-0101", "es"), "Línea 3: Los teléfonos tienen 10 dígitos, como 773-555-0101.");
  assert.equal(requestLang({ headers: { "x-lang": "es" } }), "es");
  assert.equal(requestLang({ headers: { "accept-language": "es-MX,es;q=0.9" } }), "es");
  assert.equal(requestLang({ headers: { "x-lang": "en", "accept-language": "es-MX" } }), "en");
  assert.equal(requestLang({ headers: {} }), "en");
});

test("the server answers in the screen's language", async () => {
  const s = await startApp();
  try {
    const c = client(s.base);
    const es = await c.raw("GET", "/api/search?zip=1", undefined, { "X-Lang": "es" });
    assert.equal(es.status, 400);
    assert.equal(es.json.error, "Escribe un código postal de 5 dígitos.");
    const en = await c.get("/api/search?zip=1");
    assert.equal(en.json.error, "Enter a 5-digit ZIP code");
    const login = await c.raw("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong password" }, { "X-Lang": "es" });
    assert.equal(login.json.error, "Correo o contraseña incorrectos.");
  } finally { await s.close(); }
});

test("a stray % in someone else's cookie doesn't break the app", async () => {
  const s = await startApp();
  try {
    const c = client(s.base);
    const r = await c.raw("GET", "/api/meta", undefined, { Cookie: "_ga=100%; other=%E0%A4%A; bm_x=ok" });
    assert.equal(r.status, 200);
    await c.signup("cookie@example.com");
    const me = await c.raw("GET", "/api/me", undefined, { Cookie: `junk=50%off; ${c.cookie()}` });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, "cookie@example.com");
  } finally { await s.close(); }
});
