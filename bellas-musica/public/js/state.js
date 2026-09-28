import { api } from "./api.js";

export const state = { user: null, meta: null, metaAt: 0 };
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export async function init() {
  const [me, meta] = await Promise.all([api.get("/api/me"), api.get("/api/meta")]);
  state.user = me.user;
  state.meta = meta;
  state.metaAt = Date.now();
  emit();
}

// The date rolls over at midnight; refresh it if the tab has been open a while.
export async function refreshMetaIfStale() {
  if (Date.now() - state.metaAt < 10 * 60_000) return;
  try { state.meta = await api.get("/api/meta"); state.metaAt = Date.now(); } catch { /* keep the old value */ }
}
export function setUser(u) { state.user = u; emit(); }
