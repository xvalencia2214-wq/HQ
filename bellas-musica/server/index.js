// The server. With TRYOUT=1 it runs the test drive instead (practice accounts, pretend money): that's how the free
// practice copy online starts (render-tryout.yaml), with the same start command as the real site.
if (process.env.TRYOUT === "1") await import("./tryout.js");
else await import("./main.js");
