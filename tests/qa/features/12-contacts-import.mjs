import assert from "node:assert/strict";
import { openAccount } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "12-contacts-import";
const HEAD = "Account,Name,Role,Email,Champion,Sentiment,Send surveys";
const acct = (runId, co) => `QA ${runId} ${co}`;
const names = thisRunId => ({
  a: `QA ${thisRunId} Import Ann`, b: `QA ${thisRunId} Import Ben`,
  ok: `QA ${thisRunId} Import Ok`, bad: `QA ${thisRunId} Import Bad`, ghost: `QA ${thisRunId} Import Ghost`,
  other: `QA ${thisRunId} Import Other`, form: `QA ${thisRunId} Form Fay`,
});
const mail = (thisRunId, who) => `qa-${thisRunId}-${who}@example.com`;

// Fixture CSV text for this run (written per run, never a shared file), as a Playwright file payload.
const csvFile = (name, lines) => ({ name, mimeType: "text/csv", buffer: Buffer.from([HEAD, ...lines].join("\n") + "\n") });

const dialog = page => page.locator("[data-contacts-import]");
// Opens the import dialog from the Accounts page (open = null) or from the account page the test is already on.
async function openDialog(page, fromAccountsPage) {
  if (fromAccountsPage) await nav(page, "Accounts").click();
  await page.locator("[data-open-contacts-import]").first().click();
  await dialog(page).waitFor({ timeout: 15000 });
}
async function uploadPlan(page, file) {
  await dialog(page).locator("[data-contacts-file]").setInputFiles(file);
  await dialog(page).locator("[data-import-row]").first().waitFor({ timeout: 15000 });
}
const statuses = async page => (await dialog(page).locator("[data-import-row]").evaluateAll(els => els.map(e => e.getAttribute("data-import-row"))));
const contactRow = (page, name) => page.locator("[data-contact-row]").filter({ hasText: name }).first();

export const scenarios = [
  { id: `${F}/new-and-flag`, feature: F, title: "Importing two new contacts flags only the one marked Send surveys = Yes", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const n = names(thisRunId), co = acct(runId, "Birch Labs");
      await nav(page, "Accounts").click();
      await openDialog(page, false);
      await uploadPlan(page, csvFile(`qa-${thisRunId}-contacts.csv`, [
        `${co},${n.a},Head of IT,${mail(thisRunId, "ann")},Yes,Positive,Yes`,
        `${co},${n.b},Analyst,${mail(thisRunId, "ben")},,,`,
      ]));
      assert.deepEqual(await statuses(page), ["new", "new"], "both rows are new");
      await dialog(page).locator("[data-import-confirm]").click();
      await dialog(page).waitFor({ state: "detached", timeout: 15000 });
      await waitForSaved(page);
      await openAccount(page, co);
      const ann = contactRow(page, n.a), ben = contactRow(page, n.b);
      await ann.waitFor({ timeout: 15000 });
      await ben.waitFor({ timeout: 15000 });
      assert.match(await ann.textContent(), /Receives surveys/, "flagged contact");
      assert.doesNotMatch(await ben.textContent(), /Receives surveys/, "unflagged contact");
    } },

  { id: `${F}/update-blank-keeps`, feature: F, title: "Re-importing with a blank Role and Send surveys = No clears the flag and keeps the Role", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const n = names(thisRunId), co = acct(runId, "Birch Labs");
      await openAccount(page, co);
      await openDialog(page, false);
      await uploadPlan(page, csvFile(`qa-${thisRunId}-contacts2.csv`, [`${co},${n.a},,${mail(thisRunId, "ann")},,,No`]));
      assert.deepEqual(await statuses(page), ["update"], "check step shows Update");
      assert.match(await dialog(page).locator("[data-import-row]").first().textContent(), /Update/);
      await dialog(page).locator("[data-import-confirm]").click();
      await dialog(page).waitFor({ state: "detached", timeout: 15000 });
      await waitForSaved(page);
      const ann = contactRow(page, n.a);
      await ann.waitFor({ timeout: 15000 });
      const t = await ann.textContent();
      assert.match(t, /Head of IT/, "Role unchanged by the blank cell");
      assert.doesNotMatch(t, /Receives surveys/, "flag is off");
    } },

  { id: `${F}/errors-skipped`, feature: F, title: "Unknown-account and bad-email rows show as errors, are not counted and write nothing", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const n = names(thisRunId), co = acct(runId, "Birch Labs");
      await nav(page, "Accounts").click();
      await openDialog(page, false);
      await uploadPlan(page, csvFile(`qa-${thisRunId}-contacts3.csv`, [
        `${co},${n.ok},,${mail(thisRunId, "ok")},,,`,
        `${acct(runId, "No Such Company")},${n.ghost},,${mail(thisRunId, "ghost")},,,`,
        `${co},${n.bad},,not-an-email,,,`,
      ]));
      assert.deepEqual((await statuses(page)).sort(), ["error", "error", "new"], "2 error rows, 1 new");
      assert.equal(await dialog(page).locator('[data-import-row="error"]').count(), 2);
      assert.equal((await dialog(page).locator("[data-import-confirm]").textContent()).trim(), "Import 1 contacts", "confirm counts only valid rows");
      await dialog(page).locator("[data-import-confirm]").click();
      await dialog(page).waitFor({ state: "detached", timeout: 15000 });
      await waitForSaved(page);
      await openAccount(page, co);
      await contactRow(page, n.ok).waitFor({ timeout: 15000 });
      assert.equal(await page.locator("[data-contact-row]").filter({ hasText: n.bad }).count(), 0, "bad-email row not written");
      assert.equal(await page.locator("[data-contact-row]").filter({ hasText: n.ghost }).count(), 0, "unknown-account row not written");
    } },

  { id: `${F}/locked-account`, feature: F, title: "The account-page import refuses a row for a different account", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const n = names(thisRunId), co = acct(runId, "Birch Labs"), other = acct(runId, "Cedar Foods");
      await openAccount(page, co);
      await openDialog(page, false);
      await uploadPlan(page, csvFile(`qa-${thisRunId}-contacts4.csv`, [`${other},${n.other},,${mail(thisRunId, "other")},,,`]));
      const row = dialog(page).locator('[data-import-row="error"]').first();
      assert.match(await row.textContent(), new RegExp(`This import is for ${co} only`));
      assert.equal(await dialog(page).locator("[data-import-confirm]").isDisabled(), true, "nothing to import");
      await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog(page).waitFor({ state: "detached", timeout: 10000 });
    } },

  { id: `${F}/form-checkbox`, feature: F, title: "Adding a contact with 'Send surveys to this contact' ticked shows Receives surveys after a reload", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const n = names(thisRunId), co = acct(runId, "Birch Labs");
      await openAccount(page, co);
      await page.locator("[data-more-actions]").click();
      await page.getByRole("menuitem", { name: "+ Contact" }).click();
      const form = page.locator("[data-contact-form]");
      await form.getByPlaceholder("Name *").fill(n.form);
      await form.getByLabel("Send surveys to this contact").check();
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await waitForSaved(page);
      await page.reload();
      await openAccount(page, co);
      const row = contactRow(page, n.form);
      await row.waitFor({ timeout: 20000 });
      assert.match(await row.textContent(), /Receives surveys/);
    } },
];
