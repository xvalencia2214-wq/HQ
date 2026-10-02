import { HttpError, str } from "../util.js";

// The browser reports its own crashes here so you hear about them. No IP, account or browser details are kept: just what broke
// and on which screen (only the first part of the address, so a reset or claim link never gets copied into an alert).
export default function telemetryRoutes(ctx, add) {
  add("POST", "/api/client-error", ({ body, ip }) => {
    if (!ctx.limiters.clientError.check(ip)) throw new HttpError(429, "Too many reports");
    const message = str(body.message, "message", { required: true, max: 300 }).replace(/\s+/g, " ");
    const screen = String(body.route || "").replace(/^#?\/?/, "").split(/[/?]/)[0].replace(/[^\w-]/g, "").slice(0, 30) || "home";
    const file = String(body.source || "").replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").slice(0, 80);
    const line = Number.isInteger(body.line) ? body.line : "";
    ctx.alert(`Browser error on #/${screen}: ${message}${file ? ` (${file}${line !== "" ? ":" + line : ""})` : ""}`, `client|${message.slice(0, 60)}`);
    return { ok: true };
  });
}
