import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp(config);
const port = await app.listen();
const { stripe, sms } = app.ctx;
console.log(`Bella's Música running at ${config.baseUrl} (port ${port})`);
console.log(`Payments: ${stripe.mode}${stripe.live ? "" : "  (no STRIPE_SECRET_KEY: deposits are simulated)"}`);
console.log(`Texts:    ${sms.mode}${sms.live ? "" : "  (no Twilio settings: messages are only logged)"}`);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.close().then(() => process.exit(0)));
