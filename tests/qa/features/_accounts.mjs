// Shared helpers for the account list and account detail (src/20-account-list.jsx,
// src/21-account-detail.jsx). Not a feature: `scenarios` is empty so run.mjs can load it.
import { nav } from "./_users-card.mjs";
export const scenarios = [];

// Accounts list filtered by `q`; returns the filtered count from the sr-only results region (:203).
// Settles first: the search box holds `q`, the count equals the rendered rows (or the list is
// windowed, >100 rows), and two reads >= 300ms apart agree -- so a stale count can't be returned.
export async function searchCount(page, q, timeoutMs = 15000) {
  await nav(page, "Accounts").click();
  const box = page.getByPlaceholder(/^Search/);
  await box.waitFor({ timeout: 15000 });
  await box.fill(q);
  const read = () => page.evaluate(q => {
    const box = [...document.querySelectorAll("input")].find(i => /^Search/.test(i.placeholder || ""));
    const m = /(\d+) accounts/.exec(document.querySelector('[data-live="results"]')?.textContent || "");
    if (!box || box.value !== q || !m) return null;
    const n = +m[1], rows = document.querySelectorAll("tr[data-account-row]").length;
    const windowed = !!document.querySelector("[data-row-spacer]");
    return windowed || rows === n ? n : null;
  }, q);
  const until = Date.now() + timeoutMs;
  let prev = await read();
  while (Date.now() < until) {
    await page.waitForTimeout(300);
    // The nav click resets the list's filters (src/26-app.jsx resetAccounts); if that reset
    // lands after our fill, the box is cleared -- type the query again rather than wait forever.
    if ((await box.inputValue()) !== q) { await box.fill(q); prev = null; continue; }
    const cur = await read();
    if (cur != null && cur === prev) return cur;
    prev = cur;
  }
  throw new Error(`account count for "${q}" did not settle`);
}

// Open an account by its exact name from the list; waits for the detail heading.
export async function openAccount(page, name) {
  await nav(page, "Accounts").click();
  await page.getByPlaceholder(/^Search/).fill(name);
  await page.locator("tr[data-account-row]").filter({ has: page.getByText(name, { exact: true }) }).first().click({ timeout: 15000 });
  await page.getByRole("heading", { level: 2, name, exact: true }).waitFor({ timeout: 15000 });
}

// A header-card stat's value line ("ARR", "Renewal", "CSM"), src/21-account-detail.jsx:106-117.
export const stat = (page, label) =>
  page.locator("[data-header-card] .min-w-0").filter({ has: page.getByText(label, { exact: true }) }).first().locator("> div").nth(1);

// The app's own formatters (global in the built page) so expected text matches the UI exactly.
export const fmtMoneyIn = (page, n, cur) => page.evaluate(([n, cur]) => fmtMoney(n, cur), [n, cur]);
export const fmtDateIn = (page, iso) => page.evaluate(iso => fmtDate(iso), iso);

// ISO date `n` days from today, local calendar (same basis as reset.mjs's dmy()).
export const isoPlus = n => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// An AccountForm control by its visible label (F wraps the text and a div holding the control,
// src/13-forms.jsx:240), so getByLabel's accessible name also includes the control's value.
export const field = (page, label) => page.locator("form label")
  .filter({ hasText: new RegExp(`^${label.replace(/[*.]/g, "\\$&")}`) }).first().locator("input, select").first();
