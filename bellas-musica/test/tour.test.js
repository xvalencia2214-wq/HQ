import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays } from "./helpers.js";
import { parseTour, tourEmbedUrl } from "../server/media.js";

const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

test("virtual tour links: Matterport, Kuula, 360° YouTube/Vimeo accepted; anything else refused; only ids are embedded", () => {
  assert.deepEqual(parseTour("https://my.matterport.com/show/?m=SxQL3iGyoDo"), { provider: "matterport", id: "SxQL3iGyoDo" });
  assert.deepEqual(parseTour("my.matterport.com/show?m=SxQL3iGyoDo&play=1"), { provider: "matterport", id: "SxQL3iGyoDo" });
  assert.deepEqual(parseTour("https://kuula.co/share/7lVbT"), { provider: "kuula", id: "7lVbT" });
  assert.deepEqual(parseTour("https://kuula.co/post/7lVbT"), { provider: "kuula", id: "7lVbT" });
  assert.deepEqual(parseTour("https://kuula.co/share/collection/7lVbT?logo=1"), { provider: "kuula", id: "c:7lVbT" });
  assert.deepEqual(parseTour("https://youtu.be/dQw4w9WgXcQ"), { provider: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseTour("https://vimeo.com/123456789"), { provider: "vimeo", id: "123456789" });
  assert.deepEqual(parseTour(""), { provider: "", id: "" }, "empty clears it");
  for (const bad of ["https://evil.example/show/?m=SxQL3iGyoDo", "https://my.matterport.com/show/?m=bad", "https://my.matterport.com/other/?m=SxQL3iGyoDo",
    "https://kuula.co/share/collection/", "https://kuula.co/profile/someone", "https://www.tiktok.com/@a/video/7312345678901234567", "javascript:alert(1)", "not a link at all"])
    assert.equal(parseTour(bad), null, bad);
  assert.equal(tourEmbedUrl("matterport", "SxQL3iGyoDo"), "https://my.matterport.com/show/?m=SxQL3iGyoDo");
  assert.equal(tourEmbedUrl("kuula", "c:7lVbT"), "https://kuula.co/share/collection/7lVbT");
  assert.equal(tourEmbedUrl("youtube", "dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(tourEmbedUrl("matterport", "x\"><script>"), "", "a bad stored id embeds nothing");
});

test("a venue adds, shows and removes its virtual tour; the page may frame the tour sites; Spanish error", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), anon = client(S.base), other = client(S.base);
    await o.signup("tour-o@example.com", "Salón Owner"); await other.signup("tour-x@example.com", "Someone Else");
    const c = await o.post("/api/groups", { name: "Salón El Jardín", type: "Party hall", zip: "60608", members: 3, story: "Party hall for 250 guests with a dance floor, kitchen and parking." });
    assert.equal(c.status, 200); const id = c.json.id;
    assert.equal(c.json.tour, null);

    const set = await o.patch(`/api/groups/${id}`, { tour_url: "https://my.matterport.com/show/?m=SxQL3iGyoDo" });
    assert.equal(set.status, 200); assert.deepEqual(set.json.tour, { provider: "matterport", url: "https://my.matterport.com/show/?m=SxQL3iGyoDo" });
    const bad = await o.patch(`/api/groups/${id}`, { tour_url: "https://example.com/tour" });
    assert.equal(bad.status, 400); assert.match(bad.json.error, /Matterport, Kuula, YouTube or Vimeo/);
    const badEs = await o.raw("PATCH", `/api/groups/${id}`, { tour_url: "https://example.com/tour" }, { "X-Lang": "es" });
    assert.equal(badEs.status, 400); assert.match(badEs.json.error, /recorrido virtual/);
    assert.equal((await other.patch(`/api/groups/${id}`, { tour_url: "https://kuula.co/share/7lVbT" })).status >= 400, true, "only the owner can change it");

    // everyone sees it on the public page, as the embed address (never the text as typed)
    await o.patch(`/api/groups/${id}`, { events: ["Quinceañera", "Wedding"] });
    await o.post(`/api/groups/${id}/photos`, { data: TINY_PNG });
    await o.put(`/api/groups/${id}/availability`, { dates: { [inDays(30)]: ["6:00 PM"] } });
    await o.post(`/api/groups/${id}/packages`, { name: "Saturday night", description: "Hall for 6 hours", hours: 6, price: 2500 });
    const pub = await o.post(`/api/groups/${id}/publish`); assert.equal(pub.status, 200, JSON.stringify(pub.json));
    assert.equal((await anon.get(`/api/groups/${id}`)).json.tour.url, "https://my.matterport.com/show/?m=SxQL3iGyoDo");
    const card = (await anon.get("/api/search?zip=60608&category=venues")).json.results.find((g) => g.id === id);
    assert.ok(card && card.tour, "search cards know there is a tour");

    // the browser is allowed to show the tour sites (and only adds those two)
    const csp = (await fetch(S.base + "/")).headers.get("content-security-policy");
    assert.match(csp, /frame-src [^;]*https:\/\/my\.matterport\.com/); assert.match(csp, /frame-src [^;]*https:\/\/kuula\.co/);

    // empty box + save removes it
    assert.equal((await o.patch(`/api/groups/${id}`, { tour_url: "" })).json.tour, null);
    assert.equal((await anon.get(`/api/groups/${id}`)).json.tour, null);
  } finally { await S.close(); }
});
