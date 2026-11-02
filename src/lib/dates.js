export const DAY = 86400000;
export const today = () => new Date();
export const iso = d => new Date(d).toISOString().slice(0, 10);
export const addDays = n => iso(Date.now() + n * DAY);
export const daysUntil = d => Math.ceil((new Date(d) - Date.now()) / DAY);
export const daysSince = d => Math.floor((Date.now() - new Date(d)) / DAY);
export const isoMinus = (dateStr, days) => iso(new Date(dateStr).getTime() - days * DAY);
export const isoPlus = (dateStr, days) => iso(new Date(dateStr).getTime() + days * DAY);
// "Mon Nov 2" for a date-only ISO string, read in UTC so it names the same day the ISO says.
export const fmtDayHint = d => new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).replace(",", "");
export const fmtDate = d => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
/* textual, like isoPlus — setMonth() would overflow month-end (Jan 31 +1 = Mar 3) and mix local time into UTC-parsed dates */
export const addMonths = (dateStr, m) => {
  const [y, mo, day] = dateStr.slice(0, 10).split("-").map(Number);
  const t = mo - 1 + m, ty = y + Math.floor(t / 12), tm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};
