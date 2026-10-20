// Mi Oficina, the owner's private AI office (see server/office.js). Owner only: everyone else gets a 404.
import { HttpError, int, str } from "../util.js";

export default function officeRoutes(ctx, add) {
  const busy = (user) => { if (!ctx.limiters.office.check(`u${user.id}`)) throw new HttpError(429, "Your office needs a short break. Try again in a few minutes."); };

  add("GET", "/api/admin/office", ({ user }) => { ctx.office.admin(user); return ctx.office.view(); });

  // Start a desk now; it works in the background and the screen checks back.
  add("POST", "/api/admin/office/run", ({ body, user }) => {
    ctx.office.admin(user); busy(user);
    const desk = str(body.desk, "Desk", { required: true, max: 20 });
    if (!ctx.office.deskIds.includes(desk)) throw new HttpError(400, "No such desk");
    if (ctx.office.mode === "off") throw new HttpError(400, "The office is off (AI_HELPER=0)");
    ctx.office.runDesk(desk).catch((e) => ctx.alert(`Mi Oficina run failed: ${e.message}`, "office|run"));
    return ctx.office.view();
  });

  add("POST", "/api/admin/office/drafts/:id", ({ params, body, user }) => {
    ctx.office.admin(user);
    const out = ctx.office.decide(user, int(params.id, "Draft", { min: 1 }), {
      action: body.action,
      subject: body.subject === undefined ? undefined : str(body.subject, "Subject", { max: 160 }),
      body: body.body === undefined ? undefined : str(body.body, "Message", { max: 3000 })
    });
    return { ...out, office: ctx.office.view() };
  });

  add("POST", "/api/admin/office/chat", async ({ body, user }) => {
    ctx.office.admin(user); busy(user);
    return ctx.office.chat(user, ctx.office.readTurns(body));
  }, { limit: 64_000 });

  add("POST", "/api/admin/office/memory", ({ body, user }) => {
    ctx.office.admin(user);
    const r = ctx.office.remember("owner", str(body.text, "Note", { min: 1, max: 400, required: true }));
    if (r.error) throw new HttpError(400, r.error);
    return ctx.office.view();
  });

  add("DELETE", "/api/admin/office/memory/:id", ({ params, user }) => {
    ctx.office.admin(user);
    ctx.office.forget(int(params.id, "Note", { min: 1 }));
    return ctx.office.view();
  });
}
