import assert from "node:assert/strict";
import { EXPECTED } from "../fixtures/expected.mjs";
import { importCsv, fixtureCsv, waitForSaved, unambiguousOffset } from "../reset.mjs";
import { searchCount, openAccount, stat, fmtMoneyIn, fmtDateIn, isoPlus, field } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";

const F = "03-csv";
// First PHP row of the fixture (the brief's "first EUR account"; the importer has no EUR).
// Its date is the fixture's {U+25}: day >= 13, so a day/month swap could not pass.
const PHP_ROW = "Nimbus Telecom", PHP_DAYS = 25, PHP_TIER = "Gold";
const REIMPORT_ROW = "Acme Corp", OLD_ARR = "1200000", NEW_ARR = 1234567;

export const scenarios = [
  { id: `${F}/rows-imported`, feature: F, title: "Reset's CSV import produced all fixture rows", role: "admin",
    run: async ({ page, runId }) => {
      assert.equal(await searchCount(page, `QA ${runId} `), EXPECTED.accounts);
    } },

  { id: `${F}/fields-correct`, feature: F, title: "Imported PHP account has currency, DD-MM renewal, custom field and owner right", role: "admin",
    run: async ({ page, runId, csmName }) => {
      const name = `QA ${runId} ${PHP_ROW}`;
      await openAccount(page, name);
      const iso = isoPlus(unambiguousOffset(PHP_DAYS));
      assert.ok(+iso.slice(8) >= 13, "fixture date is ambiguous");
      assert.equal((await stat(page, "Renewal").textContent()).trim(), await fmtDateIn(page, iso), "renewal date (DD-MM read day-first)");
      assert.equal((await stat(page, "CSM").textContent()).trim(), csmName, "owner");
      const custom = page.locator("[data-custom-details]");
      await custom.getByText(EXPECTED.customFieldLabel, { exact: true }).waitFor({ timeout: 10000 });
      assert.match(await custom.textContent(), new RegExp(`${EXPECTED.customFieldLabel}\\s*${PHP_TIER}`), "QA Tier value");
      // Currency and the raw date as stored: read them from the edit form, then cancel.
      await page.getByRole("button", { name: "✎ Edit account" }).click();
      assert.equal(await field(page, "Billing currency").inputValue(), "PHP", "currency");
      assert.equal(await field(page, "Renewal date").inputValue(), iso, "stored renewal date");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    } },

  { id: `${F}/reimport-updates`, feature: F, title: "Re-importing the fixture updates rows in place", role: "admin",
    run: async ({ page, runId, csmName, adminName }) => {
      const csv = fixtureCsv(runId, { csm: csmName, admin: adminName })
        .replace(`QA ${runId} ${REIMPORT_ROW},Enterprise,${OLD_ARR},`, `QA ${runId} ${REIMPORT_ROW},Enterprise,${NEW_ARR},`);
      assert.ok(csv.includes(String(NEW_ARR)), "fixture edit did not apply");
      await nav(page, "Accounts").click();
      const r = await importCsv(page, csv, `qa-${runId}-reimport.csv`);
      await waitForSaved(page);
      assert.equal(r.ok, 0, "re-import created new accounts");
      assert.ok(r.updated >= 1, `re-import updated ${r.updated}`);
      assert.equal(await searchCount(page, `QA ${runId} `), EXPECTED.accounts, "row count after re-import");
      await openAccount(page, `QA ${runId} ${REIMPORT_ROW}`);
      assert.equal((await stat(page, "ARR").textContent()).trim(), await fmtMoneyIn(page, NEW_ARR, "INR"));
    } },

  { id: `${F}/malformed-rejected`, feature: F, title: "A CSV with no data rows is rejected and changes nothing", role: "admin",
    run: async ({ page, runId }) => {
      const before = await searchCount(page, "");
      await assert.rejects(importCsv(page, "foo,bar\n", `qa-${runId}-bad.csv`), /CSV import failed: No data rows found/);
      assert.equal(await searchCount(page, ""), before, "row count changed");
    } },
];
