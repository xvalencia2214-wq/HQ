(function () {
  "use strict";

  var DEPOSIT_PCT = 0.25;
  var app = document.getElementById("app");

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dkey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage blocked: demo still works for this session */ }
  }
  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function groupById(id) { return GROUPS.filter(function (g) { return g.id === id; })[0]; }

  // ---------- availability (demo: generated, minus anything already requested) ----------
  function bookedSet(groupId) {
    var set = {};
    load("bm_requests", []).forEach(function (r) {
      if (r.groupId === groupId) set[r.date + "|" + r.time] = true;
    });
    return set;
  }
  function slotsFor(group, date) {
    var h = hash(group.id + dkey(date));
    var dow = date.getDay();
    var openChance = (dow === 5 || dow === 6 || dow === 0) ? 62 : 38;
    if (h % 100 >= openChance) return [];
    var booked = bookedSet(group.id), d = dkey(date);
    return SLOTS.filter(function (s, i) {
      return ((h >> (i + 3)) & 1) === 1 && !booked[d + "|" + s];
    });
  }

  // ---------- views ----------
  function setNav(route) {
    Array.prototype.forEach.call(document.querySelectorAll("#nav a"), function (a) {
      a.classList.toggle("on", a.getAttribute("data-r") === route);
    });
  }

  function viewHome(params) {
    setNav("home");
    var zip = (params.get("zip") || "").trim();
    var maxPrice = params.get("max") || "";
    var type = params.get("type") || "";
    var sort = params.get("sort") || "rating";

    var zipButtons = Object.keys(ZIPS).map(function (z) {
      return '<button type="button" data-zip="' + z + '">' + z + " · " + esc(ZIPS[z].city) + "</button>";
    }).join("");

    var html = '<section class="hero"><h1>Find the music for your fiesta</h1>' +
      "<p>Search local mariachis, bandas and more by ZIP code. See prices, open dates and book with a deposit.</p>" +
      '<form class="search" id="zipform"><input id="zip" inputmode="numeric" maxlength="5" placeholder="Your ZIP code" value="' + esc(zip) + '" aria-label="ZIP code">' +
      '<button class="btn" type="submit">Search</button></form>' +
      '<div class="demo-zips">Demo ZIPs: ' + zipButtons + "</div></section>";

    if (zip) {
      var origin = ZIPS[zip];
      if (!origin) {
        html += '<div class="panel empty">The demo only covers the ZIP codes above. A real version would use a full ZIP database.</div>';
      } else {
        var list = GROUPS.map(function (g) {
          return { g: g, d: miles(origin, ZIPS[g.zip]) };
        }).filter(function (x) { return x.d <= 60; });
        if (maxPrice) list = list.filter(function (x) { return x.g.rate <= Number(maxPrice); });
        if (type) list = list.filter(function (x) { return x.g.type === type; });
        list.sort(function (a, b) {
          if (sort === "price") return a.g.rate - b.g.rate;
          if (sort === "distance") return a.d - b.d;
          return b.g.rating - a.g.rating || b.g.reviews - a.g.reviews;
        });
        list = list.slice(0, 20);

        var types = ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ"];
        html += "<h2>Top groups near " + esc(origin.city) + "</h2>" +
          '<form class="bar" id="filters">' +
          '<div><label>Type</label><select id="f-type"><option value="">All</option>' +
          types.map(function (t) { return '<option' + (t === type ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select></div>" +
          '<div><label>Max price / hour</label><select id="f-max"><option value="">Any</option>' +
          [250, 350, 500, 900].map(function (p) { return '<option value="' + p + '"' + (String(p) === maxPrice ? " selected" : "") + ">Up to " + money(p) + "</option>"; }).join("") + "</select></div>" +
          '<div><label>Sort by</label><select id="f-sort">' +
          [["rating", "Top rated"], ["price", "Lowest price"], ["distance", "Closest"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sort ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div></form>";

        if (!list.length) {
          html += '<div class="panel empty">No groups match those filters within 60 miles.</div>';
        } else {
          html += '<div class="grid">' + list.map(function (x, i) {
            var g = x.g;
            return '<article class="card"><span class="rank">#' + (i + 1) + "</span>" +
              "<h3>" + esc(g.name) + "</h3>" +
              '<div class="meta"><span class="stars">★ ' + g.rating.toFixed(1) + "</span><span>(" + g.reviews + ')</span><span class="tag">' + esc(g.type) + "</span></div>" +
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
    document.getElementById("zipform").addEventListener("submit", function (e) { e.preventDefault(); go(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-zip]"), function (b) {
      b.addEventListener("click", function () { document.getElementById("zip").value = b.getAttribute("data-zip"); go(); });
    });
    var filters = document.getElementById("filters");
    if (filters) {
      filters.addEventListener("change", function () {
        go({ type: document.getElementById("f-type").value, max: document.getElementById("f-max").value, sort: document.getElementById("f-sort").value });
      });
    }
  }

  function viewGroup(id) {
    setNav("home");
    var g = groupById(id);
    if (!g) { app.innerHTML = '<div class="panel empty">Group not found. <a href="#/">Back to search</a></div>'; return; }
    var city = ZIPS[g.zip].city;
    var state = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), date: null, time: null };
    var chatKey = "bm_chat_" + g.id;

    app.innerHTML = '<a class="back" href="#/">← Back to results</a>' +
      '<div class="panel"><h2>' + esc(g.name) + '</h2>' +
      '<div class="meta"><span class="stars">★ ' + g.rating.toFixed(1) + "</span><span>(" + g.reviews + ' reviews)</span><span class="tag">' + esc(g.type) + "</span><span>" + esc(city) + "</span><span>" + g.members + " members</span></div>" +
      '<h3 style="margin-top:14px;font-size:1.05rem">Our story</h3><p style="margin:6px 0 0">' + esc(g.story) + "</p></div>" +
      '<div class="two"><div class="panel" id="calpanel"></div>' +
      '<div><div class="panel"><h2>Request this group</h2><div id="bookbox"></div></div>' +
      '<div class="panel"><h2>Message the manager</h2><div class="chat" id="chat"></div>' +
      '<form class="chat-form" id="chatform"><input id="chatin" placeholder="Ask about songs, location, setup…" maxlength="300"><button class="btn dark" type="submit">Send</button></form>' +
      '<div class="note">The manager\'s phone number is never shown. Everything goes through the app.</div></div></div></div>';

    function drawCal() {
      var m = state.month, first = new Date(m.getFullYear(), m.getMonth(), 1);
      var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var html = '<div class="cal-head"><button class="btn ghost" id="prev" aria-label="Previous month">‹</button><h3>' +
        m.toLocaleString("en-US", { month: "long", year: "numeric" }) +
        '</h3><button class="btn ghost" id="next" aria-label="Next month">›</button></div><div class="cal">';
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { html += '<div class="dow">' + d + "</div>"; });
      for (var b = 0; b < first.getDay(); b++) html += '<div class="day blank"></div>';
      for (var d = 1; d <= days; d++) {
        var date = new Date(m.getFullYear(), m.getMonth(), d);
        var open = date >= today && slotsFor(g, date).length > 0;
        var cls = "day" + (open ? " open" : "") + (state.date === dkey(date) ? " sel" : "");
        html += '<button type="button" class="' + cls + '" data-d="' + dkey(date) + '"' + (open ? "" : " disabled") + ">" + d + "</button>";
      }
      html += '</div><div class="legend">White days with a gold border are open. Tap one to see times.</div>';
      if (state.date) {
        var parts = state.date.split("-");
        var sd = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        html += '<div class="slots">' + slotsFor(g, sd).map(function (s) {
          return '<button type="button" class="slot' + (state.time === s ? " sel" : "") + '" data-t="' + esc(s) + '">' + esc(s) + "</button>";
        }).join("") + "</div>";
      }
      var box = document.getElementById("calpanel");
      box.innerHTML = '<h2>Open dates &amp; times</h2>' + html;
      document.getElementById("prev").onclick = function () { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); drawCal(); };
      document.getElementById("next").onclick = function () { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); drawCal(); };
      Array.prototype.forEach.call(box.querySelectorAll(".day.open"), function (btn) {
        btn.onclick = function () { state.date = btn.getAttribute("data-d"); state.time = null; drawCal(); drawBook(); };
      });
      Array.prototype.forEach.call(box.querySelectorAll(".slot"), function (btn) {
        btn.onclick = function () { state.time = btn.getAttribute("data-t"); drawCal(); drawBook(); };
      });
    }

    function drawBook() {
      var box = document.getElementById("bookbox");
      if (!state.date || !state.time) {
        box.innerHTML = '<div class="empty" style="padding:14px 0">Pick an open date and time to start your request.</div>';
        return;
      }
      box.innerHTML = '<form id="bookform"><div class="sum"><span>Date</span><span>' + esc(state.date) + " · " + esc(state.time) + "</span></div>" +
        '<label for="ev">Event</label><select id="ev">' + EVENT_TYPES.map(function (e) { return "<option>" + esc(e) + "</option>"; }).join("") + "</select>" +
        '<label for="hrs">Hours of music</label><select id="hrs">' + [1, 2, 3, 4].map(function (h) { return '<option value="' + h + '"' + (h === 2 ? " selected" : "") + ">" + h + " hour" + (h > 1 ? "s" : "") + "</option>"; }).join("") + "</select>" +
        '<label for="nm">Your name</label><input id="nm" required maxlength="60" autocomplete="name">' +
        '<label for="ph">Your phone (kept private, only used for your booking)</label><input id="ph" required inputmode="tel" maxlength="20" autocomplete="tel">' +
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
        if (slotsFor(g, new Date(state.date + "T00:00:00")).indexOf(state.time) === -1) {
          alert("That time was just taken. Please pick another."); state.time = null; drawCal(); drawBook(); return;
        }
        var total = g.rate * Number(hrs.value);
        var reqs = load("bm_requests", []);
        reqs.unshift({
          id: String(Date.now()), groupId: g.id, groupName: g.name, date: state.date, time: state.time,
          event: document.getElementById("ev").value, hours: Number(hrs.value),
          name: document.getElementById("nm").value.trim(), addr: document.getElementById("addr").value.trim(),
          message: document.getElementById("msg").value.trim(), total: total, deposit: total * DEPOSIT_PCT, status: "Requested"
        });
        save("bm_requests", reqs);
        box.innerHTML = '<div class="note ok"><strong>Request saved.</strong> In a real version the group would confirm and your deposit would be collected. See it under <a href="#/requests">My bookings</a>.</div>';
        state.date = null; state.time = null; drawCal();
      });
    }

    function drawChat() {
      var msgs = load(chatKey, []);
      var el = document.getElementById("chat");
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
        return '<div class="req"><div><strong>' + esc(r.groupName) + "</strong> <span class=\"badge\">" + esc(r.status) + "</span><br>" +
          esc(r.event) + " · " + esc(r.date) + " · " + esc(r.time) + " · " + r.hours + " hr<br><span style=\"color:var(--ink-2)\">" + esc(r.addr) + "</span></div>" +
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

  function viewPromote() {
    setNav("promote");
    app.innerHTML = '<h2 style="margin-bottom:12px">For groups</h2>' +
      '<div class="panel"><p style="margin-top:0">Get listed, show your open dates, and take deposits. Promoted spots appear at the top of local search.</p>' +
      '<form id="pform"><label for="gn">Group name</label><input id="gn" required maxlength="80">' +
      '<label for="gt">Type of music</label><select id="gt">' + ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ", "Other"].map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select>" +
      '<label for="gz">ZIP code</label><input id="gz" required inputmode="numeric" maxlength="5">' +
      '<label for="gc">Best way to reach the person in charge</label><input id="gc" required maxlength="100">' +
      '<label for="gs">Your story (how you started)</label><textarea id="gs" maxlength="500"></textarea>' +
      '<label><input type="checkbox" id="gp" style="width:auto"> I want to be promoted</label>' +
      '<div class="note">Demo: this saves in your browser only. Nothing is submitted anywhere.</div>' +
      '<button class="btn" type="submit">Submit (demo)</button></form><div id="pdone"></div></div>';
    document.getElementById("pform").addEventListener("submit", function (e) {
      e.preventDefault();
      var list = load("bm_applications", []);
      list.push({ name: document.getElementById("gn").value.trim(), type: document.getElementById("gt").value, zip: document.getElementById("gz").value.trim(), promote: document.getElementById("gp").checked });
      save("bm_applications", list);
      document.getElementById("pdone").innerHTML = '<div class="note ok">Saved locally. Thanks!</div>';
      e.target.reset();
    });
  }

  // ---------- router ----------
  function route() {
    var raw = location.hash.replace(/^#/, "") || "/";
    var qi = raw.indexOf("?");
    var path = qi === -1 ? raw : raw.slice(0, qi);
    var params = new URLSearchParams(qi === -1 ? "" : raw.slice(qi + 1));
    window.scrollTo(0, 0);
    var m;
    if ((m = path.match(/^\/group\/([\w-]+)$/))) viewGroup(m[1]);
    else if (path === "/requests") viewRequests();
    else if (path === "/promote") viewPromote();
    else viewHome(params);
  }
  window.addEventListener("hashchange", route);
  route();
})();
