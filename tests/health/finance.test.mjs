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

test("account invoices tab: a failed load shows the error, not the empty state", async () => {
  const { page, browser } = await launchFinance({ user: { role: "user", finance: false },
    seed: `window.__selectErrors = { invoices: "permission denied for table invoices" };`,
    tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd")], invoices: [], billing_entities: [] } });
  await openAccountTab(page, "a1", "Invoices");
  await page.waitForSelector("[data-invoices-error]");
  assert((await page.locator("[data-invoices-error]").innerText()).includes("permission denied"));
  assert((await page.locator("[data-invoices-empty]").count()) === 0, "must not claim there are no invoices");
  await browser.close();
});

test("account form: a malformed billing email opens the collapsed Billing section", async () => {
  const { page, browser } = await openFinance({ role: "admin" }, []);
  await page.click('button[title="Accounts"]', { timeout: 15000 });
  await page.click('[data-account-row]:has-text("Acme Ltd")');
  await page.getByRole("button", { name: /Edit account/ }).click();
  await page.locator("[data-billing-fieldset] summary").click();
  await page.locator('[name="billingEmail"]').fill("not-an-email");
  await page.locator("[data-billing-fieldset] summary").click();
  assert(!(await page.locator("[data-billing-fieldset]").evaluate(d => d.open)), "starts collapsed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForFunction(() => document.querySelector("[data-billing-fieldset]").open, null, { timeout: 3000 });
  await browser.close();
});

test("account detail: the tab resets to overview when another account opens", async () => {
  const { page, browser } = await openFinance({ role: "admin" }, []);
  await openAccountTab(page, "a1", "Invoices");
  await page.waitForSelector("[data-invoices-empty]");
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /Back/.test(x.textContent)); b && b.click(); });
  await page.click('[data-account-row]:has-text("Other Co")');
  await page.waitForSelector('[data-account-tab="Invoices"]');
  assert((await page.locator('[data-account-tab="overview"]').getAttribute("aria-selected")) === "true");
  await browser.close();
});

// ---- Task 5B: purchase orders ----
const PO = (o = {}) => ({ id: "po1", org_id: "org-a", account_id: "a1", account_name: "Acme Ltd", po_number: "4500123", po_date: "2026-10-01", po_value: 800000,
  currency: "INR", years: 2, billing_cycle: "quarterly", billing_start: "2026-11-01", file_path: "org-a/a1/x.pdf", status: "submitted",
  submitted_by: "u1", reviewed_by: null, reviewed_at: null, reject_reason: null, created_at: "2026-10-01T00:00:00Z", ...o });
const openPO = (user, pos, schedule = []) => launchFinance({ user, tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd")], invoices: [], billing_entities: [], purchase_orders: pos, po_schedule: schedule } });
const PDF = { name: "po.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") };
const rpcCalls = (page, fn) => page.evaluate(f => window.__rpcCalls.filter(c => c.fn === f), fn);

test("po: CSM submits a PO with a file; preview shows 8 quarterly periods", async () => {
  const { page, browser } = await openPO({ role: "user", finance: false }, []);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-submit]");
  await page.setInputFiles("[data-po-file]", PDF);
  await page.fill('[name="po_number"]', "4500123");
  await page.fill('[name="po_value"]', "800000");
  await page.fill('[name="years"]', "2");
  await page.selectOption('[name="billing_cycle"]', "quarterly");
  await page.fill('[name="billing_start"]', "2026-11-01");
  assert((await page.locator("[data-po-preview] tr[data-period]").count()) === 8, "8 periods");
  await page.click("[data-po-submit-confirm]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Awaiting approval")', { timeout: 5000 });
  const po = await page.evaluate(() => window.__mockDb.purchase_orders.at(-1));
  assert(/^[^/]+\/a1\/.+\.pdf$/.test(po.file_path), "path is <org>/<account>/<uuid>.pdf, got " + po.file_path);
  assert(po.file_path.startsWith("org-a/"), "org prefix");
  assert((await page.evaluate(p => window.__mockStorage["purchase-orders"].has(p), po.file_path)), "file uploaded");
  assert((await page.locator("[data-po-approve]").count()) === 0, "CSM never sees approve");
  assert((await page.locator("[data-po-review]").count()) === 0, "CSM never sees review");
  await browser.close();
});

test("po: submit blocked without file, number or a valid schedule", async () => {
  const { page, browser } = await openPO({ role: "user", finance: false }, []);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-submit]");
  const btn = page.locator("[data-po-submit-confirm]");
  assert(await btn.isDisabled(), "disabled when empty");
  await page.fill('[name="po_number"]', "P-1");
  await page.fill('[name="po_value"]', "1000");
  assert(await btn.isDisabled(), "still disabled without a file");
  await page.setInputFiles("[data-po-file]", PDF);
  assert(!(await btn.isDisabled()), "enabled with file, number and schedule");
  await page.fill('[name="po_number"]', "   ");
  assert(await btn.isDisabled(), "blank number disables");
  await page.fill('[name="po_number"]', "P-1");
  await page.fill('[name="years"]', "0");
  assert(await btn.isDisabled(), "years 0 disables");
  assert((await page.locator("[data-po-preview]").innerText()).includes("Enter value, years, cycle and start date"));
  await page.fill('[name="years"]', "1.5");
  assert(await btn.isDisabled(), "fractional years disables");
  await browser.close();
});

test("po: finance edits amounts, mismatch needs confirmation, approve creates schedule", async () => {
  const { page, browser } = await openPO({ role: "user", finance: true }, [PO()]);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-review]");
  await page.waitForSelector("[data-po-amount]");
  assert((await page.locator("[data-po-amount]").count()) === 8);
  assert((await page.locator("[data-po-mismatch]").count()) === 0, "no warning while the amounts add up");
  assert(!(await page.locator("[data-po-approve]").isDisabled()), "approve enabled when matching");
  await page.locator("[data-po-amount]").first().fill("150000");
  await page.waitForSelector("[data-po-mismatch]");
  assert(await page.locator("[data-po-approve]").isDisabled(), "approve blocked until mismatch confirmed");
  await page.check("[data-po-mismatch-ok]");
  assert(!(await page.locator("[data-po-approve]").isDisabled()));
  await page.click("[data-po-approve]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Approved")', { timeout: 5000 });
  const c = (await rpcCalls(page, "approve_po"))[0];
  assert(c.args.p_amounts[0] === 150000 && c.args.p_confirm_mismatch === true, JSON.stringify(c.args).slice(0, 120));
  assert((await page.locator('[data-po-row="4500123"] [data-po-invoiced]').innerText()) === "0 of 8 raised");
  assert((await page.evaluate(() => window.__mockDb.po_schedule.length)) === 8);
  await browser.close();
});

test("po: approving without edits sends no amounts and no mismatch confirmation", async () => {
  const { page, browser } = await openPO({ role: "admin" }, [PO()]);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-review]");
  await page.waitForSelector("[data-po-approve]");
  await page.click("[data-po-approve]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Approved")', { timeout: 5000 });
  const c = (await rpcCalls(page, "approve_po"))[0];
  assert(c.args.p_amounts === null && c.args.p_confirm_mismatch === false, JSON.stringify(c.args));
  await browser.close();
});

test("po: reject requires a reason; CSM sees the reason and can resubmit", async () => {
  const { page, browser } = await openPO({ role: "admin" }, [PO()]);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-review]");
  assert(await page.locator("[data-po-reject]").isDisabled(), "disabled with no reason");
  await page.fill("[data-po-reject-reason]", "   ");
  assert(await page.locator("[data-po-reject]").isDisabled(), "whitespace is blank");
  await page.fill("[data-po-reject-reason]", "Wrong value");
  await page.click("[data-po-reject]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Rejected — Wrong value")', { timeout: 5000 });
  const rc = (await rpcCalls(page, "reject_po"))[0];
  assert(rc.args.p_reason === "Wrong value");
  await browser.close();
  // as the submitting CSM
  const b = await openPO({ role: "user", finance: false }, [PO({ status: "rejected", reject_reason: "Wrong value", reviewed_by: "u9" })]);
  await openAccountTab(b.page, "a1", "Purchase orders");
  await b.page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Rejected — Wrong value")');
  await b.page.click("[data-po-edit]");
  assert((await b.page.locator('[name="po_number"]').inputValue()) === "4500123", "prefilled");
  assert((await b.page.locator('[name="po_value"]').inputValue()) === "800000", "prefilled value");
  assert(!(await b.page.locator("[data-po-submit-confirm]").isDisabled()), "existing file satisfies the file rule");
  await b.page.fill('[name="po_value"]', "900000");
  await b.page.click("[data-po-submit-confirm]");
  await b.page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Awaiting approval")', { timeout: 5000 });
  const po = await b.page.evaluate(() => window.__mockDb.purchase_orders);
  assert(po.length === 1, "an edit must update, not insert");
  assert(po[0].status === "submitted" && po[0].reviewed_by === null && po[0].reject_reason === null && Number(po[0].po_value) === 900000, JSON.stringify(po[0]));
  assert(po[0].file_path === "org-a/a1/x.pdf", "file kept when none chosen");
  await b.browser.close();
});

test("po: finance cancels an approved PO after a confirm that counts un-raised periods", async () => {
  const sch = [1, 2, 3].map(i => ({ id: "s" + i, org_id: "org-a", po_id: "po1", seq: i, period_start: "2026-11-01", period_end: "2027-01-31", amount: 100, invoice_id: i === 1 ? "inv9" : null }));
  const { page, browser } = await openPO({ role: "admin" }, [PO({ status: "approved" })], sch);
  await openAccountTab(page, "a1", "Purchase orders");
  assert((await page.locator('[data-po-row="4500123"] [data-po-invoiced]').innerText()) === "1 of 3 raised");
  await page.click("[data-po-review]");
  await page.click("[data-po-cancel]");
  assert((await page.locator("[data-confirmdialog]").innerText()).includes("Removes 2 un-raised periods. Invoices already raised are kept."));
  await page.click("[data-confirm-go]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Cancelled")', { timeout: 5000 });
  assert((await rpcCalls(page, "cancel_po")).length === 1);
  await browser.close();
});

test("po: a failed load shows the error, not the empty state", async () => {
  const { page, browser } = await launchFinance({ user: { role: "user", finance: false }, seed: `window.__selectErrors = { purchase_orders: "permission denied" };`,
    tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd")], invoices: [], billing_entities: [] } });
  await openAccountTab(page, "a1", "Purchase orders");
  await page.waitForSelector("[data-po-load-error]");
  assert((await page.locator("[data-po-empty]").count()) === 0);
  await browser.close();
});

test("po: amounts with more than 2 decimals are refused and approve stays disabled", async () => {
  const { page, browser } = await openPO({ role: "admin" }, [PO()]);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-review]");
  await page.waitForSelector("[data-po-amount]");
  const first = page.locator("[data-po-amount]").first();
  await first.fill("150000.005");
  await page.waitForSelector("[data-po-amount-error]");
  assert(await page.locator("[data-po-approve]").isDisabled(), "approve disabled for 3dp");
  await first.fill("150000.5");
  assert((await page.locator("[data-po-amount-error]").count()) === 0, "1dp is fine");
  await page.check("[data-po-mismatch-ok]");
  await page.click("[data-po-approve]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Approved")', { timeout: 5000 });
  const c = (await rpcCalls(page, "approve_po"))[0];
  assert(c.args.p_amounts[0] === 150000.5, JSON.stringify(c.args.p_amounts));
  await browser.close();
});

test("po: years above 10 block submit", async () => {
  const { page, browser } = await openPO({ role: "user", finance: false }, []);
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-submit]");
  await page.setInputFiles("[data-po-file]", PDF);
  await page.fill('[name="po_number"]', "P-1");
  await page.fill('[name="po_value"]', "1000");
  await page.fill('[name="years"]', "10");
  assert(!(await page.locator("[data-po-submit-confirm]").isDisabled()), "10 allowed");
  await page.fill('[name="years"]', "11");
  assert(await page.locator("[data-po-submit-confirm]").isDisabled(), "11 blocked");
  assert((await page.locator("[data-po-preview]").innerText()).includes("1 to 10"));
  await browser.close();
});
