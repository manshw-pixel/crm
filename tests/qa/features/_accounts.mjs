// Shared helpers for the account list and account detail (src/20-account-list.jsx,
// src/21-account-detail.jsx). Not a feature: `scenarios` is empty so run.mjs can load it.
import { nav } from "./_users-card.mjs";
export const scenarios = [];

// Accounts list filtered by `q`; returns the filtered count from the sr-only results region (:203).
export async function searchCount(page, q) {
  await nav(page, "Accounts").click();
  await page.getByPlaceholder(/^Search/).fill(q);
  await page.waitForTimeout(400);
  const t = await page.locator('[data-live="results"]').textContent();
  return +(/(\d+) accounts/.exec(t || "")?.[1] ?? NaN);
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
