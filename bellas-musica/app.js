(function () {
  "use strict";

  var DEPOSIT_PCT = 0.25;
  var app = document.getElementById("app");
  var mapInstance = null;

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dkey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseKey(k) { var p = k.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function startOfToday() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage blocked: demo works for this session only */ }
  }
  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // ---------- groups: built-in demo groups + ones created in the dashboard, plus manager overrides ----------
  function getOver(id) { return load("bm_over_" + id, {}); }
  function setOver(id, o) { save("bm_over_" + id, o); }
  function eff(g) {
    var o = getOver(g.id), r = {};
    Object.keys(g).forEach(function (k) { r[k] = g[k]; });
    if (o.rate) r.rate = o.rate;
    if (o.story != null) r.story = o.story;
    r.promoted = !!o.promoted;
    return r;
  }
  function allGroups() { return GROUPS.concat(load("bm_custom_groups", [])).map(eff); }
  function groupById(id) { return allGroups().filter(function (g) { return g.id === id; })[0]; }
  function ratingHtml(g) {
    return g.reviews ? '<span class="stars">★ ' + g.rating.toFixed(1) + "</span><span>(" + g.reviews + ")</span>" : '<span class="stars">★ New</span>';
  }

  // ---------- availability ----------
  function generatedSlots(group, date) {
    var h = hash(group.id + dkey(date));
    var dow = date.getDay();
    var openChance = (dow === 5 || dow === 6 || dow === 0) ? 62 : 38;
    if (h % 100 >= openChance) return [];
    return SLOTS.filter(function (s, i) { return ((h >> (i + 3)) & 1) === 1; });
  }
  function baseSlots(group, date) {
    var o = getOver(group.id);
    if (o.avail) return (o.avail[dkey(date)] || []).slice();
    return generatedSlots(group, date);
  }
  function bookedSet(groupId) {
    var set = {};
    load("bm_requests", []).forEach(function (r) {
      if (r.groupId === groupId && r.status !== "Declined") set[r.date + "|" + r.time] = true;
    });
    return set;
  }
  function slotsFor(group, date) {
    var booked = bookedSet(group.id), d = dkey(date);
    return baseSlots(group, date).filter(function (s) { return !booked[d + "|" + s]; });
  }
  // Manager edits switch a demo group from generated dates to its own saved calendar.
  function ensureOwnCalendar(g) {
    var o = getOver(g.id);
    if (o.avail) return o;
    o.avail = {};
    var t = startOfToday();
    for (var i = 0; i < 200; i++) {
      var d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i);
      var s = generatedSlots(g, d);
      if (s.length) o.avail[dkey(d)] = s;
    }
    setOver(g.id, o);
    return o;
  }

  // ---------- shared month calendar ----------
  // cfg.dayState(date) -> {enabled, open}; cfg.onPick(key); cfg.onMonth()
  function calendar(box, st, cfg) {
    var m = st.month, first = new Date(m.getFullYear(), m.getMonth(), 1);
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var html = '<div class="cal-head"><button type="button" class="btn ghost" data-nav="-1" aria-label="Previous month">‹</button><h3>' +
      m.toLocaleString("en-US", { month: "long", year: "numeric" }) +
      '</h3><button type="button" class="btn ghost" data-nav="1" aria-label="Next month">›</button></div><div class="cal">';
    ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { html += '<div class="dow">' + d + "</div>"; });
    for (var b = 0; b < first.getDay(); b++) html += '<div class="day blank"></div>';
    for (var d = 1; d <= days; d++) {
      var date = new Date(m.getFullYear(), m.getMonth(), d), s = cfg.dayState(date), k = dkey(date);
      html += '<button type="button" class="day' + (s.open ? " open" : "") + (st.date === k ? " sel" : "") + '" data-d="' + k + '"' + (s.enabled ? "" : " disabled") + ">" + d + "</button>";
    }
    box.innerHTML = html + "</div>";
    Array.prototype.forEach.call(box.querySelectorAll("[data-nav]"), function (btn) {
      btn.onclick = function () {
        st.month = new Date(m.getFullYear(), m.getMonth() + Number(btn.getAttribute("data-nav")), 1);
        cfg.onMonth();
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll(".day[data-d]:not([disabled])"), function (btn) {
      btn.onclick = function () { cfg.onPick(btn.getAttribute("data-d")); };
    });
  }

  // ---------- views ----------
  function setNav(route) {
    Array.prototype.forEach.call(document.querySelectorAll("#nav a"), function (a) {
      a.classList.toggle("on", a.getAttribute("data-r") === route);
    });
  }
  function killMap() { if (mapInstance) { mapInstance.remove(); mapInstance = null; } }

  function jitter(id) {
    var h = hash(id);
    return { lat: ((h % 1000) / 1000 - 0.5) * 0.06, lon: (((h >> 10) % 1000) / 1000 - 0.5) * 0.06 };
  }

  function drawMap(list, origin) {
    var box = document.getElementById("map");
    if (typeof L === "undefined") { box.innerHTML = '<div class="empty">The map could not load. Use the list view.</div>'; return; }
    L.Icon.Default.imagePath = "vendor/leaflet/images/";
    mapInstance = L.map(box, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapInstance);
    var bounds = [[origin.lat, origin.lon]];
    L.circleMarker([origin.lat, origin.lon], { radius: 9, color: "#141210", weight: 3, fillColor: "#d4a84a", fillOpacity: 1 })
      .addTo(mapInstance).bindTooltip("Your ZIP");
    list.forEach(function (x, i) {
      var z = ZIPS[x.g.zip], j = jitter(x.g.id), pos = [z.lat + j.lat, z.lon + j.lon];
      bounds.push(pos);
      L.marker(pos, { title: x.g.name }).addTo(mapInstance).bindPopup(
        "<strong>#" + (i + 1) + " " + esc(x.g.name) + "</strong><br>" + esc(x.g.type) + " · from " + money(x.g.rate) + "/hr<br>" +
        '<a href="#/group/' + esc(x.g.id) + '">See dates &amp; book</a>');
    });
    mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }

  function viewHome(params) {
    setNav("home");
    var zip = (params.get("zip") || "").trim();
    var maxPrice = params.get("max") || "";
    var type = params.get("type") || "";
    var sort = params.get("sort") || "rating";
    var view = params.get("view") === "map" ? "map" : "list";

    var zipButtons = Object.keys(ZIPS).map(function (z) {
      return '<button type="button" data-zip="' + z + '">' + z + " · " + esc(ZIPS[z].city) + "</button>";
    }).join("");

    var html = '<section class="hero"><img class="hero-logo" src="logo.svg" alt=""><h1>Find the music for your fiesta</h1>' +
      "<p>Search local mariachis, bandas and more by ZIP code. See prices, open dates and book with a deposit.</p>" +
      '<form class="search" id="zipform"><input id="zip" inputmode="numeric" maxlength="5" placeholder="Your ZIP code" value="' + esc(zip) + '" aria-label="ZIP code">' +
      '<button class="btn" type="submit">Search</button></form>' +
      '<div class="demo-zips">Demo ZIPs: ' + zipButtons + "</div></section>";

    var list = [];
    if (zip) {
      var origin = ZIPS[zip];
      if (!origin) {
        html += '<div class="panel empty">The demo only covers the ZIP codes above. A real version would use a full ZIP database.</div>';
      } else {
        list = allGroups().map(function (g) { return { g: g, d: miles(origin, ZIPS[g.zip]) }; })
          .filter(function (x) { return x.d <= 60; });
        if (maxPrice) list = list.filter(function (x) { return x.g.rate <= Number(maxPrice); });
        if (type) list = list.filter(function (x) { return x.g.type === type; });
        list.sort(function (a, b) {
          if (a.g.promoted !== b.g.promoted) return a.g.promoted ? -1 : 1;
          if (sort === "price") return a.g.rate - b.g.rate;
          if (sort === "distance") return a.d - b.d;
          return b.g.rating - a.g.rating || b.g.reviews - a.g.reviews;
        });
        list = list.slice(0, 20);

        var types = ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ"];
        html += '<div class="titlebar"><h2>Top groups near ' + esc(origin.city) + '</h2><div class="seg" role="group" aria-label="View">' +
          '<button type="button" data-view="list" class="' + (view === "list" ? "on" : "") + '">List</button>' +
          '<button type="button" data-view="map" class="' + (view === "map" ? "on" : "") + '">Map</button></div></div>' +
          '<form class="bar" id="filters">' +
          '<div><label for="f-type">Type</label><select id="f-type"><option value="">All</option>' +
          types.map(function (t) { return "<option" + (t === type ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select></div>" +
          '<div><label for="f-max">Max price / hour</label><select id="f-max"><option value="">Any</option>' +
          [250, 350, 500, 900].map(function (p) { return '<option value="' + p + '"' + (String(p) === maxPrice ? " selected" : "") + ">Up to " + money(p) + "</option>"; }).join("") + "</select></div>" +
          '<div><label for="f-sort">Sort by</label><select id="f-sort">' +
          [["rating", "Top rated"], ["price", "Lowest price"], ["distance", "Closest"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sort ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div></form>";

        if (!list.length) {
          html += '<div class="panel empty">No groups match those filters within 60 miles.</div>';
        } else if (view === "map") {
          html += '<div id="map" class="map" role="region" aria-label="Map of groups"></div>' +
            '<div class="legend">Pins show the general area, not exact addresses. Tap a pin to see the group.</div>';
        } else {
          html += '<div class="grid">' + list.map(function (x, i) {
            var g = x.g;
            return '<article class="card"><span class="rank">#' + (i + 1) + "</span>" + (g.promoted ? '<span class="feat">Featured</span>' : "") +
              "<h3>" + esc(g.name) + "</h3>" +
              '<div class="meta">' + ratingHtml(g) + '<span class="tag">' + esc(g.type) + "</span></div>" +
              '<div class="meta"><span class="price">From ' + money(g.rate) + "/hr</span><span>" + Math.round(x.d) + " mi away</span><span>" + g.members + " member" + (g.members > 1 ? "s" : "") + "</span></div>" +
              "<p>" + esc(g.story) + "</p>" +
              '<a class="btn" href="#/group/' + esc(g.id) + '">See dates &amp; book</a></article>';
          }).join("") + "</div>";
        }
      }
    }
    app.innerHTML = html;

    function go(extra) {
      var p = new URLSearchParams();
      var z = document.getElementById("zip").value.trim();
      if (z) p.set("zip", z);
      Object.keys(extra || {}).forEach(function (k) { if (extra[k]) p.set(k, extra[k]); });
      location.hash = "#/?" + p.toString();
    }
    function current() {
      var f = document.getElementById("f-type");
      return f ? { type: f.value, max: document.getElementById("f-max").value, sort: document.getElementById("f-sort").value, view: view } : { view: view };
    }
    document.getElementById("zipform").addEventListener("submit", function (e) { e.preventDefault(); go(current()); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-zip]"), function (b) {
      b.addEventListener("click", function () { document.getElementById("zip").value = b.getAttribute("data-zip"); go(current()); });
    });
    var filters = document.getElementById("filters");
    if (filters) filters.addEventListener("change", function () { go(current()); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (b) {
      b.addEventListener("click", function () { var c = current(); c.view = b.getAttribute("data-view"); go(c); });
    });
    if (list.length && view === "map") drawMap(list, ZIPS[zip]);
  }

  function viewGroup(id) {
    setNav("home");
    var g = groupById(id);
    if (!g) { app.innerHTML = '<div class="panel empty">Group not found. <a href="#/">Back to search</a></div>'; return; }
    var city = ZIPS[g.zip].city;
    var st = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), date: null, time: null };
    var chatKey = "bm_chat_" + g.id;

    app.innerHTML = '<a class="back" href="#/">← Back to results</a>' +
      '<div class="panel"><h2>' + esc(g.name) + (g.promoted ? ' <span class="feat inline">Featured</span>' : "") + "</h2>" +
      '<div class="meta">' + ratingHtml(g) + '<span class="tag">' + esc(g.type) + "</span><span>" + esc(city) + "</span><span>" + g.members + " member" + (g.members > 1 ? "s" : "") + "</span><span class=\"price\">From " + money(g.rate) + "/hr</span></div>" +
      '<h3 style="margin-top:14px;font-size:1.05rem">Our story</h3><p style="margin:6px 0 0">' + esc(g.story || "This group hasn't added a story yet.") + "</p></div>" +
      '<div class="two"><div class="panel"><h2>Open dates &amp; times</h2><div id="calbox"></div><div id="slotbox"></div>' +
      '<div class="legend">Days with a gold border are open. Tap one to see times.</div></div>' +
      '<div><div class="panel"><h2>Request this group</h2><div id="bookbox"></div></div>' +
      '<div class="panel"><h2>Message the manager</h2><div class="chat" id="chat"></div>' +
      '<form class="chat-form" id="chatform"><input id="chatin" placeholder="Ask about songs, location, setup…" maxlength="300" aria-label="Message"><button class="btn dark" type="submit">Send</button></form>' +
      '<div class="note">The manager\'s phone number is never shown. Everything goes through the app.</div></div></div></div>';

    function drawCal() {
      var today = startOfToday();
      calendar(document.getElementById("calbox"), st, {
        dayState: function (d) { var ok = d >= today && slotsFor(g, d).length > 0; return { enabled: ok, open: ok }; },
        onPick: function (k) { st.date = k; st.time = null; drawCal(); drawBook(); },
        onMonth: drawCal
      });
      var sb = document.getElementById("slotbox");
      sb.innerHTML = st.date ? '<div class="slots">' + slotsFor(g, parseKey(st.date)).map(function (s) {
        return '<button type="button" class="slot' + (st.time === s ? " sel" : "") + '" data-t="' + esc(s) + '">' + esc(s) + "</button>";
      }).join("") + "</div>" : "";
      Array.prototype.forEach.call(sb.querySelectorAll(".slot"), function (btn) {
        btn.onclick = function () { st.time = btn.getAttribute("data-t"); drawCal(); drawBook(); };
      });
    }

    function drawBook() {
      var box = document.getElementById("bookbox");
      if (!st.date || !st.time) {
        box.innerHTML = '<div class="empty" style="padding:14px 0">Pick an open date and time to start your request.</div>';
        return;
      }
      box.innerHTML = '<form id="bookform"><div class="sum"><span>Date</span><span>' + esc(st.date) + " · " + esc(st.time) + "</span></div>" +
        '<label for="ev">Event</label><select id="ev">' + EVENT_TYPES.map(function (e) { return "<option>" + esc(e) + "</option>"; }).join("") + "</select>" +
        '<label for="hrs">Hours of music</label><select id="hrs">' + [1, 2, 3, 4].map(function (h) { return '<option value="' + h + '"' + (h === 2 ? " selected" : "") + ">" + h + " hour" + (h > 1 ? "s" : "") + "</option>"; }).join("") + "</select>" +
        '<label for="nm">Your name</label><input id="nm" required maxlength="60" autocomplete="name">' +
        '<label for="ph">Your phone (shared with the group only after they confirm)</label><input id="ph" required inputmode="tel" maxlength="20" autocomplete="tel">' +
        '<label for="addr">Event location (city or venue)</label><input id="addr" required maxlength="100">' +
        '<label for="msg">Special requests</label><textarea id="msg" maxlength="400" placeholder="Songs, surprise timing, dress code…"></textarea>' +
        '<div id="tot"></div>' +
        '<div class="note">Demo only: no card is charged and no message is sent to the group.</div>' +
        '<button class="btn" type="submit" style="width:100%">Send request &amp; pay deposit (demo)</button></form>';
      var hrs = document.getElementById("hrs");
      function tot() {
        var total = g.rate * Number(hrs.value), dep = total * DEPOSIT_PCT;
        document.getElementById("tot").innerHTML =
          '<div class="sum"><span>Estimated total</span><span>' + money(total) + "</span></div>" +
          '<div class="sum"><span>Deposit today (' + (DEPOSIT_PCT * 100) + '%)</span><span>' + money(dep) + "</span></div>" +
          '<div class="sum"><span>Balance due to the group</span><span>' + money(total - dep) + "</span></div>";
      }
      hrs.addEventListener("change", tot); tot();
      document.getElementById("bookform").addEventListener("submit", function (e) {
        e.preventDefault();
        if (slotsFor(g, parseKey(st.date)).indexOf(st.time) === -1) {
          alert("That time was just taken. Please pick another."); st.time = null; drawCal(); drawBook(); return;
        }
        var total = g.rate * Number(hrs.value), reqs = load("bm_requests", []);
        reqs.unshift({
          id: String(Date.now()), groupId: g.id, groupName: g.name, date: st.date, time: st.time,
          event: document.getElementById("ev").value, hours: Number(hrs.value),
          name: document.getElementById("nm").value.trim(), phone: document.getElementById("ph").value.trim(),
          addr: document.getElementById("addr").value.trim(), message: document.getElementById("msg").value.trim(),
          total: total, deposit: total * DEPOSIT_PCT, status: "Requested"
        });
        save("bm_requests", reqs);
        box.innerHTML = '<div class="note ok"><strong>Request saved.</strong> In a real version the group would confirm and your deposit would be collected. See it under <a href="#/requests">My bookings</a>.</div>';
        st.date = null; st.time = null; drawCal();
      });
    }

    function drawChat() {
      var msgs = load(chatKey, []), el = document.getElementById("chat");
      el.innerHTML = msgs.length ? msgs.map(function (m) {
        return '<div class="msg ' + (m.me ? "me" : "them") + '">' + esc(m.text) + "</div>";
      }).join("") : '<div class="empty" style="padding:10px">No messages yet. Say hello.</div>';
      el.scrollTop = el.scrollHeight;
    }
    document.getElementById("chatform").addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = document.getElementById("chatin"), t = inp.value.trim();
      if (!t) return;
      var msgs = load(chatKey, []);
      msgs.push({ me: true, text: t });
      if (!msgs.some(function (m) { return !m.me; })) msgs.push({ me: false, text: "(Demo auto-reply) Thanks for reaching out! A real manager would answer here." });
      save(chatKey, msgs); inp.value = ""; drawChat();
    });

    drawCal(); drawBook(); drawChat();
  }

  function viewRequests() {
    setNav("requests");
    var reqs = load("bm_requests", []);
    var html = '<h2 style="margin-bottom:12px">My bookings</h2><div class="panel">';
    if (!reqs.length) {
      html += '<div class="empty">No booking requests yet. <a href="#/">Find a group</a></div>';
    } else {
      html += reqs.map(function (r) {
        return '<div class="req"><div><strong>' + esc(r.groupName) + '</strong> <span class="badge ' + esc(r.status.toLowerCase()) + '">' + esc(r.status) + "</span><br>" +
          esc(r.event) + " · " + esc(r.date) + " · " + esc(r.time) + " · " + r.hours + ' hr<br><span style="color:var(--ink-2)">' + esc(r.addr) + "</span></div>" +
          '<div style="text-align:right">' + money(r.total) + "<br><small>Deposit " + money(r.deposit) + '</small><br><button class="btn ghost" data-cancel="' + esc(r.id) + '">Cancel</button></div></div>';
      }).join("");
    }
    app.innerHTML = html + "</div>";
    Array.prototype.forEach.call(document.querySelectorAll("[data-cancel]"), function (b) {
      b.addEventListener("click", function () {
        save("bm_requests", load("bm_requests", []).filter(function (r) { return r.id !== b.getAttribute("data-cancel"); }));
        viewRequests();
      });
    });
  }

  // ---------- group dashboard (demo: no login, you pick which group you manage) ----------
  function viewDashboard() {
    setNav("dashboard");
    var myId = load("bm_mygroup", null);
    var g = myId ? groupById(myId) : null;
    if (!g) { dashboardStart(); return; }

    var st = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), date: null };
    app.innerHTML = '<div class="titlebar"><h2>' + esc(g.name) + ' <small class="dim">group dashboard</small></h2>' +
      '<button class="btn ghost" id="switch">Switch group</button></div>' +
      '<div class="note">Demo: no login. In the real app only the group\'s manager could open this page.</div>' +
      '<div id="reqbox" class="panel"></div>' +
      '<div class="two"><div class="panel"><h2>Your calendar</h2><div id="calbox"></div><div id="daybox"></div>' +
      '<div class="quick"><button class="btn ghost" id="fill">Open all weekends, next 8 weeks</button><button class="btn ghost" id="clear">Clear calendar</button></div>' +
      '<div class="legend">Gold-bordered days are open for booking. Tap a day to choose its time slots. Booked slots disappear from the public calendar.</div></div>' +
      '<div class="panel"><h2>Your listing</h2><form id="prof">' +
      '<label for="p-rate">Price per hour ($)</label><input id="p-rate" type="number" min="50" max="5000" step="5" required value="' + g.rate + '">' +
      '<label for="p-story">Your story (how you started)</label><textarea id="p-story" maxlength="500">' + esc(g.story) + "</textarea>" +
      '<label class="chk"><input type="checkbox" id="p-promo"' + (g.promoted ? " checked" : "") + '> Feature my group at the top of local search</label>' +
      '<div class="note">Demo: featuring is free. In the real app this would be a paid promotion, arranged with the person in charge.</div>' +
      '<button class="btn" type="submit">Save listing</button> <span id="saved" class="dim"></span></form>' +
      '<p style="margin:14px 0 0"><a href="#/group/' + esc(g.id) + '">View my public page →</a></p></div></div>' +
      '<p class="dim" style="text-align:center"><a href="#" id="reset">Reset all demo data in this browser</a></p>';

    function fresh() { return groupById(g.id); }
    function drawReqs() {
      var reqs = load("bm_requests", []).filter(function (r) { return r.groupId === g.id; });
      var box = document.getElementById("reqbox");
      box.innerHTML = "<h2>Booking requests</h2>" + (reqs.length ? reqs.map(function (r) {
        return '<div class="req"><div><strong>' + esc(r.event) + "</strong> · " + esc(r.date) + " · " + esc(r.time) + " · " + r.hours + " hr" +
          ' <span class="badge ' + esc(r.status.toLowerCase()) + '">' + esc(r.status) + "</span><br>" +
          esc(r.name) + " · " + esc(r.addr) + (r.status === "Confirmed" ? " · " + esc(r.phone) : "") +
          (r.message ? '<br><span class="dim">“' + esc(r.message) + "”</span>" : "") + "</div>" +
          '<div style="text-align:right">' + money(r.total) + "<br><small>Deposit " + money(r.deposit) + "</small>" +
          (r.status === "Requested" ? '<br><button class="btn" data-act="Confirmed" data-id="' + esc(r.id) + '">Accept</button> <button class="btn ghost" data-act="Declined" data-id="' + esc(r.id) + '">Decline</button>' : "") + "</div></div>";
      }).join("") : '<div class="empty">No requests yet. Requests made from the customer side in this browser show up here.</div>');
      Array.prototype.forEach.call(box.querySelectorAll("[data-act]"), function (b) {
        b.onclick = function () {
          var all = load("bm_requests", []);
          all.forEach(function (r) { if (r.id === b.getAttribute("data-id")) r.status = b.getAttribute("data-act"); });
          save("bm_requests", all); drawReqs(); drawCal();
        };
      });
    }
    function drawCal() {
      var today = startOfToday(), cur = fresh();
      calendar(document.getElementById("calbox"), st, {
        dayState: function (d) { return { enabled: d >= today, open: baseSlots(cur, d).length > 0 }; },
        onPick: function (k) { st.date = k; drawCal(); },
        onMonth: drawCal
      });
      var db = document.getElementById("daybox");
      if (!st.date) { db.innerHTML = ""; return; }
      var open = baseSlots(cur, parseKey(st.date)), booked = bookedSet(g.id);
      db.innerHTML = '<div class="dim" style="margin-top:10px">Time slots for ' + esc(st.date) + "</div><div class=\"slots\">" +
        SLOTS.map(function (s) {
          var isB = booked[st.date + "|" + s];
          return '<button type="button" class="slot' + (open.indexOf(s) !== -1 ? " sel" : "") + '" data-t="' + esc(s) + '"' + (isB ? " disabled" : "") + ">" + esc(s) + (isB ? " (booked)" : "") + "</button>";
        }).join("") + "</div>";
      Array.prototype.forEach.call(db.querySelectorAll(".slot:not([disabled])"), function (b) {
        b.onclick = function () {
          var o = ensureOwnCalendar(cur), s = b.getAttribute("data-t"), list = o.avail[st.date] || [];
          o.avail[st.date] = list.indexOf(s) === -1 ? SLOTS.filter(function (x) { return list.indexOf(x) !== -1 || x === s; }) : list.filter(function (x) { return x !== s; });
          if (!o.avail[st.date].length) delete o.avail[st.date];
          setOver(g.id, o); drawCal();
        };
      });
    }

    document.getElementById("fill").onclick = function () {
      var o = ensureOwnCalendar(fresh()), t = startOfToday();
      var firstOpened = null;
      for (var i = 0; i < 56; i++) {
        var d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i);
        if (d.getDay() === 5 || d.getDay() === 6 || d.getDay() === 0) {
          o.avail[dkey(d)] = SLOTS.slice();
          if (!firstOpened) firstOpened = d;
        }
      }
      setOver(g.id, o);
      if (firstOpened) st.month = new Date(firstOpened.getFullYear(), firstOpened.getMonth(), 1); // show what just opened
      st.date = null; drawCal();
    };
    document.getElementById("clear").onclick = function () {
      var o = getOver(g.id); o.avail = {}; setOver(g.id, o); drawCal();
    };
    document.getElementById("prof").addEventListener("submit", function (e) {
      e.preventDefault();
      var o = getOver(g.id);
      o.rate = Math.max(50, Math.min(5000, Number(document.getElementById("p-rate").value) || g.rate));
      o.story = document.getElementById("p-story").value.trim();
      o.promoted = document.getElementById("p-promo").checked;
      setOver(g.id, o);
      document.getElementById("saved").textContent = "Saved ✓";
    });
    document.getElementById("switch").onclick = function () { save("bm_mygroup", null); viewDashboard(); };
    document.getElementById("reset").onclick = function (e) {
      e.preventDefault();
      if (!confirm("Delete all demo bookings, chats, groups and calendar changes in this browser?")) return;
      try {
        Object.keys(localStorage).filter(function (k) { return k.indexOf("bm_") === 0; }).forEach(function (k) { localStorage.removeItem(k); });
      } catch (err) { /* storage blocked */ }
      location.hash = "#/"; route();
    };
    drawReqs(); drawCal();
  }

  function dashboardStart() {
    var groups = allGroups();
    app.innerHTML = '<h2 style="margin-bottom:12px">For groups</h2>' +
      '<p class="dim" style="margin-top:0">Get listed, set your price, choose your open dates and accept bookings.</p>' +
      '<div class="two"><div class="panel"><h2>Create your listing</h2><form id="newg">' +
      '<label for="n-name">Group name</label><input id="n-name" required maxlength="80">' +
      '<label for="n-type">Type of music</label><select id="n-type">' + ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ", "Other"].map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select>" +
      '<label for="n-zip">Home ZIP (demo ZIPs only)</label><select id="n-zip">' + Object.keys(ZIPS).map(function (z) { return '<option value="' + z + '">' + z + " · " + esc(ZIPS[z].city) + "</option>"; }).join("") + "</select>" +
      '<label for="n-mem">Number of musicians</label><input id="n-mem" type="number" min="1" max="30" value="5" required>' +
      '<label for="n-rate">Price per hour ($)</label><input id="n-rate" type="number" min="50" max="5000" step="5" value="300" required>' +
      '<label for="n-story">Your story (how you started)</label><textarea id="n-story" maxlength="500"></textarea>' +
      '<button class="btn" type="submit" style="margin-top:14px;width:100%">Create &amp; open dashboard</button></form></div>' +
      '<div class="panel"><h2>Or open a demo group</h2><p class="dim" style="margin-top:0">Try the manager view for one of the sample groups.</p>' +
      '<label for="pick">Group</label><select id="pick">' + groups.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>"; }).join("") + "</select>" +
      '<button class="btn dark" id="open" style="margin-top:14px;width:100%">Open dashboard</button></div></div>';
    document.getElementById("open").onclick = function () { save("bm_mygroup", document.getElementById("pick").value); viewDashboard(); };
    document.getElementById("newg").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = "custom-" + Date.now(), list = load("bm_custom_groups", []);
      list.push({
        id: id, name: document.getElementById("n-name").value.trim(), type: document.getElementById("n-type").value,
        zip: document.getElementById("n-zip").value, rate: Number(document.getElementById("n-rate").value),
        members: Number(document.getElementById("n-mem").value), rating: 0, reviews: 0,
        story: document.getElementById("n-story").value.trim()
      });
      save("bm_custom_groups", list);
      setOver(id, { avail: {}, promoted: false });
      save("bm_mygroup", id);
      viewDashboard();
    });
  }

  // ---------- router ----------
  function route() {
    var raw = location.hash.replace(/^#/, "") || "/";
    var qi = raw.indexOf("?");
    var path = qi === -1 ? raw : raw.slice(0, qi);
    var params = new URLSearchParams(qi === -1 ? "" : raw.slice(qi + 1));
    killMap();
    window.scrollTo(0, 0);
    var m;
    if ((m = path.match(/^\/group\/([\w-]+)$/))) viewGroup(m[1]);
    else if (path === "/requests") viewRequests();
    else if (path === "/dashboard" || path === "/promote") viewDashboard();
    else viewHome(params);
  }
  window.addEventListener("hashchange", route);
  route();
})();
