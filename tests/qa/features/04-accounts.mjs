import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { searchCount, openAccount, stat, fmtMoneyIn, field } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";

const F = "04-accounts";
const manual = runId => `QA ${runId} Manual`;
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
    run: async ({ page, runId }) => {
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
    run: async ({ page, runId }) => {
      const name = await ensureManual(page, runId);
      await openAccount(page, name);
      const who = `QA ${runId} Contact ${Date.now() % 100000}`;
      await page.locator("[data-more-actions]").click();
      await page.getByRole("menuitem", { name: "+ Contact" }).click();
      const form = page.locator("[data-contact-form]");
      await form.getByPlaceholder("Name *").fill(who);
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await waitForSaved(page);
      const row = page.locator("div.border-b").filter({ has: page.locator("[data-delete-contact]") }).filter({ hasText: who });
      await row.waitFor({ timeout: 10000 });
      await row.locator("[data-delete-contact]").click();
      await page.locator("[data-confirm-go]").click();
      await waitForSaved(page);
      await row.waitFor({ state: "detached", timeout: 10000 });
    } },

  { id: `${F}/touchpoint`, feature: F, title: "Log a call; it appears in the activity timeline", role: "admin",
    run: async ({ page, runId }) => {
      const name = await ensureManual(page, runId);
      await openAccount(page, name);
      const summary = `QA ${runId} call ${Date.now() % 100000}`;
      await page.getByRole("button", { name: "+ Log activity" }).click();
      await page.getByPlaceholder("Summary…").fill(summary);
      await page.getByRole("button", { name: "Log", exact: true }).click();
      await waitForSaved(page);
      const entry = page.locator("div.border-b").filter({ hasText: summary });
      await entry.first().waitFor({ timeout: 10000 });
      assert.match(await entry.first().textContent(), /^call/, "logged activity is not a call");
    } },

  { id: `${F}/attachment`, feature: F, title: "Upload a PDF; opening it yields a working signed URL", role: "admin",
    run: async ({ page, context, runId }) => {
      const name = await ensureManual(page, runId);
      await openAccount(page, name);
      const summary = `QA ${runId} attach ${Date.now() % 100000}`, file = `qa-${runId}.pdf`;
      await page.getByRole("button", { name: "+ Log activity" }).click();
      await page.getByPlaceholder("Summary…").fill(summary);
      await page.locator('form input[type="file"][multiple]').setInputFiles({ name: file, mimeType: "application/pdf", buffer: PDF });
      await page.getByRole("button", { name: "Log", exact: true }).click();
      await waitForSaved(page);
      const entry = page.locator("div.border-b").filter({ hasText: summary }).first();
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
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").click();
      const r = await page.evaluate(async () => {
        const o = await sb.from("orgs").select("max_accounts");
        const a = await sb.from("accounts").select("id", { count: "exact", head: true });
        return o.error || a.error || !o.data || o.data.length !== 1 ? null : { lim: o.data[0].max_accounts, used: a.count };
      });
      if (!r || r.lim == null || r.used < r.lim) {
        console.log(`  note: limit message not exercised: org has room (accounts ${r?.used ?? "?"}, limit ${r?.lim ?? "unlimited/unknown"})`);
        return;
      }
      await page.getByRole("button", { name: "+ New account" }).click();
      await field(page, "Name *").fill(`QA ${runId} OverLimit`);
      await page.getByRole("button", { name: "Create account" }).click();
      await page.locator("[data-limit-error]").filter({ hasText: `Your plan allows ${r.lim} accounts` }).waitFor({ timeout: 10000 });
    } },

  { id: `${F}/account-limit`, feature: F, title: "Set max accounts = current count; create is blocked", role: "admin",
    skip: "limits are set from the client console (platform admin only); the message is covered by account-limit-at-cap when the org is full",
    run: async () => {} },
];
