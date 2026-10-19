// Don Chuy, the AI helper (see server/helper.js). One question at a time; the screen keeps the conversation.
import { HttpError } from "../util.js";

export default function helperRoutes(ctx, add) {
  add("POST", "/api/helper", async ({ body, user, ip, req }) => {
    if (!ctx.limiters.helper.check(ip) || (user && !ctx.limiters.helper.check(`u${user.id}`))) throw new HttpError(429, "Don Chuy needs a short break. Try again in a few minutes.");
    const turns = ctx.helper.readTurns(body);
    return ctx.helper.ask({ turns, lang: body.lang === "es" ? "es" : "en", big: body.big === true, page: ctx.helper.validPage(body.page), user, req, ip });
  }, { limit: 64_000 });
}
