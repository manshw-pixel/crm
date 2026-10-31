import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { SkipScenario } from "../core.mjs";
import { searchCount, openAccount, stat, fmtMoneyIn, field, isoPlus } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";

const F = "04-accounts";
// "QA <runId>-m Manual": still starts "QA qa-" so the next reset deletes it, but NOT "QA <runId> "
// (with the space), so it is not counted among the 15 seeded run accounts by 05/07/09.
const manual = runId => `QA ${runId}-m Manual`;
// Smallest well-formed-enough PDF; built in memory, never written to disk.
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

// Create the run's manual account through "+ New account" (src/13-forms.jsx AccountForm)
// unless an earlier scenario (or attempt) already did. Returns the account name.
async function ensureManual(page, runId, arr = 5000) {
  const name = manual(runId);
  if (await searchCount(page, name) === 0) {
    await page.getByRole("button", { name: "+ New account" }).click();
    await field(page, "Name *").fill(name);
    await field(page, "ARR").fill(String(arr));
    await page.getByRole("button", { name: "Create account" }).click();
    await waitForSaved(page);
  }
  return name;
}

export const scenarios = [
  { id: `${F}/create-edit`, feature: F, title: "Create an account, edit its ARR, value survives reload", role: "admin",
    run: async ({ page, thisRunId: runId }) => {
      const name = await ensureManual(page, runId);
      assert.equal(await searchCount(page, name), 1, "created account not listed");
      await openAccount(page, name);
      const arr = 7001 + Math.floor(Math.random() * 998); // never 5000, the create value
      await page.getByRole("button", { name: "✎ Edit account" }).click();
      await field(page, "ARR").fill(String(arr));
      await page.getByRole("button", { name: "Save changes" }).click();
      await waitForSaved(page);
      await page.reload();
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await openAccount(page, name);
      assert.equal((await stat(page, "ARR").textContent()).trim(), await fmtMoneyIn(page, arr, "USD"), "ARR after reload");
      // The header rounds to K; the edit form holds the exact stored value.
      await page.getByRole("button", { name: "✎ Edit account" }).click();
      assert.equal(await field(page, "ARR").inputValue(), String(arr), "stored ARR after reload");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    } },

  { id: `${F}/contact`, feature: F, title: "Add a contact, then delete it", role: "admin",
    run: async ({ page, thisRunId: runId }) => {
      const name = await ensureManual(page, runId);
      await openAccount(page, name);
      const who = `QA ${runId} Contact ${Date.now() % 100000}`;
      await page.locator("[data-more-actions]").click();
      await page.getByRole("menuitem", { name: "+ Contact" }).click();
      const form = page.locator("[data-contact-form]");
      await form.getByPlaceholder("Name *").fill(who);
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await waitForSaved(page);
      const row = page.locator("[data-contact-row]").filter({ has: page.locator("[data-delete-contact]") }).filter({ hasText: who });
      await row.waitFor({ timeout: 10000 });
      await row.locator("[data-delete-contact]").click();
      await page.locator("[data-confirm-go]").click();
      await waitForSaved(page);
      await row.waitFor({ state: "detached", timeout: 10000 });
    } },

  { id: `${F}/touchpoint`, feature: F, title: "Log a call; it appears in the activity timeline", role: "admin",
    run: async ({ page, thisRunId: runId }) => {
      const name = await ensureManual(page, runId);
      await openAccount(page, name);
      const summary = `QA ${runId} call ${Date.now() % 100000}`;
      await page.getByRole("button", { name: "+ Log activity" }).click();
      await page.getByPlaceholder("Summary…").fill(summary);
      await page.getByRole("button", { name: "Log", exact: true }).click();
      await waitForSaved(page);
      // The timeline row: type word ([data-activity-type]) + summary carrying this run's id.
      const entry = page.locator("[data-activity-row]").filter({ has: page.getByText(summary, { exact: true }) }).first();
      await entry.waitFor({ timeout: 10000 });
      assert.equal((await entry.locator("[data-activity-type]").first().textContent()).trim(), "call", "logged activity is not a call");
    } },

  { id: `${F}/attachment`, feature: F, title: "Upload a PDF; opening it yields a working signed URL", role: "admin",
    run: async ({ page, context, thisRunId: runId }) => {
      const name = await ensureManual(page, runId);
      await openAccount(page, name);
      const summary = `QA ${runId} attach ${Date.now() % 100000}`, file = `qa-${runId}.pdf`;
      await page.getByRole("button", { name: "+ Log activity" }).click();
      await page.getByPlaceholder("Summary…").fill(summary);
      await page.locator('form input[type="file"][multiple]').setInputFiles({ name: file, mimeType: "application/pdf", buffer: PDF });
      await page.getByRole("button", { name: "Log", exact: true }).click();
      await waitForSaved(page);
      const entry = page.locator("[data-activity-row]").filter({ hasText: summary }).first();
      const link = entry.locator("a[data-attachment]").filter({ hasText: file });
      await link.waitFor({ timeout: 30000 });
      const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
      await popup.waitForURL(/token=/, { timeout: 20000 });
      const res = await context.request.get(popup.url());
      assert.equal(res.status(), 200, "signed URL did not return 200");
      await popup.close();
      // Remove the attachment from the activity (the UI has no delete for the stored object itself).
      await entry.getByRole("button", { name: "Edit activity" }).click();
      await page.getByRole("button", { name: "Remove attachment" }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await waitForSaved(page);
      await link.waitFor({ state: "detached", timeout: 10000 });
    } },

  // Never raises or changes limits: only asserts the message when the org is already full.
  { id: `${F}/account-limit-at-cap`, feature: F, title: "Create is blocked with the plan message when the org is at its account limit", role: "admin",
    run: async ({ page, thisRunId: runId }) => {
      await nav(page, "Accounts").click();
      const r = await page.evaluate(async () => {
        const o = await sb.from("orgs").select("max_accounts");
        const a = await sb.from("accounts").select("id", { count: "exact", head: true });
        return o.error || a.error || !o.data || o.data.length !== 1 ? null : { lim: o.data[0].max_accounts, used: a.count };
      });
      if (!r) throw new Error("could not read the org's account limit/count");
      if (r.lim == null) throw new SkipScenario("org has no account limit — limit message not exercised");
      if (r.used < r.lim) throw new SkipScenario(`org has room (${r.used}/${r.lim} accounts) — limit message not exercised`);
      await page.getByRole("button", { name: "+ New account" }).click();
      await field(page, "Name *").fill(`QA ${runId} OverLimit`);
      await page.getByRole("button", { name: "Create account" }).click();
      await page.locator("[data-limit-error]").filter({ hasText: `Your plan allows ${r.lim} accounts` }).waitFor({ timeout: 10000 });
    } },

  { id: `${F}/account-limit`, feature: F, title: "Set max accounts = current count; create is blocked", role: "admin",
    skip: "not exercised: limits are set from the client console (platform admin only), which the QA agent never changes",
    run: async () => {} },

  // ---- UI Stage 3 (restyled accounts list): quick pills, flag severity, Industry sort ----
  { id: `${F}/quick-pill-at-risk`, feature: F, title: "quick pill At risk filters list", role: "admin",
    run: async ({ page }) => {
      await nav(page, "Accounts").click();
      const pill = page.locator('[data-quick="risk"]');
      await pill.waitFor({ timeout: 15000 });
      const n = +(await pill.locator("[data-quick-count]").textContent());
      if (n === 0) throw new SkipScenario("no at-risk (Red) accounts in this org — pill filter not exercised");
      await pill.click();
      await page.waitForFunction(() => document.querySelector('[data-quick="risk"]').getAttribute("aria-pressed") === "true", null, { timeout: 5000 });
      await page.waitForFunction(() => { const r = [...document.querySelectorAll("[data-account-row] [data-risk]")]; return r.length > 0 && r.every(e => e.getAttribute("data-risk") === "Red"); }, null, { timeout: 10000 });
      assert.equal(await page.getByLabel("Filter by health risk").inputValue(), "Red", "health dropdown not set to Red");
      assert.equal(await page.locator('[data-quick="all"]').getAttribute("aria-pressed"), "false", "All still pressed");
      await page.locator('[data-quick="all"]').click();
      await page.waitForFunction(() => document.querySelector('[data-quick="risk"]').getAttribute("aria-pressed") === "false", null, { timeout: 5000 });
    } },

  { id: `${F}/flag-pills-severity`, feature: F, title: "flag pills show severity", role: "admin",
    run: async ({ page, thisRunId: runId }) => {
      const name = `QA ${runId}-f Flag`; // like manual(): reset-deletable, not counted among the seeded run accounts
      if (await searchCount(page, name) === 0) {
        await page.getByRole("button", { name: "+ New account" }).click();
        await field(page, "Name *").fill(name);
        await field(page, "ARR").fill("4000");
        await field(page, "Renewal date").fill(isoPlus(10)); // < 30d: a red "Renewal in Nd" flag
        await page.getByRole("button", { name: "Create account" }).click();
        await waitForSaved(page);
      }
      assert.equal(await searchCount(page, name), 1, "flag account not listed");
      const row = page.locator("tr[data-account-row]").filter({ has: page.getByText(name, { exact: true }) }).first();
      const flag = row.locator("[data-flag][data-sev]").filter({ hasText: /^Renewal in \d+d/ }).first();
      await flag.waitFor({ timeout: 10000 });
      assert.equal(await flag.getAttribute("data-sev"), "red", "renewal <30d flag is not red");
    } },

  { id: `${F}/industry-sort`, feature: F, title: "industry column still sorts", role: "admin",
    run: async ({ page }) => {
      await nav(page, "Accounts").click();
      const th = page.locator('th[data-sort-key="industry"]');
      await th.waitFor({ timeout: 15000 });
      // top-level rows only: a sub-account follows its parent whatever its own industry is
      const read = () => page.$$eval("tr[data-account-row]", rs => rs.filter(r => !r.textContent.includes("Sub-account:"))
        .map(r => r.querySelector("[data-industry-sub]").textContent.trim()));
      if (new Set(await read()).size < 2) throw new SkipScenario("fewer than 2 distinct industries — sort not exercised");
      await th.click();
      await page.waitForFunction(() => document.querySelector('th[data-sort-key="industry"]').getAttribute("aria-sort") === "ascending", null, { timeout: 5000 });
      const asc = await read();
      assert.deepEqual(asc, [...asc].sort(), "industry column not ascending");
      await th.click();
      await page.waitForFunction(() => document.querySelector('th[data-sort-key="industry"]').getAttribute("aria-sort") === "descending", null, { timeout: 5000 });
      const desc = await read();
      assert.deepEqual(desc, [...desc].sort().reverse(), "industry column not descending");
    } },
];
