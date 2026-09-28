import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.js";
import { createStripe } from "./stripe.js";
import { createSms } from "./sms.js";
import { userFromRequest } from "./auth.js";
import { HttpError, readBody, readJson, createLimiter } from "./util.js";
import { MIME_BY_EXT } from "./media.js";
import { expirePending } from "./shared.js";
import { seedDemo } from "./seed.js";
import { startJobs } from "./jobs.js";
import authRoutes from "./routes/auth.js";
import searchRoutes from "./routes/search.js";
import groupRoutes from "./routes/groups.js";
import bookingRoutes from "./routes/bookings.js";
import messageRoutes from "./routes/messages.js";
import reviewRoutes from "./routes/reviews.js";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon"
};

function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler, opts = {}) {
      const keys = [];
      const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
      routes.push({ method, re, keys, handler, opts });
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
      return { pathMatched };
    }
  };
}

export function createApp(config) {
  const db = openDb(config);
  const stripe = createStripe(config);
  const sms = createSms(config, db);
  const L = config.limits;
  const ctx = { config, db, stripe, sms, limiters: {
    api: createLimiter({ windowMs: 60_000, max: L.api }),
    auth: createLimiter({ windowMs: 15 * 60_000, max: L.auth }),
    register: createLimiter({ windowMs: 60 * 60_000, max: L.register }),
    chat: createLimiter({ windowMs: 60_000, max: L.chat }),
    upload: createLimiter({ windowMs: 60 * 60_000, max: L.upload }),
    booking: createLimiter({ windowMs: 60 * 60_000, max: L.booking })
  } };
  if (config.demoSeed) seedDemo(db);

  const router = createRouter();
  for (const mod of [authRoutes, searchRoutes, groupRoutes, bookingRoutes, messageRoutes, reviewRoutes]) mod(ctx, router.add);

  const clientIp = (req) => {
    if (config.trustProxy) {
      const xf = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (xf.length) return xf[xf.length - 1]; // last hop is the one our own proxy appended
    }
    return req.socket.remoteAddress || "unknown";
  };
  const isSecure = (req) => config.baseUrl.startsWith("https://") || (config.trustProxy && req.headers["x-forwarded-proto"] === "https");

  ctx.isSecure = isSecure;

  function securityHeaders(res, req) {
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
      "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"
    ].join("; "));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isSecure(req)) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
  }

  function serveFile(res, file, { cache }) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { sendJson(res, 404, { error: "Not found" }); return; }
      const ext = path.extname(file).toLowerCase();
      const type = TYPES[ext] || MIME_BY_EXT[ext.slice(1)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": cache });
      fs.createReadStream(file).pipe(res);
    });
  }

  function serveStatic(req, res, pathname) {
    let root = config.publicDir, rel = pathname, cache = "no-cache";
    if (pathname.startsWith("/uploads/")) { root = config.uploadDir; rel = pathname.slice("/uploads".length); cache = "public, max-age=86400"; }
    else if (pathname.startsWith("/vendor/")) cache = "public, max-age=604800";
    if (rel === "/") rel = "/index.html";
    const file = path.resolve(root, "." + rel);
    if (file !== root && !file.startsWith(root + path.sep)) { sendJson(res, 404, { error: "Not found" }); return; }
    serveFile(res, file, { cache });
  }

  async function handleApi(req, res, url) {
    const method = req.method === "HEAD" ? "GET" : req.method;
    const ip = clientIp(req);
    if (!ctx.limiters.api.check(ip)) throw new HttpError(429, "Too many requests. Please slow down.");
    const { route, params, pathMatched } = router.match(method, url.pathname);
    if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Method not allowed" : "Not found");

    // CSRF: cookies are SameSite=Lax; also refuse cross-site browser writes and non-JSON bodies.
    if (method !== "GET" && !route.opts.raw) {
      const origin = req.headers.origin;
      if (origin) {
        let host = ""; try { host = new URL(origin).host; } catch { /* bad origin */ }
        if (host !== req.headers.host) throw new HttpError(403, "Cross-site request blocked");
      }
      const ct = String(req.headers["content-type"] || "");
      if (Number(req.headers["content-length"] || 0) > 0 && !ct.startsWith("application/json")) throw new HttpError(415, "Send JSON");
    }

    const user = userFromRequest(db, req);
    if (route.opts.auth && !user) throw new HttpError(401, "Please log in");
    let body = {};
    if (method !== "GET") body = route.opts.raw ? await readBody(req, 1_000_000) : await readJson(req, route.opts.limit || 100_000);
    const query = Object.fromEntries(url.searchParams);
    const out = await route.handler({ req, res, params, query, body, user, ip, ctx });
    if (!res.writableEnded) sendJson(res, 200, out ?? { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res, req);
    try {
      const url = new URL(req.url, "http://x");
      if (url.pathname.startsWith("/api/")) { await handleApi(req, res, url); return; }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, "Bad URL"); }
      serveStatic(req, res, pathname);
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, ...e.extra });
      else { console.error(e); sendJson(res, 500, { error: "Something went wrong" }); }
    }
  });

  const stopJobs = startJobs(ctx);
  expirePending(db);
  return {
    server, ctx,
    listen: (port = config.port) => new Promise((r) => server.listen(port, () => r(server.address().port))),
    close: () => new Promise((r) => { stopJobs(); server.close(() => { db.raw.close(); r(); }); server.closeAllConnections?.(); })
  };
}
