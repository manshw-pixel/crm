import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXPECTED } from "./fixtures/expected.mjs";

const CSV = readFileSync(fileURLToPath(new URL("./fixtures/accounts.csv", import.meta.url)), "utf8");
const pad = n => String(n).padStart(2, "0");
// DD-MM-YYYY, the format the importer reads day-first (src/lib/csv.js:43-50). Built from local
// calendar parts so no timezone shifts the day.
const dmy = (from, n) => { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + n); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; };

// {RUN} -> run id, {CSM} -> the CSM's name (the importer's "csm" column is free text matched
// against team member names, src/17-csv.jsx:62), {D+n} -> a renewal date n days from `today`.
export const fixtureCsv = (runId, owners, today = new Date()) =>
  CSV.replaceAll("{RUN}", runId).replaceAll("{CSM}", owners.csm).replaceAll("{ADMIN}", owners.admin)
    .replace(/\{D\+(\d+)\}/g, (_, n) => dmy(today, +n));

export const staleAccountNames = (names, runId) =>
  names.filter(n => n.startsWith("QA qa-") && !n.startsWith(`QA ${runId} `));

// Pure: the visible banner's text -> { ok, updated, warnings } or { err }. Banner is the div around the
// dismiss button, src/20-account-list.jsx:210-225: "Imported N new · updated M existing ... Columns: ...",
// then (only when something was coerced) a bold span of "⚠ ..." sentences (:214-223). Errors are the
// bare message (importMsg.err, :211) with no "Imported" prefix.
export function parseImportBanner(text) {
  const t = String(text || "").replace(/✕\s*$/, "").trim();
  const m = /^Imported (\d+) new · updated (\d+) existing/.exec(t);
  if (!m) return { err: t };
  const warnings = t.split("⚠").slice(1).map(w => w.trim()).filter(Boolean);
  return { ok: +m[1], updated: +m[2], warnings };
}

// Upload through the real Import CSV flow. There is no confirm step: choosing the file imports it.
//  - "Import CSV" button + hidden input: src/20-account-list.jsx:195-198 (accept=".csv,text/csv")
//  - result: visible banner (div holding the "Dismiss import message" button, :210-224); the sr-only
//    [data-live="import"] region (:207) is only used to detect that a result arrived.
export async function importCsv(page, csvText, filename = "qa.csv") {
  const dismiss = page.getByRole("button", { name: "Dismiss import message" });
  if (await dismiss.count()) await dismiss.click();
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(csvText) });
  await page.waitForFunction(() => (document.querySelector('[data-live="import"]')?.textContent || "").trim() !== "", null, { timeout: 20000 });
  const banner = page.locator('div:has(> button[aria-label="Dismiss import message"])').first();
  const r = parseImportBanner(await banner.textContent());
  if (r.err !== undefined) throw new Error(`CSV import failed: ${r.err}`);
  return r;
}

// The banner and the bulk bar update from LOCAL state; the rows reach the server later through
// the app's serial write queue (src/lib/write-queue.js, global `writeQueue`, src/06-write-queue.jsx).
// Closing the context before it drains silently drops the writes -- the first live run "imported
// 15" and persisted none -- so wait for pending === 0, and fail on the queue's "error" (gave up).
export async function waitForSaved(page, timeoutMs = 60000) {
  const h = await page.waitForFunction(() => {
    const s = writeQueue.queueState();
    return s.status === "error" ? "error" : s.pending === 0 && s.status === "saved" ? "saved" : false;
  }, null, { timeout: timeoutMs, polling: 250 });
  if (await h.jsonValue() === "error") throw new Error("reset: the app's write queue gave up (\"Not saved\"); changes were rolled back");
}

// Deletes stale QA accounts through the list's bulk bar, then imports the fixture.
//  - sidebar nav button: aria-label="Accounts" inside nav[aria-label="Main"], src/26-app.jsx:403-405
//  - search box: placeholder "Search  ( / )", src/20-account-list.jsx:253
//  - row: tr[data-account-row] (:301); its select checkbox has aria-label "Select <name>" (:303)
//  - bulk bar [data-bulkbar] with a "Delete" button (:265,271); dialog asks to type DELETE
//    (src/19-dialogs-bulk.jsx:166-170) and confirms with [data-bulk-confirm] (:174)
//  - selection clears whenever a filter changes (:154), so tick everything AFTER the search settles.
// Churned accounts are hidden by default (:126); the fixture has none, so they are not a concern.
export async function resetQaOrg(ctx, runId) {
  const { page, env } = ctx;
  await page.locator('nav[aria-label="Main"] button[aria-label="Accounts"]').click();
  let deleted = 0;
  for (let pass = 0; ; pass++) {
    await page.getByPlaceholder(/^Search/).fill("QA qa-");
    await page.waitForTimeout(300); // let the filter + selection-reset effect settle
    const labels = await page.locator('tr[data-account-row] input[type="checkbox"][aria-label^="Select "]')
      .evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
    const stale = staleAccountNames(labels.map(l => l.replace(/^Select /, "")), runId);
    if (!stale.length) break;
    if (pass >= 10) throw new Error(`reset: ${stale.length} stale QA accounts still present after 10 delete passes`);
    for (const n of stale) await page.getByRole("checkbox", { name: `Select ${n}`, exact: true }).check();
    await page.locator("[data-bulkbar]").getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByLabel(/Type DELETE to confirm/).fill("DELETE");
    await page.locator("[data-bulk-confirm]").click();
    await page.locator("[data-bulkbar]").waitFor({ state: "detached", timeout: 15000 });
    await waitForSaved(page);
    deleted += stale.length;
  }
  await page.getByPlaceholder(/^Search/).fill("");
  const csm = ctx.csmName || env.users.csm.name || env.users.csm.email;
  const r = await importCsv(page, fixtureCsv(runId, { csm, admin: ctx.adminName }));
  await waitForSaved(page);
  if (r.ok + r.updated !== EXPECTED.accounts)
    throw new Error(`reset: expected ${EXPECTED.accounts} accounts imported, got ${r.ok} new + ${r.updated} updated${r.warnings.length ? `; warnings: ${r.warnings.join(" | ")}` : ""}`);
  return { deleted, imported: r.ok, updated: r.updated, warnings: r.warnings };
}
