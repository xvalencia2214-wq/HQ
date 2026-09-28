import { api } from "./api.js";

export const state = { user: null, meta: null };
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export async function init() {
  const [me, meta] = await Promise.all([api.get("/api/me"), api.get("/api/meta")]);
  state.user = me.user;
  state.meta = meta;
  emit();
}
export function setUser(u) { state.user = u; emit(); }
