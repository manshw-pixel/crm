// UI Stage 7 (Task 1): Finance head, currency cards, invoice + PO status pills. Targets data-* hooks.
// Seed: INR has one invoice overdue 31 days; USD has 5 (2 paid, 1 pending, 1 waived, 1 unsent);
// 2 submitted POs; 1 approved PO with 3 started periods (= 3 invoices due to raise).
import { test, assert } from "./framework.mjs";
import { launchFinance } from "./harness.mjs";

const DAY = 86400000;
const day = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const ACCT = (id, name) => ({ id, data: { id, name, tier: "Mid", arr: 0, currency: "INR", industry: "Tech", csm: "", startDate: "2025-01-01", renewalDate: `${new Date().getFullYear() + 2}-01-01`, contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: "2026-07-01" } });
const EMPTY = { contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
const ENT = (id, name, cur, prefix) => ({ id, org_id: "org-a", name, country: cur === "INR" ? "IN" : "US", currency: cur, invoice_prefix: prefix, next_number: 9, default_tax_pct: 0, state: "", address: "", tax_id: "", tax_id_label: "", bank_details: "", lut_number: null, created_at: "2026-01-01T00:00:00Z" });
const INV = o => ({ account_id: "a1", account_name: "Acme Ltd", currency: "USD", subtotal: 1000, total: 1000, status: "pending", sent_at: "2026-10-01T00:00:00Z", issue_date: day(-40), due_date: day(20), entity_id: "e2", pdf_path: "org-a/x.pdf", paid_date: null, payment_ref: null, waive_reason: null, ...o });
const INVOICES = [
  INV({ id: "i-ovd", number: "IN-0001", currency: "INR", subtotal: 236000, total: 236000, due_date: day(-31), issue_date: day(-60), entity_id: "e1" }),
  INV({ id: "u-p1", number: "US-0001", status: "paid", paid_date: day(-5), total: 2000, subtotal: 2000 }),
  INV({ id: "u-p2", number: "US-0002", status: "paid", paid_date: day(-4), total: 1500, subtotal: 1500 }),
  INV({ id: "u-pe", number: "US-0003", total: 700, subtotal: 700 }),
  INV({ id: "u-wa", number: "US-0004", status: "waived", waive_reason: "goodwill", total: 300, subtotal: 300 }),
  INV({ id: "u-un", number: "US-0005", sent_at: null, total: 450, subtotal: 450 }),
];
const PO = (id, acct, name, num, status, extra = {}) => ({ id, org_id: "org-a", account_id: acct, account_name: name, po_number: num, po_date: day(-30), po_value: 400000, currency: "INR", years: 1,
  billing_cycle: "quarterly", billing_start: day(-30), file_path: "org-a/x.pdf", status, submitted_by: "u1", reviewed_by: null, reviewed_at: null, reject_reason: null, created_at: "2026-10-01T00:00:00Z", ...extra });
const POS = [PO("po-a", "a1", "Acme Ltd", "4500001", "submitted"), PO("po-b", "a2", "Other Co", "4500002", "submitted"), PO("po-c", "a1", "Acme Ltd", "4500003", "approved")];
const SCHED = [1, 2, 3].map(i => ({ id: "s" + i, org_id: "org-a", po_id: "po-c", seq: i, invoice_id: null, amount: 100000, period_start: day(-100 + i * 10), period_end: day(-10 + i) }));
const TABLES = { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd"), ACCT("a2", "Other Co")], invoices: INVOICES, billing_entities: [ENT("e1", "OneVio India", "INR", "IN-"), ENT("e2", "OneVio Inc", "USD", "US-")],
  purchase_orders: POS, po_schedule: SCHED };

async function open({ theme = "light", w = 1440, tables = TABLES } = {}) {
  const r = await launchFinance({ user: { role: "admin" }, tables, seed: `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}` });
  await r.page.click('button[title="Finance"]', { timeout: 15000 });
  await r.page.waitForSelector("[data-finance-page]");
  await r.page.waitForSelector("[data-invoice-row]");
  await r.page.setViewportSize({ width: w, height: 900 });
  return r;
}
const sub = page => page.$eval("[data-fin-subtitle]", e => e.textContent.trim());
const settled = page => page.waitForFunction(() => /awaiting approval · \d+ invoices? due to raise · \d+ overdue/.test(document.querySelector("[data-fin-subtitle]")?.textContent || ""), null, { timeout: 8000 });

test("stage7 finance: subtitle counts POs, due periods and ALL overdue invoices; entity filter changes cards, not the subtitle", async () => {
  const { page, browser } = await open();
  try {
    await settled(page);
    assert(await sub(page) === "2 POs awaiting approval · 3 invoices due to raise · 1 overdue", "subtitle " + await sub(page));
    assert((await page.locator("main h1, h1").first().innerText()).trim() === "Finance", "app shell h1 kept");
    assert(!/Purchase orders, invoices to raise/.test(await page.locator("[data-finance-page]").innerText()), "old intro line removed");
    assert((await page.$$eval("[data-fin-summary-card]", c => c.map(x => x.dataset.finSummaryCard))).join() === "INR,USD", "cards before filter");
    await page.selectOption("[data-fin-filter-entity]", "e2");           // excludes the INR invoice
    await page.waitForFunction(() => document.querySelectorAll("[data-fin-summary-card]").length === 1);
    assert((await page.$$eval("[data-fin-summary-card]", c => c.map(x => x.dataset.finSummaryCard))).join() === "USD", "INR card gone");
    assert(await sub(page) === "2 POs awaiting approval · 3 invoices due to raise · 1 overdue", "subtitle must ignore filters: " + await sub(page));
    await page.selectOption("[data-fin-filter-status]", "paid");
    assert(await sub(page) === "2 POs awaiting approval · 3 invoices due to raise · 1 overdue", "subtitle ignores status filter too");
  } finally { await browser.close(); }
});

test("stage7 finance: nothing waiting when all three counts are zero", async () => {
  const { page, browser } = await open({ tables: { ...TABLES, invoices: INVOICES.filter(i => i.id !== "i-ovd"), purchase_orders: [], po_schedule: [] } });
  try {
    await page.waitForFunction(() => document.querySelector("[data-fin-subtitle]")?.textContent.trim() === "Nothing waiting", null, { timeout: 8000 });
  } finally { await browser.close(); }
});

test("stage7 finance: one card per currency, count, red overdue only when > 0, paid bar label unchanged", async () => {
  const { page, browser } = await open();
  try {
    const cards = await page.$$eval("[data-fin-summary-card]", c => c.map(x => ({ cur: x.dataset.finSummaryCard, count: x.querySelector("[data-fin-count]")?.textContent.trim(),
      h2: x.querySelector("h2")?.textContent.trim(), pct: x.querySelector(".fn-pct")?.textContent.trim(), bar: x.querySelector('[role=img]')?.getAttribute("aria-label"),
      od: getComputedStyle(x.querySelector(`[data-fin-summary-${x.dataset.finSummaryCard}-overdue]`)).color, fg: getComputedStyle(x.querySelector(`[data-fin-summary-${x.dataset.finSummaryCard}-waived]`)).color,
      sub: x.querySelector(`[data-fin-summary-${x.dataset.finSummaryCard}-overdue]`).parentElement.querySelector(".fn-fig-sub").textContent.trim() })));
    assert(cards.map(c => c.cur).join() === "INR,USD", "order " + JSON.stringify(cards));
    assert(cards[0].count === "1 invoice" && cards[1].count === "5 invoices", "counts " + JSON.stringify(cards.map(c => c.count)));
    assert(cards.every(c => c.h2 === c.cur), "h2 is the currency code");
    assert(cards[0].bar === "INR: 0% of paid plus pending is paid" && cards[1].bar.startsWith("USD: ") && / of paid plus pending is paid$/.test(cards[1].bar), "bar labels " + cards.map(c => c.bar));
    assert(cards[0].od !== cards[0].fg, "INR overdue (> 0) is red ink: " + cards[0].od + " vs " + cards[0].fg);
    assert(cards[1].od === cards[1].fg, "USD overdue (zero) uses neutral ink: " + cards[1].od + " vs " + cards[1].fg);
    assert(cards[0].sub === "1 invoice" && cards[1].sub === "0 invoices", "overdue subs " + cards.map(c => c.sub));
    assert(await page.locator("[data-fin-summary-INR-overdue]").getAttribute("title") === "INR 236,000.00", "exact amount title kept");
  } finally { await browser.close(); }
});

test("stage7 finance: invoice status pills use .ad-pill[data-sev], Overdue shows days", async () => {
  const { page, browser } = await open();
  try {
    const got = Object.fromEntries(await page.$$eval("[data-invoice-row]", rows => rows.map(r => { const p = r.querySelector("[data-invoice-status]");
      return [r.dataset.invoiceRow, { cls: p.classList.contains("ad-pill"), sev: p.dataset.sev, text: p.textContent.trim() }]; })));
    const want = { "US-0001": ["green", /^Paid$/], "US-0003": ["amber", /^Pending$/], "US-0004": ["grey", /^Waived$/], "US-0005": ["indigo", /^Unsent$/], "IN-0001": ["red", /^Overdue · \d+d$/] };
    for (const [n, [sev, re]] of Object.entries(want)) assert(got[n] && got[n].cls && got[n].sev === sev && re.test(got[n].text), `${n}: ${JSON.stringify(got[n])}`);
    assert(got["IN-0001"].text === "Overdue · 31d", "days past due: " + got["IN-0001"].text);
  } finally { await browser.close(); }
});

test("stage7 finance: PO status pill on the account page is amber for Awaiting approval", async () => {
  const { page, browser } = await open();
  try {
    await page.click('button[title="Accounts"]');
    await page.click('[data-account-row]:has-text("Acme Ltd")');
    await page.click('[data-account-tab="Purchase orders"]');
    const pill = page.locator('[data-po-row="4500001"] [data-po-status]');
    await pill.waitFor({ timeout: 8000 });
    assert(await pill.getAttribute("data-sev") === "amber" && (await pill.getAttribute("class")).includes("ad-pill") && /Awaiting approval/.test(await pill.innerText()), "amber pill");
    assert(await page.locator('[data-po-row="4500003"] [data-po-status]').getAttribute("data-sev") === "green", "approved is green");
  } finally { await browser.close(); }
});

test("stage7 finance: Export CSV output is unchanged (old function body reproduced here)", async () => {
  const { page, browser } = await open();
  try {
    const order = await page.$$eval("[data-invoice-row]", r => r.map(x => x.dataset.invoiceRow));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-fin-export]")]);
    const { createReadStream } = await import("node:fs");
    let got = ""; for await (const c of createReadStream(await dl.path())) got += c;
    const csvCell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const toCents = n => { const x = Number(n) || 0, c = Math.round(Number(x + "e2")); return Number.isFinite(c) ? c : Math.round(x * 100); };
    const fromCents = c => c / 100, today = day(0);
    const status = i => i.status === "paid" || i.status === "waived" ? i.status : !i.sent_at ? "unsent" : String(i.due_date) < today ? "overdue" : "pending";
    const ent = id => (TABLES.billing_entities.find(e => e.id === id) || {}).name || "";
    const cols = ["Number", "Account", "Entity", "Currency", "Issue date", "Due date", "Subtotal", "Tax", "Total", "Status", "Paid date", "Payment ref", "Waive reason"];
    const lines = order.map(n => INVOICES.find(x => x.number === n)).map(i => [i.number, i.account_name, ent(i.entity_id), i.currency, i.issue_date, i.due_date, i.subtotal, fromCents(toCents(i.total) - toCents(i.subtotal)), i.total,
      status(i), i.paid_date, i.payment_ref, i.waive_reason].map(csvCell).join(","));
    const want = [cols.map(csvCell).join(","), ...lines].join("\n");
    assert(got === want, "csv differs:\n" + got + "\n---\n" + want);
  } finally { await browser.close(); }
});

const PAGE_FNS = `window.__c = (() => {
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = s => (s.match(/[\\d.]+/g) || [0, 0, 0]).map(Number);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const rgba = s => { const c = parse(s); return c.length < 4 ? [...c.slice(0, 3), 1] : c.slice(0, 4); };
  const over = (top, a, base) => top.map((v, i) => v * a + base[i] * (1 - a));
  const opOf = e => { let o = 1; for (let x = e; x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
  const bgOf = e => { const layers = [];
    for (let x = e; x; x = x.parentElement) { const c = rgba(getComputedStyle(x).backgroundColor), a = c[3] * opOf(x);
      if (a >= 1) return layers.reduceRight((b, [col, al]) => over(col, al, b), c.slice(0, 3)); if (a > 0) layers.push([c.slice(0, 3), a]); }
    return null; };
  const textOn = e => { const bg = bgOf(e); if (!bg) return null; const c = rgba(getComputedStyle(e).color); return ratio(over(c.slice(0, 3), c[3] * opOf(e), bg), bg); };
  return { textOn };
})();`;
for (const theme of ["light", "dark"]) test(`stage7 finance: text contrast >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await open({ theme });
  try {
    await settled(page);
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const { textOn } = window.__c, low = [], seen = {};
      const sels = { subtitle: "[data-fin-subtitle]", code: ".fn-cur-code", count: "[data-fin-count]", pct: ".fn-pct", label: ".fn-fig-label", value: ".fn-fig-val", figsub: ".fn-fig-sub",
        panel: ".fn-panel-title", pcount: ".fn-panel-count", flabel: ".fn-flabel", th: ".fn-table th", no: ".fn-table .fn-no", date: ".fn-table .fn-date", amt: ".fn-table .fn-amt", acct: ".fn-table .fn-acct",
        pill: "[data-invoice-status]", mini: ".fn-table .fn-mini", field: ".fn-field" };
      for (const [k, sel] of Object.entries(sels)) {
        const els = document.querySelectorAll(sel); seen[k] = els.length;
        for (const e of els) { const c = textOn(e); if (c === null || c < 4.5) low.push(k + " " + (c === null ? "no bg" : c.toFixed(2)) + " " + e.textContent.trim().slice(0, 24)); }
      }
      return { low, seen, dark: document.documentElement.classList.contains("dark") };
    });
    assert(r.dark === (theme === "dark"), "theme applied");
    assert(r.seen.subtitle === 1 && r.seen.value === 8 && r.seen.th >= 6 && r.seen.pill === 6 && r.seen.amt === 6, "targets " + JSON.stringify(r.seen));
    assert(r.low.length === 0, "low contrast: " + r.low.join(" | "));
  } finally { await browser.close(); }
});

for (const w of [1280, 1440]) test(`stage7 finance: the four figures sit on one row or exactly 2x2, never 3+1 (${w}px)`, async () => {
  const { page, browser } = await open({ w });
  try {
    await settled(page);
    const rows = await page.$$eval("[data-fin-summary-card]", cs => cs.map(c => ["paid", "pending", "overdue", "waived"].map(k => c.querySelector(`[data-fin-summary-${c.dataset.finSummaryCard}-${k}]`).offsetTop)));
    assert(rows.length === 2, "two currency cards");
    for (const tops of rows) { const n = new Set(tops).size; const per = tops.filter(t => t === tops[0]).length;
      assert((n === 1) || (n === 2 && per === 2 && tops[0] === tops[1] && tops[2] === tops[3]), `figures wrap badly at ${w}: ${tops}`); }
  } finally { await browser.close(); }
});
