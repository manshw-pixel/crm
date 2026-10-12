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

// ---- Task 6: invoice form, PDF and send flow ----
const isoDay = d => d.toISOString().slice(0, 10);
const START = isoDay(new Date(Date.now() - 864e5));   // yesterday: only period 1 has started
const periodAt = (k, step = 3) => { const d = new Date(START + "T00:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k * step); return isoDay(d); };
const APPROVED_PO = { id: "po1", org_id: "org-a", account_id: "a1", account_name: "Acme Ltd", po_number: "4500123", po_date: START, po_value: 480000, currency: "INR",
  years: 1, billing_cycle: "quarterly", billing_start: START, file_path: "org-a/a1/x.pdf", status: "approved", submitted_by: "u1", reviewed_by: "u1", reviewed_at: "2026-10-01T00:00:00Z", reject_reason: null, created_at: "2026-10-01T00:00:00Z" };
const ITEMS = [0, 1, 2, 3].map(i => ({ id: `s${i + 1}`, org_id: "org-a", po_id: "po1", seq: i + 1, invoice_id: null, amount: 120000,
  period_start: i === 0 ? START : periodAt(i), period_end: isoDay(new Date(Date.parse((i === 3 ? periodAt(4) : periodAt(i + 1)) + "T00:00:00Z") - 864e5)) }));
const IN_ENTITY = { id: "e1", org_id: "org-a", name: "OneVio India", country: "IN", currency: "INR", invoice_prefix: "IN-", next_number: 1, default_tax_pct: 18,
  state: "Maharashtra", address: "1 MG Road", tax_id: "27ABCDE1234F1Z5", tax_id_label: "GSTIN", bank_details: "HDFC 0001", lut_number: null, created_at: "2026-01-01T00:00:00Z" };
const openRaise = async (patch, user = { role: "user", finance: true }, seed = "") => {
  const r = await launchFinance({ user, seed, tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd", patch)], invoices: [], billing_entities: [IN_ENTITY], purchase_orders: [APPROVED_PO], po_schedule: ITEMS } });
  await r.page.click('button[title="Finance"]', { timeout: 15000 });
  return r;
};
const invoiceRpcs = page => page.evaluate(() => window.__rpcCalls.map(c => c.fn).filter(n => /invoice/.test(n)));

test("raise invoice: Apply tax defaults off for a tax-exempt account and can be toggled", async () => {
  const { page, browser } = await openRaise({ country: "IN", customerState: "Karnataka", billingEmail: "ap@acme.test", taxExempt: true, taxExemptNote: "SEZ unit" });
  await page.click('[data-due-item="s1"] [data-raise]');
  assert((await page.isChecked("[data-apply-tax]")) === false, "starts unchecked for an exempt account");
  assert(/120,000\.00/.test(await page.innerText("[data-inv-total]")), "untaxed total");
  assert(/SEZ unit/.test(await page.innerText("[data-invoice-form]")), "exemption note shown");
  await page.check("[data-apply-tax]");
  assert(/141,600\.00/.test(await page.innerText("[data-inv-total]")), "taxed total");
  await page.uncheck("[data-apply-tax]");
  await page.click("[data-inv-send]");
  await page.waitForFunction(() => window.__rpcCalls.some(c => c.fn === "create_invoice" && c.args.p.tax_exempt === true && c.args.p.tax_lines.length === 0), null, { timeout: 5000 });
  await browser.close();
});

test("raise invoice: blocks without billing email", async () => {
  const { page, browser } = await openRaise({ country: "IN", billingEmail: "" });
  await page.click('[data-due-item="s1"] [data-raise]');
  await page.waitForSelector("[data-inv-block]:has-text('billing email')", { timeout: 5000 });
  assert(await page.locator("[data-inv-send]").isDisabled(), "send disabled");
  await browser.close();
});

test("raise invoice: only started periods are due; prefills from the PO item, computes GST, sends", async () => {
  const { page, browser } = await openRaise({ country: "IN", customerState: "Karnataka", billingEmail: "ap@acme.test", currency: "INR" });
  await page.waitForSelector("[data-due-item]", { timeout: 5000 });
  assert((await page.locator("[data-due-item]").count()) === 1, "only period 1 is due");
  await page.click('[data-due-item="s1"] [data-raise]');
  const desc = await page.inputValue("[data-line-desc]");
  assert(desc.includes("Year 1 Q1") && desc.includes(`(${START} – ${ITEMS[0].period_end})`) && desc.includes("PO 4500123"), desc);
  assert((await page.inputValue("[data-line-rate]")) === "120000", "rate prefilled");
  assert(/IGST 18%/.test(await page.innerText("[data-invoice-form]")), "IGST for an out-of-state customer");
  assert(/141,600\.00/.test(await page.innerText("[data-inv-total]")), "120000 + 18%");
  await page.click("[data-inv-send]");
  await page.waitForSelector('[data-invoice-row="IN-0001"]', { timeout: 8000 });
  const order = await invoiceRpcs(page);
  assert(JSON.stringify(order.slice(-3)) === JSON.stringify(["create_invoice", "attach_invoice_pdf", "send_invoice"]), JSON.stringify(order));
  const calls = await page.evaluate(() => window.__rpcCalls);
  assert(calls.find(c => c.fn === "create_invoice").args.p.schedule_id === "s1", "keyed on the schedule item");
  const send = calls.find(c => c.fn === "send_invoice").args;
  assert(Buffer.from(send.p_pdf_base64, "base64").toString("latin1").startsWith("%PDF"), "a real PDF was attached");
  assert((await page.locator("[data-due-item]").count()) === 0, "due list is empty after sending");
  assert((await page.locator("[data-invoice-form]").count()) === 0, "form closed");
  await browser.close();
});

test("raise invoice: a send failure leaves an Unsent invoice with Retry and keeps the form open", async () => {
  const { page, browser } = await openRaise({ country: "IN", customerState: "Karnataka", billingEmail: "ap@acme.test" }, undefined, `window.__sendInvoiceError = "Brevo down";`);
  await page.click('[data-due-item="s1"] [data-raise]');
  await page.click("[data-inv-send]");
  await page.waitForSelector('[data-invoice-form] :text("Brevo down")', { timeout: 8000 });
  await page.waitForSelector('[data-invoice-row="IN-0001"] [data-invoice-status]:has-text("Unsent")', { timeout: 5000 });
  assert((await page.locator('[data-invoice-row="IN-0001"] [data-resend]').innerText()) === "Retry send", "Retry send offered");
  assert(await page.locator("[data-inv-send]").isDisabled(), "a second click cannot create a duplicate invoice");
  await browser.close();
});

test("raise invoice: renderInvoicePdf produces a multi-line PDF and tolerates hostile text", async () => {
  const { page, browser } = await openRaise({ country: "IN" });
  const head = await page.evaluate(async () => {
    const blob = renderInvoicePdf({ inv: { number: "IN-0001", currency: "INR", issue_date: "2026-10-12", due_date: "2026-11-11", account_name: "<img src=x onerror=alert(1)> ₹ Ltd",
      line_items: Array.from({ length: 60 }, (_, i) => ({ description: "Line " + i + " ".repeat(2) + "x".repeat(200), qty: 1, rate: 10, amount: 10 })), subtotal: 600,
      tax_lines: [{ label: "IGST", pct: 18, amount: 108 }], tax_note: null, total: 708 },
      entity: { name: "OneVio", address: "A\nB", tax_id: "T", tax_id_label: "GSTIN", bank_details: "bank" }, account: { billingAddress: "x" }, po: { po_number: "P1" } });
    return { type: blob.type, text: String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()).slice(0, 5)) };
  });
  assert(await page.evaluate(() => pdfText("\u20B9 5,000 \u0939") === "Rs. 5,000 ?"), "rupee sign maps to Rs., other non-Latin to ?");
  assert(head.type === "application/pdf" && head.text === "%PDF-", JSON.stringify(head));
  await browser.close();
});

// ---- finance page
const openPage = async (invoices, extra = {}, user = { role: "user", finance: true }) => {
  const r = await launchFinance({ user, tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd")], invoices, billing_entities: [IN_ENTITY], ...extra } });
  await r.page.click('button[title="Finance"]', { timeout: 15000 });
  await r.page.waitForSelector("[data-finance-page]");
  return r;
};
const MIXED = [
  INV({ id: "i1", number: "IN-0001", total: 100, status: "paid", paid_date: "2026-10-02", account_name: "Acme Ltd", subtotal: 100 }),
  INV({ id: "i2", number: "IN-0002", total: 50, due_date: "2026-10-05", account_name: "Acme Ltd", subtotal: 50 }),
  INV({ id: "i3", number: "IN-0003", currency: "USD", total: 10, status: "waived", waive_reason: "goodwill", account_name: "Acme Ltd", subtotal: 10, entity_id: "e2" })];

test("finance page: summary per currency, status filter, summary ignores status filter", async () => {
  const { page, browser } = await openPage(MIXED);
  await page.waitForSelector("[data-invoice-row]");
  assert(/100\.00/.test(await page.innerText("[data-fin-summary-INR-paid]")));
  assert(/50\.00/.test(await page.innerText("[data-fin-summary-INR-overdue]")));
  assert(/50\.00/.test(await page.innerText("[data-fin-summary-INR-pending]")), "pending includes overdue");
  assert(/10\.00/.test(await page.innerText("[data-fin-summary-USD-waived]")));
  await page.selectOption("[data-fin-filter-status]", "overdue");
  assert((await page.locator("[data-invoice-row]").count()) === 1);
  assert(/100\.00/.test(await page.innerText("[data-fin-summary-INR-paid]")), "summary unaffected by the status filter");
  await page.selectOption("[data-fin-filter-status]", "all");
  await page.fill("[data-fin-search]", "0003");
  assert((await page.locator("[data-invoice-row]").count()) === 1);
  await browser.close();
});

test("finance page: PO queue is mounted, and upcoming periods are greyed out with no Raise", async () => {
  const { page, browser } = await openPage([], { purchase_orders: [{ ...APPROVED_PO, id: "po2", po_number: "SUB1", status: "submitted" }, APPROVED_PO], po_schedule: ITEMS });
  await page.waitForSelector("[data-po-queue] [data-po-review]", { timeout: 5000 });
  assert((await page.locator("[data-due-item]").count()) === 1, "only period 1 is due");
  assert((await page.locator("[data-upcoming-item]").count()) === 0, "hidden until toggled");
  await page.click("[data-upcoming-toggle]");
  assert((await page.locator("[data-upcoming-item]").count()) === 3);
  assert((await page.locator("[data-upcoming-item] [data-raise]").count()) === 0);
  await browser.close();
});

test("finance page: CSV export neutralises formula cells", async () => {
  const { page, browser } = await openPage([INV({ id: "i9", number: "IN-0009", account_name: '=HYPERLINK("http://x","y")', subtotal: 1000 })]);
  await page.waitForSelector("[data-invoice-row]");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click("[data-fin-export]")]);
  const chunks = []; for await (const c of await dl.createReadStream()) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  assert(dl.suggestedFilename() === "invoices.csv");
  assert(text.split("\n")[0].startsWith('"Number","Account","Entity"'), text);
  assert(text.includes(`"'=HYPERLINK(""http://x"",""y"")"`), text);
  assert(text.includes('"180"') || text.includes('"IN-0009"'), text);
  await browser.close();
});

test("finance page: read-only for a CSM, who still sees the page, summary, filters and CSV", async () => {
  const { page, browser } = await openPage(MIXED, { purchase_orders: [{ ...APPROVED_PO, id: "po2", po_number: "SUB1", status: "submitted" }, APPROVED_PO], po_schedule: ITEMS },
    { role: "user", finance: false });
  await page.waitForSelector("[data-invoice-row]");
  await page.waitForSelector("[data-po-queue] [data-po-row]");
  assert(/100\.00/.test(await page.innerText("[data-fin-summary-INR-paid]")));
  assert((await page.locator("[data-due-item]").count()) === 1, "due list is visible");
  assert((await page.locator("[data-raise]").count()) === 0, "no Raise buttons");
  assert((await page.locator("[data-po-review]").count()) === 0, "no approve/reject/manage");
  assert((await page.locator("[data-paid-checkbox]").count()) === 0 && (await page.locator("[data-waive]").count()) === 0, "no status actions");
  assert((await page.locator("[data-download]").count()) > 0, "PDF download allowed");
  await page.selectOption("[data-fin-filter-status]", "overdue");
  assert((await page.locator("[data-invoice-row]").count()) === 1);
  assert(await page.locator("[data-fin-export]").isEnabled(), "CSV export allowed");
  await browser.close();
});

// ---- Task 8: dashboard finance card (real clock: dates are derived from today)
const TODAY = isoDay(new Date());
const QSTART = (() => { const [y, m] = TODAY.split("-").map(Number); return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`; })();
const PREV_Q = isoDay(new Date(Date.parse(QSTART + "T00:00:00Z") - 864e5));
const YESTERDAY = isoDay(new Date(Date.now() - 864e5));
const openDash = async (invoices, extra = {}, user = { role: "user", finance: false }) => {
  const r = await launchFinance({ user, tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd")], invoices, billing_entities: [IN_ENTITY], ...extra } });
  await r.page.waitForSelector("[data-license-card]", { timeout: 15000 });
  await r.page.evaluate(() => new Promise(res => setTimeout(res, 300)));
  return r;
};

test("dashboard finance card: this quarter per currency, link opens Finance", async () => {
  const { page, browser } = await openDash([
    INV({ id: "d1", number: "A", total: 100, subtotal: 100, status: "paid", paid_date: TODAY, issue_date: TODAY }),
    INV({ id: "d2", number: "B", total: 40, subtotal: 40, issue_date: TODAY, due_date: YESTERDAY }),
    INV({ id: "d3", number: "C", total: 999, subtotal: 999, status: "paid", paid_date: PREV_Q, issue_date: PREV_Q })]);
  const row = await page.locator("[data-finance-card] [data-fin-card-INR]").innerText();
  assert(/Paid\s*INR 100\.00/.test(row), row);
  assert(/Pending \(incl\. overdue\)\s*INR 40\.00/.test(row), row);
  assert(/1 overdue/.test(row), row);
  assert((await page.locator("[data-fin-card-donut]").count()) === 1, "donut");
  await page.click("[data-fin-card-link]");
  await page.waitForSelector("[data-finance-page]");
  await browser.close();
});

test("dashboard finance card shows PO and due counts, and a load error", async () => {
  const { page, browser } = await openDash([], { purchase_orders: [APPROVED_PO, { ...APPROVED_PO, id: "po2", po_number: "X2", status: "submitted" }], po_schedule: ITEMS });
  assert(/1 PO awaiting approval/.test(await page.innerText("[data-fin-card-pos]")));
  assert(/1 invoice due to raise/.test(await page.innerText("[data-fin-card-due]")));
  await browser.close();
  const e = await launchFinance({ user: { role: "user" }, seed: 'window.__selectErrors = { invoices: "boom" };', tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd")], invoices: [] } });
  await e.page.waitForSelector("[data-fin-card-error]", { timeout: 15000 });
  assert(/boom/.test(await e.page.innerText("[data-fin-card-error]")));
  await e.browser.close();
});

test("dashboard finance card is absent when there are no invoices and no POs", async () => {
  const { page, browser } = await openDash([]);
  assert((await page.locator("[data-finance-card]").count()) === 0);
  await browser.close();
});
