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

test("finance settings: a blank or malformed sender email is refused and not saved", async () => {
  const { page, browser } = await launchFinance();
  await gotoSettings(page);
  const s = page.locator("[data-billing-sender]");
  await s.waitFor({ timeout: 10000 });
  for (const bad of ["   ", "not-an-email"]) {
    await s.locator("input").first().fill(bad);
    await s.locator("button").click();
    await page.waitForFunction(() => /valid sender email/i.test(document.querySelector("#set-billing")?.textContent || ""), null, { timeout: 5000 });
    await page.evaluate(() => document.querySelector("[data-billing-sender] button").blur());
  }
  assert((await page.evaluate(() => window.__mockDb.billing_settings.length)) === 0, "nothing may be upserted");
  await browser.close();
});

test("finance settings: a blank or non-numeric tax % is refused, a literal 0 is saved", async () => {
  const { page, browser } = await launchFinance();
  await gotoSettings(page);
  const f = page.locator("[data-billing-entity-form]");
  await f.waitFor({ timeout: 10000 });
  await f.locator('[name="name"]').fill("Tax Co");
  await f.locator('[name="invoice_prefix"]').fill("T-");
  await f.locator('[name="default_tax_pct"]').fill("");
  await f.locator('button[type="submit"]').click();
  await page.waitForFunction(() => /tax % must be a number/i.test(document.querySelector("#set-billing")?.textContent || ""), null, { timeout: 5000 });
  assert((await page.evaluate(() => window.__mockDb.billing_entities.length)) === 0, "blank tax must not save");
  await f.locator('[name="default_tax_pct"]').fill("0");
  await f.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-billing-entity-row]:has-text("Tax Co")', { timeout: 5000 });
  const e = await page.evaluate(() => window.__mockDb.billing_entities.at(-1));
  assert(Number(e.default_tax_pct) === 0, "0 stays allowed, got " + e.default_tax_pct);
  await browser.close();
});

test("finance settings: a non-admin never reaches Settings, so never sees billing", async () => {
  const { page, browser } = await launchFinance({ user: { role: "user", finance: true } });
  await page.waitForSelector("#root", { timeout: 10000 });
  assert((await page.getByRole("button", { name: "Settings" }).count()) === 0, "Settings nav must be absent for a non-admin");
  assert((await page.locator("[data-billing-entity-form]").count()) === 0, "entity form must not render");
  await browser.close();
});

// ---- Task 5: account billing fields and the Invoices tab ----
const ACCT = (id, name, extra = {}) => ({ id, data: { id, name, tier: "Mid", arr: 0, currency: "INR", industry: "Tech", csm: "", startDate: "2025-01-01", renewalDate: `${new Date().getFullYear() + 2}-01-01`, contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: "2026-07-01", ...extra } });
const EMPTY = { contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
const INV = (o) => ({ account_id: "a1", currency: "INR", total: 1180, status: "pending", sent_at: "2026-10-01T00:00:00Z", due_date: "2026-10-05", issue_date: "2026-10-01", entity_id: "e1", pdf_path: "org-a/x.pdf", ...o });
const openFinance = (user, invoices) => launchFinance({ user,
  tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd"), ACCT("a2", "Other Co")], invoices, billing_entities: [] } });
async function openAccountTab(page, id, tab) {
  await page.click('button[title="Accounts"]', { timeout: 15000 });
  await page.click(`[data-account-row]:has-text("${id === "a1" ? "Acme Ltd" : "Other Co"}")`);
  await page.click(`[data-account-tab="${tab}"]`);
}
const rpcSeen = (page, pred) => page.waitForFunction(p => window.__rpcCalls.some(c => c.fn === "set_invoice_status" && new Function("a", "return " + p)(c.args)), pred, { timeout: 5000 });

test("account invoices tab: lists history; CSM sees no Paid checkbox but can download", async () => {
  const { page, browser } = await openFinance({ role: "user", finance: false }, [
    INV({ id: "i1", number: "IN-0001" }),
    INV({ id: "i2", number: "IN-0002", total: 500, status: "paid", paid_date: "2026-10-02", due_date: "2026-11-01", pdf_path: "org-a/i2.pdf" }),
    INV({ id: "i3", account_id: "a2", number: "IN-0003", total: 9, due_date: "2026-11-01", pdf_path: null })]);
  await openAccountTab(page, "a1", "Invoices");
  await page.waitForSelector("[data-invoice-row]");
  assert((await page.locator("[data-invoice-row]").count()) === 2, "a2's invoice must be excluded");
  assert((await page.locator('[data-invoice-row="IN-0001"] [data-invoice-status]').innerText()) === "Overdue");
  assert((await page.locator('[data-invoice-row="IN-0002"] [data-invoice-status]').innerText()) === "Paid");
  assert((await page.locator("[data-paid-checkbox]").count()) === 0, "no checkbox for a non-finance user");
  assert((await page.locator('[data-invoice-row="IN-0001"] [data-download]').count()) === 1);
  assert((await page.locator("[data-waive]").count()) === 0, "no waive for a non-finance user");
  await browser.close();
});

test("account invoices tab: finance marks paid with date and reference; unchecking reverts after confirm", async () => {
  const { page, browser } = await openFinance({ role: "user", finance: true }, [INV({ id: "i1", number: "IN-0001" })]);
  await openAccountTab(page, "a1", "Invoices");
  await page.locator('[data-invoice-row="IN-0001"] [data-paid-checkbox]').click(); // controlled: flips only after the dialog confirms
  await page.locator("[data-paid-ref]").fill("UTR-77");
  await page.locator("[data-paid-confirm]").click();
  await rpcSeen(page, "a.p_status === 'paid' && a.p_ref === 'UTR-77' && !!a.p_paid_date");
  await page.waitForSelector('[data-invoice-row="IN-0001"] [data-invoice-status]:has-text("Paid")');
  await page.locator('[data-invoice-row="IN-0001"] [data-paid-checkbox]').click();
  await page.click("[data-confirm-go]");
  await rpcSeen(page, "a.p_status === 'pending'");
  await page.waitForSelector('[data-invoice-row="IN-0001"] [data-invoice-status]:has-text("Overdue")');
  await browser.close();
});

test("account invoices tab: waive requires a reason", async () => {
  const { page, browser } = await openFinance({ role: "user", finance: true }, [INV({ id: "i1", number: "IN-0001" })]);
  await openAccountTab(page, "a1", "Invoices");
  await page.locator('[data-invoice-row="IN-0001"] [data-waive]').click();
  assert(await page.locator("[data-waive-confirm]").isDisabled(), "disabled while the reason is blank");
  await page.locator("[data-waive-reason]").fill("   ");
  assert(await page.locator("[data-waive-confirm]").isDisabled(), "whitespace is still blank");
  await page.locator("[data-waive-reason]").fill("Goodwill credit");
  await page.locator("[data-waive-confirm]").click();
  await rpcSeen(page, "a.p_status === 'waived' && a.p_reason === 'Goodwill credit'");
  await page.waitForSelector('[data-invoice-row="IN-0001"] [data-invoice-status]:has-text("Waived")');
  await browser.close();
});

test("account invoices tab: an unsent invoice offers Discard with the reason prefilled", async () => {
  const { page, browser } = await openFinance({ role: "user", finance: true }, [INV({ id: "i1", number: "IN-0001", sent_at: null })]);
  await openAccountTab(page, "a1", "Invoices");
  assert((await page.locator('[data-invoice-row="IN-0001"] [data-invoice-status]').innerText()) === "Unsent");
  assert((await page.locator('[data-invoice-row="IN-0001"] [data-paid-checkbox]').isDisabled()), "cannot mark an unsent invoice paid");
  const w = page.locator('[data-invoice-row="IN-0001"] [data-waive]');
  assert((await w.innerText()) === "Discard");
  await w.click();
  assert((await page.locator("[data-waive-reason]").inputValue()) === "Discarded before sending");
  await browser.close();
});

test("account form: billing fields save into the account", async () => {
  const { page, browser } = await openFinance({ role: "admin" }, []);
  await page.click('button[title="Accounts"]', { timeout: 15000 });
  await page.click('[data-account-row]:has-text("Acme Ltd")');
  await page.getByRole("button", { name: /Edit account/ }).click();
  await page.locator("[data-billing-fieldset] summary").click();
  await page.locator('[name="billingEmail"]').fill("ap@acme.test");
  await page.locator('[name="country"]').selectOption("IN");
  assert((await page.locator('[name="customerState"]').count()) === 1, "state shown for IN");
  await page.locator('[name="taxExempt"]').check();
  assert((await page.locator('[name="taxExemptNote"]').count()) === 1, "note shown when exempt");
  await page.getByRole("button", { name: "Save changes" }).click();
  const a = await page.evaluate(() => new Promise(r => setTimeout(() => r(window.__store.getState().accounts.find(x => x.id === "a1")), 50)));
  assert(a.billingEmail === "ap@acme.test" && a.country === "IN" && a.taxExempt === true, JSON.stringify(a));
  assert(a.customerTaxId === "" && a.billingEntityId === "", "blank values are stored as empty strings");
  await browser.close();
});
