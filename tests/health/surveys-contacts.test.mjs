// Surveys PR 1 Task 4: the Contacts card state pill, per-row toggle, bulk bar and recipients filter.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "s1", name: "Survey Co", accountNo: "2001", csm: "Priya Shah" });
const CT = [
  { id: "k1", accountId: "s1", name: "Flagged Fay", email: "fay@s.example", surveyRecipient: true },
  { id: "k2", accountId: "s1", name: "Plain Pat", email: "pat@s.example" },
  { id: "k3", accountId: "s1", name: "Optout Oz", email: "oz@s.example", surveyRecipient: true, surveyOptOut: "2026-10-01" },
  { id: "k4", accountId: "s1", name: "Mailless Max" },
];
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = `window.__seedRows = { accounts: ${rows([A])}, contacts: ${rows(CT)}, activities: [], tasks: [], opportunities: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] };`;
const row = (page, name) => page.locator("[data-contact-row]").filter({ hasText: name });

test("contacts card: state pills, toggle, bulk flag skips unflaggable, filter", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('button[title="Accounts"]');
    await page.waitForSelector("[data-account-row]");
    await page.locator("[data-account-row]").first().click();
    await page.waitForSelector("[data-contact-row]");
    const st = async n => row(page, n).locator("[data-survey-state]").getAttribute("data-survey-state");
    assert(await st("Flagged Fay") === "on" && await st("Plain Pat") === "off" && await st("Optout Oz") === "optout" && await st("Mailless Max") === "noemail", "pill states");
    assert(await row(page, "Optout Oz").locator("[data-survey-toggle]").count() === 0, "opted-out has no toggle");
    await row(page, "Plain Pat").locator("[data-survey-toggle]").click();
    assert(await st("Plain Pat") === "on", "toggle flags");
    await page.locator("[data-survey-filter]").click();
    const shown = await page.locator("[data-contact-row]").count();
    assert(shown === 3, "filter shows flagged only (Fay, Pat, Oz): " + shown);
    await page.locator("[data-survey-filter]").click();
    await row(page, "Flagged Fay").getByLabel("Select Flagged Fay").check();
    await row(page, "Mailless Max").getByLabel("Select Mailless Max").check();
    await page.locator("[data-survey-bulk]").getByRole("button", { name: /^Unflag/ }).click();
    assert(await st("Flagged Fay") === "off", "bulk unflag");
    assert(await page.locator("[data-survey-bulk]").count() === 0, "bar closes");
    assert(/Skipped 1/.test(await page.locator("body").innerText()), "toast says skipped");
  } finally { await browser.close(); }
});
