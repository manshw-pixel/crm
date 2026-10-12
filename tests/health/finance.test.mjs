import { test, assert } from "./framework.mjs";
import { launchFinance, gotoSettings } from "./harness.mjs";

const PRIYA = { id: "u2", name: "Priya", role: "user", disabled: false, finance: false, email: "p@x.test" };
// Wait inside the page so the store has committed the dispatch before the read.
const settle = page => page.evaluate(() => new Promise(r => setTimeout(r, 50)));

test("finance settings: admin toggles finance access on a user", async () => {
  const { page, browser } = await launchFinance({ users: [PRIYA] });
  await gotoSettings(page);
  const btn = page.locator('[data-user-id="u2"] [data-finance-toggle]');
  await btn.waitFor({ timeout: 10000 });
  assert((await btn.getAttribute("aria-pressed")) === "false", "should start off");
  await btn.click();
  await page.waitForFunction(() => window.__mockDb.profiles.find(p => p.id === "u2")?.finance === true, null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('[data-user-id="u2"] [data-finance-toggle]')?.getAttribute("aria-pressed") === "true", null, { timeout: 5000 });
  // and back off again
  await btn.click();
  await page.waitForFunction(() => window.__mockDb.profiles.find(p => p.id === "u2")?.finance === false, null, { timeout: 5000 });
  await browser.close();
});

test("finance settings: the toggle reflects an existing grant", async () => {
  const { page, browser } = await launchFinance({ users: [{ ...PRIYA, finance: true }] });
  await gotoSettings(page);
  const btn = page.locator('[data-user-id="u2"] [data-finance-toggle]');
  await btn.waitFor({ timeout: 10000 });
  assert((await btn.getAttribute("aria-pressed")) === "true", "should start on");
  await browser.close();
});

test("finance settings: admin adds a billing entity", async () => {
  const { page, browser } = await launchFinance();
  await gotoSettings(page);
  const f = page.locator("[data-billing-entity-form]");
  await f.waitFor({ timeout: 10000 });
  await f.locator('[name="name"]').fill("OneVio PH Inc");
  await f.locator('[name="country"]').selectOption("PH");
  await f.locator('[name="invoice_prefix"]').fill("PH-");
  await f.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-billing-entity-row]:has-text("OneVio PH Inc")', { timeout: 5000 });
  await settle(page);
  const e = await page.evaluate(() => window.__mockDb.billing_entities.at(-1));
  assert(e.currency === "PHP", "currency defaults from country, got " + e.currency);
  assert(Number(e.default_tax_pct) === 12, "tax defaults from country, got " + e.default_tax_pct);
  assert(e.invoice_prefix === "PH-", "prefix saved");
  await browser.close();
});

test("finance settings: a hand-edited currency survives a country change", async () => {
  const { page, browser } = await launchFinance();
  await gotoSettings(page);
  const f = page.locator("[data-billing-entity-form]");
  await f.waitFor({ timeout: 10000 });
  await f.locator('[name="country"]').selectOption("US");
  await f.locator('[name="default_tax_pct"]').fill("7");
  await f.locator('[name="country"]').selectOption("IN");
  assert((await f.locator('[name="currency"]').inputValue()) === "INR", "untouched currency follows the country");
  assert((await f.locator('[name="default_tax_pct"]').inputValue()) === "7", "an edited tax % is kept");
  await browser.close();
});

test("finance settings: editing an entity fills the form and saves in place", async () => {
  const ent = { id: "e1", org_id: "org-a", name: "OneVio India", country: "IN", currency: "INR", invoice_prefix: "IN-", next_number: 5, default_tax_pct: 18, state: "MH", address: "", tax_id: "", tax_id_label: "GSTIN", bank_details: "", lut_number: null, created_at: "2026-01-01T00:00:00Z" };
  const { page, browser } = await launchFinance({ tables: { billing_entities: [ent] } });
  await gotoSettings(page);
  const row = page.locator("[data-billing-entity-row]");
  await row.waitFor({ timeout: 10000 });
  const txt = await row.textContent();
  assert(/OneVio India/.test(txt) && /INR/.test(txt) && /IN-/.test(txt) && /5/.test(txt), "row shows name, currency, prefix, next number: " + txt);
  await row.locator("button").first().click();
  const f = page.locator("[data-billing-entity-form]");
  assert((await f.locator('[name="name"]').inputValue()) === "OneVio India", "form filled");
  await f.locator('[name="name"]').fill("OneVio India Pvt");
  await f.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-billing-entity-row]:has-text("OneVio India Pvt")', { timeout: 5000 });
  const n = await page.evaluate(() => window.__mockDb.billing_entities.length);
  assert(n === 1, "an edit must update, not insert: " + n + " entities");
  await browser.close();
});

test("finance settings: a rejected entity save surfaces the database message", async () => {
  const { page, browser } = await launchFinance();
  await gotoSettings(page);
  const f = page.locator("[data-billing-entity-form]");
  await f.waitFor({ timeout: 10000 });
  await f.locator('[name="name"]').fill("No Prefix Ltd");   // invoice_prefix left empty
  await f.locator('button[type="submit"]').click();
  await page.waitForFunction(() => /invoice_prefix|prefix/i.test(document.querySelector("#set-billing")?.textContent || ""), null, { timeout: 5000 });
  assert((await page.evaluate(() => window.__mockDb.billing_entities.length)) === 0, "nothing saved");
  await browser.close();
});

test("finance settings: sender shows the default when the org has no row, and the first save upserts", async () => {
  const { page, browser } = await launchFinance();
  await gotoSettings(page);
  const s = page.locator("[data-billing-sender]");
  await s.waitFor({ timeout: 10000 });
  assert((await s.locator("input").first().inputValue()) === "support@onevio.in", "default sender shown");
  await s.locator("input").first().fill("billing@acme.test");
  await s.locator("button").click();
  await page.waitForFunction(() => window.__mockDb.billing_settings.length === 1 && window.__mockDb.billing_settings[0].sender_email === "billing@acme.test", null, { timeout: 5000 });
  const row = await page.evaluate(() => window.__mockDb.billing_settings[0]);
  assert(row.org_id === "org-a", "org_id comes from the profile, got " + row.org_id);
  // a second save updates the same row
  await s.locator("input").first().fill("ar@acme.test");
  await s.locator("button").click();
  await page.waitForFunction(() => window.__mockDb.billing_settings[0].sender_email === "ar@acme.test", null, { timeout: 5000 });
  assert((await page.evaluate(() => window.__mockDb.billing_settings.length)) === 1, "second save must not add a row");
  await browser.close();
});

test("finance settings: a non-admin never reaches Settings, so never sees billing", async () => {
  const { page, browser } = await launchFinance({ user: { role: "user", finance: true } });
  await page.waitForSelector("#root", { timeout: 10000 });
  assert((await page.getByRole("button", { name: "Settings" }).count()) === 0, "Settings nav must be absent for a non-admin");
  assert((await page.locator("[data-billing-entity-form]").count()) === 0, "entity form must not render");
  await browser.close();
});
