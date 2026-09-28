import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

test("share pages: photo card tags, hostile names are escaped, hidden groups don't leak", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base);
    await owner.signup("sh@example.com", "Share Owner");
    const nasty = `Los "Reyes" <script>alert(1)</script> & Co`;
    const id = await makeGroup(owner, { name: nasty, zip: "60608" });
    await owner.patch(`/api/groups/${id}`, { story: `Story with "quotes" and <b>tags</b> ${"long ".repeat(80)}` });
    const res = await fetch(S.base + `/g/${id}`);
    // the page uses <base href="/">, so the CSP must allow a same-origin base or its assets 404 under /g/
    assert.match(res.headers.get("content-security-policy"), /base-uri 'self'/);
    let html = await res.text();
    assert.match(html, /<meta property="og:title" content="Los &quot;Reyes&quot; &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Co · Mariachi in Chicago, IL">/);
    assert.match(html, /og:image" content="[^"]*\/uploads\/[\w-]+\.png"/); // makeGroup gave it a photo
    assert.match(await (await fetch(S.base + "/g/los-gallos-de-oro")).text(), /og:image" content="[^"]*\/og\.png"/); // a sample group has none: the default card
    assert.doesNotMatch(html, /<script>alert\(1\)/); assert.doesNotMatch(html, /<b>tags<\/b>/);
    assert.match(html, /<base href="\/">/); assert.match(html, /<main id="app"><div class="panel"><h1>Los &quot;Reyes&quot;/);
    const desc = html.match(/og:description" content="([^"]*)"/)[1];
    assert.ok(desc.length <= 260, "description is trimmed");
    await owner.post(`/api/groups/${id}/photos`, { data: PNG });
    html = await (await fetch(S.base + `/g/${id}`)).text();
    assert.match(html, /og:image" content="[^"]*\/uploads\/[\w-]+\.png"/);
    // the app shell is intact so the page still boots from /g/<id>
    assert.match(html, /<script type="module" src="js\/main\.js">/);
    // unknown and hidden groups get the generic page, never their details
    assert.doesNotMatch(await (await fetch(S.base + "/g/does-not-exist")).text(), /Reyes/);
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", id);
    html = await (await fetch(S.base + `/g/${id}`)).text();
    assert.doesNotMatch(html, /Reyes/); assert.match(html, /og:title" content="Bella&#39;s Música/);
    assert.equal((await client(S.base).get(`/api/groups/${id}`)).status, 404);
    assert.equal((await owner.get(`/api/groups/${id}`)).status, 200); // its own manager still sees it
    assert.ok(!(await client(S.base).get("/api/search?zip=60608")).json.results.some((g) => g.id === id));
    assert.equal((await client(S.base).get(`/api/groups/${id}/availability?month=${inDays(20).slice(0, 7)}`)).status, 404);
    S.db.run("UPDATE groups SET hidden = 0 WHERE id = ?", id);
    // best-of page
    const best = await (await fetch(S.base + "/b/77003")).text();
    assert.match(best, /Best mariachis and bands in Houston, TX/);
    assert.match(await (await fetch(S.base + "/b/00000")).text(), /og:title" content="Bella&#39;s Música/);
  } finally { await S.close(); }
});

test("robots, sitemap, manifest and preview image", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base); await owner.signup("sm@example.com", "Site Map");
    const real = await makeGroup(owner, { name: "Mapped Band", zip: "77003" });
    const hidden = await makeGroup(owner, { name: "Secret Band", zip: "77003" });
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", hidden);
    const robots = await (await fetch(S.base + "/robots.txt")).text();
    assert.match(robots, /Disallow: \/api\//); assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
    const map = await (await fetch(S.base + "/sitemap.xml")).text();
    assert.match(map, new RegExp(`/g/${real}<`)); assert.match(map, /\/b\/77003</);
    assert.doesNotMatch(map, new RegExp(hidden)); assert.doesNotMatch(map, /los-gallos-de-oro/); // sample groups are not advertised
    const man = await fetch(S.base + "/manifest.webmanifest");
    assert.match(man.headers.get("content-type"), /manifest\+json/); assert.equal((await man.json()).display, "standalone");
    const og = await fetch(S.base + "/og.png"); assert.equal(og.status, 200); assert.equal(og.headers.get("content-type"), "image/png");
    const buf = Buffer.from(await og.arrayBuffer()); assert.equal(buf.readUInt32BE(16), 1200); assert.equal(buf.readUInt32BE(20), 630);
  } finally { await S.close(); }
});
