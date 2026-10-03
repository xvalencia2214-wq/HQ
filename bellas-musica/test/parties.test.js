import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

// A stand-in for api.weather.gov: /points -> forecast URL -> daily periods.
async function fakeWeather(date, rain = 70) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { "Content-Type": "application/geo+json" });
    if (req.url.startsWith("/points/")) res.end(JSON.stringify({ properties: { forecast: `http://127.0.0.1:${server.address().port}/gridpoints/LOT/1,1/forecast` } }));
    else res.end(JSON.stringify({ properties: { periods: [
      { name: "Saturday", startTime: `${date}T06:00:00-05:00`, isDaytime: true, temperature: 81, temperatureUnit: "F", shortForecast: "Chance Showers And Thunderstorms", probabilityOfPrecipitation: { value: rain } },
      { name: "Saturday Night", startTime: `${date}T18:00:00-05:00`, isDaytime: false, temperature: 66, temperatureUnit: "F", shortForecast: "Mostly Clear", probabilityOfPrecipitation: { value: 10 } }
    ] } }));
  });
  await new Promise((r) => server.listen(0, r));
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) };
}

test("saved party: budget against what's booked, family link with votes and comments, timeline that vendors see, privacy", async () => {
  const d = inDays(5);
  const W = await fakeWeather(d);
  const S = await startApp({ DEMO_SEED: "0", WEATHER_API_BASE: W.base });
  try {
    const owner = client(S.base), mo = client(S.base), other = client(S.base), anon = client(S.base), cousin = client(S.base);
    await owner.signup("pt-o@example.com", "Rosa Martinez"); await mo.signup("pt-m@example.com", "Music Owner"); await other.signup("pt-x@example.com", "Someone Else");
    const g1 = await makeGroup(mo, { name: "Mariachi Fiesta", dates: [d] });
    const g2 = await makeGroup(mo, { name: "Banda Dos", dates: [d] });

    // create: validation, then a party with a budget and a template
    assert.equal((await anon.post("/api/parties", { date: d, zip: "60608" })).status, 401);
    for (const bad of [{ date: "2020-01-01", zip: "60608" }, { date: d, zip: "00000" }, { date: d, zip: "60608", budget: -1 }, { date: d, zip: "60608", needs: "music" }, { date: d, zip: "60608", template: "rave" }, { date: d, zip: "60608", event: "Nope" }])
      assert.equal((await owner.post("/api/parties", bad)).status, 400, JSON.stringify(bad));
    const made = await owner.post("/api/parties", { title: "Quince de Sofía", event: "Quinceañera", date: d, zip: "60608", guests: 150, budget: 5000, template: "quince", needs: ["music", "food", "rentals", "bogus"] });
    assert.equal(made.status, 200);
    const P = made.json.party;
    assert.deepEqual(P.needs, ["music", "food", "rentals"]);
    assert.equal(P.money.booked_cents, 0); assert.equal(P.money.left_cents, 500000);
    assert.match(P.share_url, /#\/fp\/[\w-]{20,}/);
    const token = P.share_url.split("/fp/")[1];
    assert.equal((await other.get(`/api/parties/${P.id}`)).status, 404); // someone else's party
    assert.equal((await owner.get("/api/my/parties")).json.parties.length, 1);

    // book a vendor that day: it becomes part of the party and counts against the budget
    const bk = (await owner.post("/api/bookings", bookingBody(g1, d, { hours: 3 }))).json.booking;
    let v = (await owner.get(`/api/parties/${P.id}`)).json.party;
    assert.equal(v.vendors.length, 1); assert.equal(v.vendors[0].status, "unpaid");
    assert.equal(v.money.booked_cents, 0); // an unpaid hold doesn't count yet
    await owner.post(`/api/bookings/${bk.id}/simulate-pay`);
    v = (await owner.get(`/api/parties/${P.id}`)).json.party;
    assert.equal(v.money.booked_cents, 90000); assert.equal(v.money.paid_cents, bk.deposit_cents); assert.equal(v.money.left_cents, 500000 - 90000);
    assert.deepEqual(v.booked_categories, ["music"]);
    assert.equal(v.money.by_category.music, 90000);
    // a booking on another date is not part of it
    await owner.post("/api/bookings", bookingBody(g2, d, { time: "4:00 PM" }));
    assert.equal((await owner.get(`/api/parties/${P.id}`)).json.party.vendors.length, 2);

    // timeline: validation, linking a vendor, and the vendor sees the arrival time
    const tl = (items) => owner.put(`/api/parties/${P.id}/timeline`, { items });
    assert.equal((await tl([{ at: "25:00", label: "x" }])).status, 400);
    assert.equal((await tl([{ at: "18:00", label: "" }])).status, 400);
    assert.equal((await tl([{ at: "18:00", label: "Music", bookingId: "b_not_mine" }])).status, 400);
    assert.equal((await tl("nope")).status, 400);
    const ok = await tl([{ at: "19:30", label: "Mariachi entrance", bookingId: bk.id }, { at: "18:00", label: "Guests arrive, call 312-555-0100" }]);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.party.timeline.map((t) => t.at), ["18:00", "19:30"]);
    assert.ok(!ok.json.party.timeline[0].label.includes("555-0100")); // phone numbers are masked
    assert.equal(ok.json.party.timeline[1].vendor, "Mariachi Fiesta");
    await mo.patch(`/api/bookings/${bk.id}`, { action: "accept" });
    const forGroup = (await mo.get(`/api/groups/${g1}/bookings`)).json.bookings.find((b) => b.id === bk.id);
    assert.deepEqual(forGroup.arrival, { at: "19:30", label: "Mariachi entrance" });

    // picks, votes and comments: owner and family (no account), with privacy
    assert.equal((await owner.post(`/api/parties/${P.id}/picks`, { groupId: g2 })).status, 200);
    assert.equal((await owner.post(`/api/parties/${P.id}/picks`, { groupId: "nope" })).status, 404);
    const fam = (await anon.get(`/api/fp/${token}?voter=cousin-123456`)).json.party;
    assert.equal(fam.title, "Quince de Sofía"); assert.equal(fam.host, "Rosa");
    assert.equal(fam.money, undefined); assert.equal(fam.budget_cents, undefined); assert.equal(fam.share_url, undefined);
    assert.ok(!JSON.stringify(fam).includes("Casa Blanca") && !JSON.stringify(fam).includes("555-0142")); // no address or phone on the family link
    assert.equal(fam.vendors[0].paid_cents, undefined);
    assert.equal((await anon.get("/api/fp/not-a-real-token-xxxxxxxxxx")).status, 404);
    const vote = (voter) => cousin.post(`/api/fp/${token}/vote`, { groupId: g2, voter });
    assert.equal((await vote("x")).status, 400);
    assert.equal((await vote("cousin-123456")).json.party.picks[0].votes, 1);
    assert.equal((await cousin.post(`/api/fp/${token}/vote`, { groupId: g1, voter: "cousin-123456" })).status, 400); // not on the list
    assert.equal((await vote("tia-abcdefgh")).json.party.picks[0].votes, 2);
    const again = await vote("cousin-123456"); // voting again takes the vote back
    assert.equal(again.json.party.picks[0].votes, 1); assert.equal(again.json.party.picks[0].my_vote, false);
    const c1 = await cousin.post(`/api/fp/${token}/comments`, { name: "Tía Lupe", text: "Me gusta esta banda! call me 773-555-0199", groupId: g2 });
    assert.equal(c1.status, 200);
    const cm = c1.json.party.picks[0].comments[0];
    assert.equal(cm.name, "Tía Lupe"); assert.ok(!cm.text.includes("555-0199"));
    assert.equal((await cousin.post(`/api/fp/${token}/comments`, { name: "", text: "hi" })).status, 400);
    assert.equal((await cousin.post(`/api/fp/${token}/comments`, { name: "Primo", text: "x".repeat(301) })).status, 400);
    assert.equal((await cousin.post(`/api/fp/${token}/picks`, { groupId: g1, name: "Primo Beto" })).json.party.picks.length, 2);
    // owner moderates
    assert.equal((await owner.del(`/api/parties/${P.id}/comments/${cm.id}`)).json.party.picks.find((p) => p.id === g2).comments.length, 0);
    // a new link turns off the old one
    const rotated = (await owner.post(`/api/parties/${P.id}/share`)).json.party.share_url;
    assert.notEqual(rotated, P.share_url);
    assert.equal((await anon.get(`/api/fp/${token}`)).status, 404);

    // weather for a date within a week (from the weather service), nothing for far dates
    const w = (await owner.get(`/api/parties/${P.id}/weather`)).json.weather;
    assert.equal(w.available, true); assert.equal(w.rain, 70); assert.equal(w.temp, 81); assert.match(w.short, /Showers/);
    assert.ok(W.hits[0].startsWith("/points/41."));
    const far = (await owner.post("/api/parties", { date: inDays(40), zip: "60608" })).json.party;
    assert.equal((await owner.get(`/api/parties/${far.id}/weather`)).json.weather.reason, "far");

    // thanks page: off by default, on when the host allows it, shows only vendor names
    assert.equal((await anon.get(`/api/thanks/${P.id}`)).status, 404);
    await owner.patch(`/api/parties/${P.id}`, { credits_public: true });
    const th = (await anon.get(`/api/thanks/${P.id}`)).json.party;
    assert.deepEqual(th.vendors.map((x) => x.group_name), ["Mariachi Fiesta"]); // the unpaid hold isn't listed
    assert.ok(!JSON.stringify(th).includes("total_cents") && th.date === undefined && th.month === d.slice(0, 7));

    // editing and deleting
    assert.equal((await owner.patch(`/api/parties/${P.id}`, { budget: 6000, guests: 180 })).json.party.money.left_cents, 600000 - 90000);
    assert.equal((await other.del(`/api/parties/${P.id}`)).status, 404);
    assert.equal((await owner.del(`/api/parties/${P.id}`)).status, 200);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM party_comments WHERE party_id = ?", P.id).c, 0);
  } finally { await S.close(); await W.close(); }
});

test("price guide and last-minute search", async () => {
  const S = await startApp({ DEMO_SEED: "1", WEATHER: "0" });
  try {
    const anon = client(S.base);
    const g = (await anon.get("/api/price-guide?category=rentals")).json.guide;
    assert.equal(g.source, "listings"); assert.ok(g.low <= g.mid && g.mid <= g.high && g.low > 0);
    assert.equal((await anon.get("/api/price-guide?category=nope")).status, 400);
    assert.equal((await anon.get("/api/price-guide?category=venues")).json.guide, null); // too few listings to say
    const soon = (await anon.get("/api/search?zip=60608&soon=1")).json.results;
    assert.ok(soon.every((r) => r.open_soon && r.open_soon > S.ctx.db.get("SELECT date('now') d").d.slice(0, 4)));
    const all = (await anon.get("/api/search?zip=60608")).json.results;
    assert.ok(soon.length <= all.length);
  } finally { await S.close(); }
});
