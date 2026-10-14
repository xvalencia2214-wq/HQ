---
name: bilingual-ux
description: Use whenever you add or change any text a person will read in Bella's Música (bellas-musica/) — screens, buttons, errors, emails, texts/WhatsApp, push notifications, share pages, the /es/ Google pages — or review the English/Spanish experience. Covers where strings live, the {who} category words, singular/plural, dates and money, tone for Mexican-American families and vendors, and the checks that must pass.
---

# Bilingual English / Spanish UX

Many customers and most vendors read Spanish first, and many are older and use a phone. Spanish is not a translation layer; it is half of the product. Every screen must work fully in Spanish, including errors at the moment someone is paying.

## Where text lives

| Text | File |
| --- | --- |
| Screen strings | `public/js/i18n.js` (`EN`/`ES`), plus `i18n-new.js` (`EN2`/`ES2`), `i18n-pro.js` (3), `i18n-land.js` (4), `i18n-win.js` (5), `i18n-look.js` (6). Merged into `DICT`. |
| Emails, texts, push | `server/emails.js` (`TEMPLATES`, each `{ en(v), es(v) }`), sent by `server/notify.js` in the **recipient's** `users.lang` |
| Event names in messages | `eventLabel()` / `ES_EVENTS` in `server/emails.js` |
| Cancellation policy text | `POLICIES[...].text.{en,es}` in `server/pricing.js` |
| Google pages | `server/share.js` (`/chicago/...` English, `/es/chicago/...` Spanish, hreflang both ways) |
| Server error messages | `throw new HttpError(status, "English text")` across `server/` — **English only today** |

## How to write a string

1. Add the key to **both** `EN*` and `ES*` with the same placeholders. `test/i18n.test.js` fails on a missing key or a placeholder mismatch.
2. Use `t("key", { n, price, city })`. If the sentence changes for one item, add `"<key>One"`: `t()` picks it when `n === 1` ("1 reseña", not "1 reseñas").
3. Say "group", "vendor" or "venue" with `{who}` / `{whos}`, never a fixed word. Call `setWho(category, currentScreen())` on screens that show one listing. `who.*` and `whos.*` live in `i18n-look.js`.
4. Format money with `money()` and dates with `fmtDate()` / `fmtMonth()` from `public/js/ui.js` (they switch to `es-US`). Never build "$" + number by hand on a screen.
5. Escape everything you put in HTML with `esc()`. No inline scripts or `on*=` attributes (the CSP forbids them, and the i18n test checks).
6. Event and vendor type names are data keys (`"Quinceañera"`, `"Food truck"`). Show them with `t("event." + e)` / `t("type." + x)`, and add both translations when you add a type.

## Tone

- **Spanish**:
  - Warm and plain, the way a Mexican-American family or a working musician talks: "tu fiesta", "reservar", "anticipo/depósito", "padrinos", "quince".
  - Use "tú" for customers. Avoid Spain-only words ("vale", "ordenador") and stiff legal phrasing.
- **English**: short and friendly. Use the families' own words where they are better ("quinceañera", "serenata", "padrinos", "mañanitas").
- **Both**:
  - Short sentences for older readers.
  - One action per button, a verb first: "Ver fechas y reservar".
- **Errors**: say what happened and what to do next. Never show raw codes.

## Checklist for a change

- [ ] Every new string exists in EN and ES; `npm test` is green.
- [ ] Switch the language on the screen (the 🌐 row in the Menu) and read it in Spanish on a phone-width window: nothing overflows, nothing is left in English.
- [ ] Notifications: added to `TEMPLATES` with `en` and `es`; the recipient's language is used, not the sender's.
- [ ] New category, type or event: `t("type.*")` / `t("event.*")` and `ES_EVENTS` updated.
- [ ] A native speaker reviews new copy: run `npm run spanish-sheet` and send `docs/spanish-review.md`.

## Verify

```bash
cd bellas-musica
node --test test/i18n.test.js test/email.test.js
npm run spanish-sheet                         # regenerates docs/spanish-review.md for a native speaker
NODE_PATH=$(npm root -g) node e2e/e2e16.mjs    # welcome page incl. Spanish
NODE_PATH=$(npm root -g) node e2e/e2e18.mjs    # words per category in both languages
```

## How errors are translated (since Oct 14, 2026)

- `public/js/api.js` sends `X-Lang` (the screen's language) with every call and has its own Spanish for "Connection problem".
- `server/app.js` answers every `HttpError` through `translateError(message, requestLang(req), status)` (`server/errors-es.js`):
  - exact messages first, then patterns for messages carrying names and numbers, then the field names used by `str`/`int`/`oneOf`;
  - Stripe's own English becomes a Spanish line.
- **When you add an `HttpError` message, add its Spanish to `errors-es.js`.** `test/errors-es.test.js` reads every throw in `server/` and fails otherwise. Do the same for a new field name in an input check.
- New screen strings for the plan live in `public/js/i18n-plan.js` (`EN7`/`ES7`).
- Still for a person to do: a native speaker reads the new Spanish (`npm run spanish-sheet`).
