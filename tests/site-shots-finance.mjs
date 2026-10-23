// Finance screenshots for onevio.in. Renders the built CRM (dist/crm.html) against a fictional
// book (Acme Analytics billing its own customers) and writes 2x PNGs to site-shots/, next to the
// ones tests/site-shots.mjs makes. Run `npm run build` first.
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { launchFinance } from "./health/harness.mjs";

const OUT = fileURLToPath(new URL("../site-shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const pad = n => String(n).padStart(2, "0");
const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addMonths = (iso, m) => { const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + m); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const ACCT = (id, name, cur) => ({ id, data: { id, name, tier: "Mid", arr: 0, currency: cur, industry: "Tech", csm: "Rahul", startDate: "2025-01-01", renewalDate: "2027-09-01", contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: day(-20) } });
const accounts = [
  ACCT("a1", "Northwind Logistics", "INR"), ACCT("a2", "Bluepeak Health", "USD"), ACCT("a3", "Lumen Retail", "INR"),
  ACCT("a4", "Harbor Freight Co", "USD"), ACCT("a5", "Kestrel Manila", "PHP"), ACCT("a6", "Orbit Fintech", "INR"),
];
const name = Object.fromEntries(accounts.map(a => [a.id, a.data.name]));

const entities = [
  { id: "e1", org_id: "org-a", name: "Acme Analytics Pvt Ltd", country: "IN", currency: "INR", invoice_prefix: "IN/2026-27/", default_tax_pct: 18, state: "Karnataka" },
  { id: "e2", org_id: "org-a", name: "Acme Analytics Inc.", country: "US", currency: "USD", invoice_prefix: "US-", default_tax_pct: 0 },
  { id: "e3", org_id: "org-a", name: "Acme Analytics Philippines Inc.", country: "PH", currency: "PHP", invoice_prefix: "PH-", default_tax_pct: 12 },
];

const PO = o => ({ org_id: "org-a", years: 1, file_path: "org-a/po.pdf", submitted_by: "u2", created_at: day(-60) + "T00:00:00Z", ...o, account_name: name[o.account_id] });
const pos = [
  PO({ id: "p1", account_id: "a1", po_number: "4500012345", po_value: 1440000, currency: "INR", status: "approved", billing_cycle: "quarterly", po_date: day(-80), billing_start: day(-75) }),
  PO({ id: "p2", account_id: "a2", po_number: "BPH-2026-114", po_value: 96000, currency: "USD", status: "approved", billing_cycle: "half_yearly", po_date: day(-40), billing_start: day(-10) }),
  PO({ id: "p3", account_id: "a6", po_number: "OF/PO/0921", po_value: 600000, currency: "INR", status: "approved", billing_cycle: "quarterly", po_date: day(-20), billing_start: day(-5) }),
  PO({ id: "p4", account_id: "a5", po_number: "KM-881", po_value: 2400000, currency: "PHP", status: "submitted", billing_cycle: "annual", years: 2, po_date: day(-3), billing_start: day(10) }),
  PO({ id: "p5", account_id: "a4", po_number: "HF-77120", po_value: 54000, currency: "USD", status: "submitted", billing_cycle: "quarterly", po_date: day(-2), billing_start: day(8) }),
];
const sch = [];
const S = (po, seq, months, amount, invoice_id = null) => {
  const start = addMonths(po.billing_start, (seq - 1) * months);
  const end = addMonths(start, months); const e = new Date(end + "T00:00:00"); e.setDate(e.getDate() - 1);
  sch.push({ id: `s${sch.length + 1}`, org_id: "org-a", po_id: po.id, seq, period_start: start, period_end: `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`, amount, invoice_id });
};
[1, 2, 3, 4].forEach(q => S(pos[0], q, 3, 360000, q === 1 ? "i1" : null));
[1, 2].forEach(h => S(pos[1], h, 6, 48000));
[1, 2, 3, 4].forEach(q => S(pos[2], q, 3, 150000));

const I = o => ({ org_id: "org-a", status: "pending", sent_at: day(-1) + "T00:00:00Z", pdf_path: "org-a/x.pdf", line_items: [], tax_lines: [], ...o, account_name: name[o.account_id] });
const gst = n => +(n * 1.18).toFixed(2);
const invoices = [
  I({ id: "i1", number: "IN/2026-27/0014", account_id: "a1", entity_id: "e1", currency: "INR", subtotal: 360000, total: gst(360000), issue_date: day(-74), due_date: day(-44), status: "paid", paid_date: day(-50), payment_ref: "UTR40912288" }),
  I({ id: "i2", number: "IN/2026-27/0016", account_id: "a3", entity_id: "e1", currency: "INR", subtotal: 210000, total: gst(210000), issue_date: day(-38), due_date: day(-8) }),
  I({ id: "i3", number: "IN/2026-27/0017", account_id: "a6", entity_id: "e1", currency: "INR", subtotal: 85000, total: gst(85000), issue_date: day(-12), due_date: day(18) }),
  I({ id: "i4", number: "IN/2026-27/0015", account_id: "a3", entity_id: "e1", currency: "INR", subtotal: 40000, total: gst(40000), issue_date: day(-55), due_date: day(-25), status: "waived", waive_reason: "Service credit for March outage" }),
  I({ id: "i5", number: "US-0042", account_id: "a2", entity_id: "e2", currency: "USD", subtotal: 24000, total: 24000, issue_date: day(-65), due_date: day(-35), status: "paid", paid_date: day(-37), payment_ref: "ACH 7731" }),
  I({ id: "i6", number: "US-0044", account_id: "a4", entity_id: "e2", currency: "USD", subtotal: 13500, total: 13500, issue_date: day(-20), due_date: day(10) }),
  I({ id: "i7", number: "US-0043", account_id: "a4", entity_id: "e2", currency: "USD", subtotal: 13500, total: 13500, issue_date: day(-50), due_date: day(-20), status: "paid", paid_date: day(-22), payment_ref: "Wire 0918" }),
  I({ id: "i8", number: "PH-0009", account_id: "a5", entity_id: "e3", currency: "PHP", subtotal: 600000, total: 672000, issue_date: day(-30), due_date: day(0), status: "paid", paid_date: day(-4), payment_ref: "BDO-55120" }),
  I({ id: "i9", number: "PH-0010", account_id: "a5", entity_id: "e3", currency: "PHP", subtotal: 150000, total: 168000, issue_date: day(-6), due_date: day(24) }),
];

const users = [{ id: "u2", name: "Rahul", role: "csm", org_id: "org-a", platform_admin: false, disabled: false, finance: false, email: "rahul@acme.test" }];
const { page, browser } = await launchFinance({
  user: { name: "Priya", role: "admin", finance: true },
  users,
  tables: { accounts, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
    orgs: [{ id: "org-a", name: "Acme Analytics", max_accounts: null, max_users: null }],
    billing_entities: entities, purchase_orders: pos, po_schedule: sch, invoices },
  pageOpts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "light" },
});
const results = [];
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
try {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.getByRole("button", { name: "Finance" }).first().click();
  await page.waitForSelector("[data-fin-export]", { timeout: 15000 });
  await page.waitForTimeout(1200);
  const bad = await page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"]')].map(e => e.textContent).filter(t => /fail|error|could not/i.test(t)));
  if (bad.length) throw new Error("error toast on screen: " + bad.join(" | "));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUT + "finance.png" }); results.push("finance.png");
  await page.screenshot({ path: OUT + "finance-full.png", fullPage: true }); results.push("finance-full.png");
  if (errors.length) console.warn("page errors:", errors);
} finally {
  await browser.close();
}
console.log("wrote", results.length, "files to", OUT + "\n" + results.join("\n"));
