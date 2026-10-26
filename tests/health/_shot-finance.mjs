import { launchFinance } from "./harness.mjs";
const out = process.argv[2], tag = process.argv[3] || "before";
const ACCT = (id, name, cur = "INR") => ({ id, data: { id, name, tier: "Mid", arr: 0, currency: cur, industry: "Tech", csm: "", startDate: "2025-01-01", renewalDate: "2028-01-01", contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: "2026-07-01" } });
const EMPTY = { contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
const ents = [{ id: "e1", org_id: "org-a", name: "OneVio Technologies Pvt Ltd", country: "IN", currency: "INR", invoice_prefix: "OV-IN-", default_tax_pct: 18, state: "Maharashtra" },
  { id: "e2", org_id: "org-a", name: "OneVio Inc.", country: "US", currency: "USD", invoice_prefix: "OV-US-", default_tax_pct: 0 }];
const PO = o => ({ org_id: "org-a", po_date: "2026-09-01", years: 1, billing_cycle: "quarterly", billing_start: "2026-09-01", file_path: "org-a/x.pdf", submitted_by: "u1", created_at: "2026-09-01T00:00:00Z", ...o });
const pos = [PO({ id: "p1", account_id: "a1", account_name: "Acme Retail India Ltd", po_number: "4500012345", po_value: 480000, currency: "INR", status: "approved" }),
  PO({ id: "p2", account_id: "a2", account_name: "Northwind Traders LLC", po_number: "NW-2026-07", po_value: 72000, currency: "USD", status: "approved", billing_cycle: "half_yearly" }),
  PO({ id: "p3", account_id: "a3", account_name: "Globex Philippines", po_number: "GX-881", po_value: 1200000, currency: "PHP", status: "submitted", billing_cycle: "annual", years: 2 })];
const sch = [["s1","p1",1,"2026-09-01","2026-11-30",120000,"i1"],["s2","p1",2,"2026-12-01","2027-02-28",120000,null],["s3","p1",3,"2027-03-01","2027-05-31",120000,null],["s4","p1",4,"2027-06-01","2027-08-31",120000,null],
  ["s5","p2",1,"2026-09-01","2027-02-28",36000,null],["s6","p2",2,"2027-03-01","2027-08-31",36000,null]].map(([id,po_id,seq,period_start,period_end,amount,invoice_id]) => ({ id, org_id: "org-a", po_id, seq, period_start, period_end, amount, invoice_id }));
const I = o => ({ org_id: "org-a", status: "pending", sent_at: "2026-09-02T00:00:00Z", pdf_path: "org-a/x.pdf", line_items: [], tax_lines: [], ...o });
const invs = [I({ id: "i1", number: "OV-IN-0007", account_id: "a1", account_name: "Acme Retail India Ltd", entity_id: "e1", currency: "INR", subtotal: 120000, total: 141600, issue_date: "2026-09-02", due_date: "2026-10-02" }),
  I({ id: "i2", number: "OV-IN-0006", account_id: "a1", account_name: "Acme Retail India Ltd", entity_id: "e1", currency: "INR", subtotal: 100000, total: 118000, issue_date: "2026-06-02", due_date: "2026-07-02", status: "paid", paid_date: "2026-06-28", payment_ref: "UTR88231" }),
  I({ id: "i3", number: "OV-US-0003", account_id: "a2", account_name: "Northwind Traders LLC", entity_id: "e2", currency: "USD", subtotal: 36000, total: 36000, issue_date: "2026-10-01", due_date: "2026-10-31" }),
  I({ id: "i4", number: "OV-US-0002", account_id: "a2", account_name: "Northwind Traders LLC", entity_id: "e2", currency: "USD", subtotal: 5000, total: 5000, issue_date: "2026-04-01", due_date: "2026-05-01", status: "waived", waive_reason: "Goodwill credit" }),
  I({ id: "i5", number: "OV-IN-0008", account_id: "a1", account_name: "Acme Retail India Ltd", entity_id: "e1", currency: "INR", subtotal: 20000, total: 23600, issue_date: "2026-10-10", due_date: "2026-11-09", sent_at: null, pdf_path: null })];
for (const [w, h, name] of [[1440, 1000, "desktop"], [390, 844, "mobile"]]) {
  const { page, browser } = await launchFinance({ user: { role: "admin", finance: true }, tables: { ...EMPTY, accounts: [ACCT("a1", "Acme Retail India Ltd"), ACCT("a2", "Northwind Traders LLC", "USD"), ACCT("a3", "Globex Philippines", "PHP")], billing_entities: ents, purchase_orders: pos, po_schedule: sch, invoices: invs } });
  await page.setViewportSize({ width: w, height: h });
  if (name === "mobile") { const m = page.locator('button[aria-label*="menu" i]'); if (await m.count()) await m.first().click(); }
  await page.getByRole("button", { name: "Finance" }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
  await browser.close();
}
