export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The screen's language (i18n.js keeps it on <html lang>), so the server answers errors in it.
const uiLang = () => (document.documentElement.lang === "es" ? "es" : "en");
const CONNECTION = { en: "Connection problem. Please try again.", es: "Problema de conexión. Intenta de nuevo." };

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method, credentials: "same-origin",
      headers: { "X-Lang": uiLang(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch { throw new ApiError(0, CONNECTION[uiLang()]); } // no signal, or the page was left mid-request: not a crash
  let json = null, unreadable = false;
  try { json = await res.json(); } catch { unreadable = res.ok && res.status !== 204; } // e.g. the page was reloaded mid-request
  if (!res.ok) {
    // A 401 on anything but the login form means the session ended: let the app send the user to log in.
    if (res.status === 401 && !url.startsWith("/api/auth/") && !url.startsWith("/api/me")) window.dispatchEvent(new CustomEvent("bm:unauth"));
    throw new ApiError(res.status, (json && json.error) || `Error ${res.status}`);
  }
  if (unreadable) throw new ApiError(0, CONNECTION[uiLang()]);
  return json;
}

export const api = {
  get: (u) => call("GET", u),
  post: (u, b = {}) => call("POST", u, b),
  put: (u, b = {}) => call("PUT", u, b),
  patch: (u, b = {}) => call("PATCH", u, b),
  del: (u) => call("DELETE", u)
};
