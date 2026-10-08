// Client limits (spec 2026-10-08). The server enforces them; these helpers let the app say
// the same thing before a write, and render usage on the Clients console. null = Unlimited.
export const LIMIT_MIN = { users: 2, accounts: 5 };

export const limitMessage = (kind, limit) =>
  `Your plan allows ${limit} ${kind} — contact OneVio to raise it.`;

export const roomLeft = (limit, used) => (limit == null ? Infinity : Math.max(0, limit - used));

export const isOverLimit = (used, limit) => limit != null && used > limit;

export const usageLabel = (used, limit) => `${used} / ${limit == null ? "∞" : limit}`;

export function parseLimit(unlimited, raw, min) {
  if (unlimited) return { value: null, error: null };
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return { value: null, error: "Enter a whole number, or tick Unlimited." };
  const n = Number(s);
  if (n < min) return { value: null, error: `Must be at least ${min}.` };
  return { value: n, error: null };
}
