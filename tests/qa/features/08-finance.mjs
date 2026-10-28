import assert from "node:assert/strict";
import { SkipScenario } from "../core.mjs";
import { openAccount, isoPlus } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { waitForRunAccounts } from "./_store.mjs";
import { waitForSaved } from "../reset.mjs";
import { computeTotals, buildSchedule, periodLabel } from "../../../src/lib/invoice.js";

const F = "08-finance";
// Invoices and POs cannot be deleted, so each lives on a run account and is found by runId.
const INV_ACCT = runId => `QA ${runId} Harbor Pharma`;   // INR fixture row
const PO_ACCT = runId => `QA ${runId} Orchid Bank`;      // PHP fixture row
const INV_PO = runId => `${runId}-INV`;                  // PO that the invoice is raised from
const SCHED_PO = runId => `${runId}-SCHED`;              // PO for the schedule scenario
// The two invoice lines the brief names: 10,000 x 1 and 2,500 x 2.
const LINES = runId => [
  { description: `QA ${runId} licence`, qty: 1, rate: 10000 },
  { description: `QA ${runId} services`, qty: 2, rate: 2500 },
];
// The invoice scenarios find "the run invoice" by searching the seeded account's run id, so a
// --skip-reset rerun would see the previous run's invoice. They need a freshly seeded run.
const needFreshSeed = ({ runId, thisRunId }) => {
  if (thisRunId && thisRunId !== runId) throw new SkipScenario(`invoice scenarios need a fresh seed (--skip-reset reuses ${runId})`);
};
const SETUP = "No INR billing entity in the Crm org, so no invoice can be raised. One-time setup: sign in as the QA admin -> "
  + "Settings -> Billing entities -> Add entity with Country IN (currency INR, Default tax % 18, any name/address/state), then rerun.";

// A minimal valid PDF for the PO document upload (the form requires a file).
const PO_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
  + "trailer<</Root 1 0 R>>\n%%EOF\n");

// en-US 2-dp, as the invoice form's fmt() (src/27-invoice-form.jsx:119).
const two = n => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// READ-ONLY: the org's billing entities, through the app's own client (entities are not in the
// store; useInvoices reads them the same way, src/14-invoices.jsx:352).
const inrEntity = async page => {
  const rows = await page.evaluate(async () => (await sb.from("billing_entities").select("*")).data || []);
  return rows.find(e => e.currency === "INR") || null;
};
const storeAccount = (page, name) => page.evaluate(n => {
  const a = window.__store.getState().accounts.find(x => x.name === n);
  return a && { id: a.id, name: a.name, country: a.country, customerState: a.customerState, taxExempt: a.taxExempt, taxExemptNote: a.taxExemptNote, billingEntityId: a.billingEntityId };
}, name);

// The panels render their "empty" text before their first fetch lands, so wait for the three
// fetches the page makes on mount (useInvoices, POQueue's and DueToRaise's usePurchaseOrders).
async function openFinance(page) {
  if (await page.locator("[data-finance-page]").count()) await nav(page, "Dashboard").click();
  const got = u => page.waitForResponse(r => r.request().method() === "GET" && u(r.url()), { timeout: 20000 });
  const loads = [got(u => u.includes("/rest/v1/invoices?")), got(u => u.includes("/rest/v1/purchase_orders?") && u.includes("status=eq.submitted")),
    got(u => u.includes("/rest/v1/purchase_orders?") && u.includes("status=eq.approved"))];
  await nav(page, "Finance").click();
  await Promise.all(loads);
  await page.locator("[data-finance-page]").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500); // po_schedule follows its POs; let it and the render land
}
// Invoices panel filtered by search text + status; returns the row numbers once the list settles.
async function invoiceRows(page, q, status = "all") {
  if (!await page.locator("[data-finance-page]").count()) await openFinance(page);
  await page.locator("[data-fin-filter-status]").selectOption(status);
  await page.getByLabel("Search invoices").fill(q);
  await page.waitForTimeout(400);
  await page.locator("[data-invoice-row], [data-invoices-empty]").first().waitFor({ timeout: 15000 });
  return page.locator("[data-invoice-row]").evaluateAll(els => els.map(e => e.getAttribute("data-invoice-row")));
}
const invoiceRow = (page, number) => page.locator(`[data-invoice-row="${number}"]`);

// Submit a PO from the account's Purchase orders tab (POForm, src/14-purchase-orders.jsx:60-121).
// Returns the preview's period rows as shown. A PO already on the account (a retry) is left as is.
async function submitPO(page, acct, v) {
  await openAccount(page, acct);
  await page.locator('[data-account-tab="Purchase orders"]').click();
  await page.locator("[data-po-row], [data-po-empty]").first().waitFor({ timeout: 15000 });
  // The table renders "empty" before its first fetch lands, so ask the server (read-only) instead.
  if (await poStatus(page, v.po_number)) return null;
  await page.locator("[data-po-submit]").click();
  await page.locator("[data-po-file]").setInputFiles({ name: "qa-po.pdf", mimeType: "application/pdf", buffer: PO_PDF });
  await page.locator('input[name="po_number"]').fill(v.po_number);
  await page.locator('input[name="po_value"]').fill(String(v.po_value));
  await page.locator('select[name="currency"]').selectOption(v.currency);
  await page.locator('input[name="years"]').fill(String(v.years));
  await page.locator('select[name="billing_cycle"]').selectOption(v.billing_cycle);
  await page.locator('input[name="billing_start"]').fill(v.billing_start);
  const preview = await page.locator("[data-po-preview] tr[data-period]").evaluateAll(trs =>
    trs.map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent.trim())));
  await page.locator("[data-po-submit-confirm]").click();
  await page.locator(`[data-po-row="${v.po_number}"]`).waitFor({ timeout: 15000 });
  return preview;
}

// READ-ONLY: a PO's server status by number (null when it does not exist).
const poStatus = (page, n) => page.evaluate(async n => ((await sb.from("purchase_orders").select("status").eq("po_number", n)).data || [])[0]?.status ?? null, n);

// Approve a submitted PO from the Finance queue (POReview, :123-185). No-op once approved (a retry).
async function approvePO(page, poNumber) {
  if (await poStatus(page, poNumber) !== "submitted") return;
  await openFinance(page);
  const row = page.locator(`[data-po-queue] [data-po-row="${poNumber}"]`);
  await row.locator("[data-po-review]").click();
  await page.locator("[data-po-approve]").click();
  await row.waitFor({ state: "detached", timeout: 15000 });
}

// The single run invoice (raised by create-invoice) or a skip/fail explaining why there is none.
async function runInvoice(page, runId) {
  const rows = await invoiceRows(page, runId);
  if (rows.length) { assert.equal(rows.length, 1, `expected one run invoice, got ${rows.join(", ")}`); return rows[0]; }
  if (!await inrEntity(page)) throw new SkipScenario(SETUP);
  throw new Error(`no invoice for ${runId} -- 08-finance/create-invoice did not raise one`);
}

// The folder picker can't be driven live, so the page's QA hook (window.__syncFinanceFiles, set up by session.mjs via
// __qaHooks) feeds finance files through the same sync path. files = [{ name, text | bytes (base64), lastModified }].
async function feedFinance(page, files) {
  await nav(page, "Settings").click();
  await page.waitForFunction(() => typeof window.__syncFinanceFiles === "function", null, { timeout: 15000 })
    .catch(() => { throw new Error("window.__syncFinanceFiles missing: Settings > Integrations not mounted or __qaHooks not set"); });
  const out = await page.evaluate(f => window.__syncFinanceFiles(f), files);
  await waitForSaved(page);
  return out;
}
const poRows = (page, n) => page.evaluate(async n => (await sb.from("purchase_orders").select("status,file_path").eq("po_number", n)).data || [], n);
const invoiceState = (page, n) => page.evaluate(async n => ((await sb.from("invoices").select("status").eq("number", n)).data || [])[0]?.status ?? null, n);

export const scenarios = [
  { id: `${F}/create-invoice`, feature: F, title: "Raise an invoice with two lines; totals match the invoice math and a hand-computed figure", role: "admin",
    run: async ({ page, runId, thisRunId, env }) => {
      needFreshSeed({ runId, thisRunId });
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const entity = await inrEntity(page);
      if (!entity) throw new SkipScenario(SETUP);
      const acctName = INV_ACCT(runId);
      if ((await invoiceRows(page, runId)).length) throw new Error(`a run invoice already exists (earlier attempt); not raising a second`);
      const account = await storeAccount(page, acctName);
      // The hand-written literal below assumes 18% GST on an Indian customer; decide BEFORE any write.
      const rate = Number(entity.default_tax_pct ?? 18), cust = account.country || entity.country;
      if (entity.country !== "IN" || cust !== "IN" || rate !== 18)
        throw new SkipScenario(`INR entity "${entity.name}" is ${entity.country}/${rate}% for a ${cust} customer; the literal check needs an IN entity at 18% (set Default tax % 18 in Settings -> Billing entities)`);

      await submitPO(page, acctName, { po_number: INV_PO(runId), po_value: 15000, currency: "INR", years: 1, billing_cycle: "annual", billing_start: isoPlus(0) });
      await approvePO(page, INV_PO(runId));

      await openFinance(page);
      const due = page.locator("[data-due-item]").filter({ hasText: `PO ${INV_PO(runId)}` });
      await due.first().waitFor({ timeout: 15000 });
      await due.first().locator("[data-raise]").click();
      const form = page.locator("[data-invoice-form]");
      await form.locator("select").first().selectOption(entity.id);
      const lines = LINES(runId);
      await form.locator("[data-add-line]").click();
      for (const [i, l] of lines.entries()) {
        await form.locator("[data-line-desc]").nth(i).fill(l.description);
        await form.locator("[data-line-qty]").nth(i).fill(String(l.qty));
        await form.locator("[data-line-rate]").nth(i).fill(String(l.rate));
      }
      await form.locator('input[type="email"]').first().fill(env.users.admin.email); // invoice email goes to the QA admin

      const applyTax = await form.locator("[data-apply-tax]").isChecked();
      const exp = computeTotals(lines, entity, account, { exempt: !applyTax });
      const shownTotal = (await form.locator("[data-inv-total]").textContent()).trim();
      assert.equal(shownTotal, `Total INR ${two(exp.total)}`, "form total vs src/lib/invoice.js");
      assert.ok(await form.getByText(`Subtotal INR ${two(exp.subtotal)}`, { exact: true }).count(), `subtotal ${exp.subtotal} not shown`);
      for (const t of exp.taxLines)
        assert.ok(await form.getByText(`${t.label} ${t.pct}% INR ${two(t.amount)}`, { exact: true }).count(), `tax line ${t.label} not shown`);
      // Independent of the app's function: 10,000x1 + 2,500x2 = 15,000 subtotal.
      assert.equal(exp.subtotal, 15000);
      // Hand-written, independent of computeTotals: 15,000 + 18% GST = 17,700 (or 15,000 if the account is exempt).
      assert.equal(shownTotal, applyTax ? "Total INR 17,700.00" : "Total INR 15,000.00", "hand-computed total");

      const block = form.locator("[data-inv-block]");
      if (await block.count()) throw new Error(`invoice form blocked: ${(await block.textContent()).trim()}`);
      await form.locator("[data-inv-send]").click();
      await form.waitFor({ state: "detached", timeout: 60000 }).catch(async () => {
        throw new Error(`invoice not sent: ${(await form.textContent()).slice(-300)}`);
      });

      const rows = await invoiceRows(page, runId);
      assert.equal(rows.length, 1, "run invoice listed once");
      const row = invoiceRow(page, rows[0]);
      assert.match(await row.textContent(), new RegExp(acctName));
      assert.match(await row.textContent(), /17,700\.00|15,000\.00|\d/);
      assert.ok((await row.textContent()).includes(two(exp.total)), `listed amount should be ${two(exp.total)}`);
      assert.equal((await row.locator("[data-invoice-status]").textContent()).trim(), "Pending");
    } },

  { id: `${F}/pdf-download`, feature: F, title: "The run invoice's PDF downloads as a real PDF", role: "admin",
    run: async ({ page, context, runId, thisRunId }) => {
      needFreshSeed({ runId, thisRunId });
      const number = await runInvoice(page, runId);
      const popupP = context.waitForEvent("page", { timeout: 15000 });
      await invoiceRow(page, number).locator("[data-download]").click();
      const popup = await popupP;
      // The app opens a 60s signed URL in a new tab (src/14-invoices.jsx:33). Whether the browser
      // shows it in a PDF viewer (Edge) or downloads it varies by channel, so fetch the URL the tab
      // was given -- that also proves the signed link itself works.
      await popup.waitForURL(/token=/, { timeout: 20000 });
      const url = popup.url();
      assert.match(new URL(url).pathname, /\.pdf$/i, `signed URL is not a .pdf: ${new URL(url).pathname}`);
      const res = await context.request.get(url);
      assert.equal(res.status(), 200, `signed PDF URL returned ${res.status()}`);
      const buf = await res.body();
      assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF", "file does not start with %PDF");
      // jsPDF writes text streams uncompressed, so the invoice number is in the bytes as-is.
      assert.ok(buf.toString("latin1").includes(number), `PDF does not contain invoice number ${number}`);
      assert.ok(buf.length > 5 * 1024, `PDF is only ${buf.length} bytes`);
    } },

  { id: `${F}/purchase-order`, feature: F, title: "A submitted PO lists its billing schedule; once approved its periods list as upcoming", role: "admin",
    run: async ({ page, runId, thisRunId = runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const v = { po_number: SCHED_PO(thisRunId), po_value: 100000.01, currency: "PHP", years: 1, billing_cycle: "quarterly", billing_start: isoPlus(200) };
      const expected = buildSchedule(v);
      assert.equal(expected.length, 4, "quarterly over 1 year = 4 periods");
      let failed = false;
      try {
        const preview = await submitPO(page, PO_ACCT(runId), v);
        if (!preview) throw new Error(`PO ${v.po_number} already exists: an earlier attempt of this run submitted it and failed (its error is lost on retry; rerun to see it)`);
        const money = n => `PHP ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        assert.deepEqual(preview, expected.map(r => [periodLabel(v, r), r.period_start, r.period_end, money(r.amount)]), "PO form schedule preview");
        // Hand-written: 100,000.01 split 4 ways leaves the extra cent on the last period.
        assert.deepEqual(preview.map(r => r[3]), ["PHP 25,000.00", "PHP 25,000.00", "PHP 25,000.00", "PHP 25,000.01"]);
        assert.match(await page.locator(`[data-po-row="${v.po_number}"] [data-po-status]`).textContent(), /Awaiting approval/);
        await approvePO(page, v.po_number);
        await openFinance(page);
        await page.locator("[data-upcoming-toggle]").click();
        const up = await page.locator("[data-upcoming-item]").filter({ hasText: `PO ${v.po_number}` }).allTextContents();
        assert.deepEqual(up.map(t => /· (Year \d \w\d) ·/.exec(t)?.[1]), ["Year 1 Q1", "Year 1 Q2", "Year 1 Q3", "Year 1 Q4"], "upcoming periods for the PO");
        await openAccount(page, PO_ACCT(runId));
        await page.locator('[data-account-tab="Purchase orders"]').click();
        assert.equal((await page.locator(`[data-po-row="${v.po_number}"] [data-po-invoiced]`).textContent()).trim(), "0 of 4 raised");
      } catch (e) { failed = true; throw e; } finally {
        // Cancel so the run's 4 periods don't pile up in "upcoming" forever (POs can't be deleted).
        const cleanup = await (async () => {
          await page.keyboard.press("Escape"); // close any modal left open by a failure
          await openAccount(page, PO_ACCT(runId));
          await page.locator('[data-account-tab="Purchase orders"]').click();
          const row = page.locator(`[data-po-row="${v.po_number}"]`), st = await poStatus(page, v.po_number);
          if (st !== "approved" && st !== "submitted") return;
          await row.locator("[data-po-review]").click();
          if (st === "approved") {
            await page.locator("[data-po-cancel]").click();
            await page.getByRole("button", { name: "Cancel PO" }).last().click();
          } else {
            await page.locator("[data-po-reject-reason]").fill(`QA ${runId} cleanup`);
            await page.locator("[data-po-reject]").click();
          }
          await row.locator("[data-po-status]").filter({ hasText: /Cancelled|Rejected/ }).waitFor({ timeout: 15000 });
        })().then(() => null, e => e);
        // Never silent: a primary failure keeps its own error but carries the cleanup note; otherwise fail on it.
        const st = await poStatus(page, v.po_number).catch(() => "unknown");
        if (st === "approved" || st === "submitted" || cleanup) {
          const msg = `cleanup failed: PO ${v.po_number} left ${st}${cleanup ? ` (${String(cleanup.message).slice(0, 200)})` : ""}`;
          if (failed) console.warn(`[${F}/purchase-order] ${msg}`); else throw new Error(msg);
        }
      }
    } },

  // Feeds a PO CSV + its PDF. The PO number is run-unique and POs can't be deleted, so it stays on the run account like the other fixtures.
  { id: `${F}/finance-feed-po`, feature: F, title: "A finance-feed PO row imports as one submitted PO with its PDF, even when re-fed", role: "admin",
    run: async ({ page, runId, thisRunId = runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const po = `${thisRunId}-FEED`, pdf = `${po}.pdf`;
      const csv = `name,po_number,po_date,po_value,currency,years,billing_cycle,billing_start,po_file
${PO_ACCT(runId)},${po},${isoPlus(0)},12000,PHP,1,annual,${isoPlus(200)},${pdf}
`;
      const files = lm => [{ name: `qa-${thisRunId}-po.csv`, text: csv, lastModified: lm }, { name: pdf, bytes: PO_PDF.toString("base64"), lastModified: lm }];
      const first = await feedFinance(page, files(Date.now()));
      assert.ok(!first[0].err, `finance sync reported an error: ${first[0].msg}`);
      let rows = await poRows(page, po);
      assert.equal(rows.length, 1, `expected one PO ${po} after the first feed (${first[0].msg})`);
      assert.equal(rows[0].status, "submitted");
      assert.ok(rows[0].file_path, "imported PO has no PDF file_path");
      const again = await feedFinance(page, files(Date.now() + 5000)); // later timestamp: a new signature, so processed again
      assert.ok(!again[0].err, `re-feed reported an error: ${again[0].msg}`);
      rows = await poRows(page, po);
      assert.equal(rows.length, 1, `re-feeding created a second PO ${po}`);
    } },

  { id: `${F}/payment-status`, feature: F, title: "Marking the run invoice paid moves it from the pending filter to the paid filter", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      needFreshSeed({ runId, thisRunId });
      const number = await runInvoice(page, runId);
      const row = invoiceRow(page, number);
      if ((await row.locator("[data-invoice-status]").textContent()).trim() !== "Paid") {
        // Controlled checkbox whose onChange opens MarkPaidDialog: click, don't check().
        await row.locator("[data-paid-checkbox]").click();
        await page.locator("[data-paid-ref]").fill(`QA ${runId}`);
        await page.locator("[data-paid-confirm]").click();
        await row.locator("[data-invoice-status]").filter({ hasText: /^Paid$/ }).waitFor({ timeout: 15000 });
      }
      assert.deepEqual(await invoiceRows(page, runId, "paid"), [number], "paid filter + runId");
      assert.deepEqual(await invoiceRows(page, runId, "pending"), [], "pending filter + runId");
    } },

  { id: `${F}/status-filter`, feature: F, title: "Overdue filter shows none of this run's invoices (all due in future)", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      needFreshSeed({ runId, thisRunId });
      const number = await runInvoice(page, runId); // non-vacuous: the run has an invoice under "all"
      assert.ok((await invoiceRows(page, runId, "all")).includes(number));
      assert.deepEqual(await invoiceRows(page, runId, "overdue"), [], "overdue filter + runId");
    } },
  // The paid path itself is covered by the health test; live, the run invoice is already Paid (payment-status), so a
  // paid row must be refused as "already paid" and leave status and payment_ref untouched, and an unknown number is refused.
  { id: `${F}/finance-feed-payment`, feature: F, title: "A finance-feed paid row for an already-paid invoice is refused and changes nothing; an unknown invoice is refused", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      needFreshSeed({ runId, thisRunId });
      const number = await runInvoice(page, runId); // SkipScenario with SETUP when no INR entity
      const read = () => page.evaluate(async n => ((await sb.from("invoices").select("status,payment_ref").eq("number", n)).data || [])[0] || null, number);
      const before = await read();
      assert.equal(before?.status, "paid", "payment-status should have left the run invoice paid");
      const csv = `invoice_number,status,paid_date,payment_ref
${number},paid,${isoPlus(0)},QA ${runId} feed
${runId}-NOPE,paid,${isoPlus(0)},x
`;
      const out = await feedFinance(page, [{ name: `qa-${runId}-pay.csv`, text: csv, lastModified: Date.now() }]);
      const msg = out[0].msg || "";
      assert.ok(msg.includes("invoices paid 0"), `expected "invoices paid 0": ${msg}`);
      assert.ok(msg.includes("already paid"), `expected "already paid": ${msg}`);
      assert.ok(msg.includes("unknown invoice") && msg.includes(`${runId}-NOPE`), `expected unknown invoice ${runId}-NOPE refused: ${msg}`);
      const after = await read();
      assert.equal(after.status, "paid", "invoice status after the feed");
      assert.equal(after.payment_ref, before.payment_ref, "payment_ref changed by the refused row");
    } },
];
