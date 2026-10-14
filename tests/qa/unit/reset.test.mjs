import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureCsv, staleAccountNames, parseImportBanner } from "../reset.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";
import { parseCSV, parseCsvNumber, parseCsvDate, csvDateOrder } from "../../../src/lib/csv.js";
import { CURRENCIES } from "../../../src/lib/money.js";

const RUN = "qa-20261014-1530";
const csv = fixtureCsv(RUN, { csm: "QA CSM", admin: "QA Admin" }, new Date(2026, 9, 14));

test("fixture is stamped with the run id and matches EXPECTED", () => {
  const rows = csv.trim().split(/\r?\n/).slice(1);
  assert.equal(rows.length, EXPECTED.accounts);
  assert.ok(rows.every(r => r.includes(`QA ${RUN} `)));
  assert.ok(!/\{(RUN|CSM|ADMIN|D\+\d+)\}/.test(csv));
  assert.ok(!csv.includes("{AM}"));
});

test("EXPECTED is recomputed from the CSV the importer would parse", () => {
  const [head, ...data] = parseCSV(csv);
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
  const idx = k => head.map(norm).indexOf(k);
  assert.ok(idx("name") >= 0, "importer requires a name column");
  assert.ok(head.includes(EXPECTED.customFieldLabel));
  const sums = {}, counts = {}, statuses = {};
  const dates = data.map(r => r[idx("renewaldate")]);
  const order = csvDateOrder(dates);
  assert.ok(order, "dates must not mix orders");
  for (const r of data) {
    const cur = r[idx("currency")];
    assert.ok(CURRENCIES.includes(cur), `${cur} is not importable`);
    const n = parseCsvNumber(r[idx("arr")]);
    assert.equal(typeof n, "number");
    sums[cur] = (sums[cur] || 0) + n;
    counts[cur] = (counts[cur] || 0) + 1;
    const st = r[idx("contractstatus")];
    statuses[st] = (statuses[st] || 0) + 1;
    assert.ok(parseCsvDate(r[idx("renewaldate")], order), "renewal date must parse");
  }
  assert.deepEqual(sums, EXPECTED.arrByCurrency);
  assert.deepEqual(counts, EXPECTED.countByCurrency);
  assert.deepEqual(statuses, EXPECTED.countByStatus);
  assert.ok(!("Churned" in statuses), "the importer skips Churned rows");
  const owners = { csm: 0, admin: 0 };
  for (const r of data) owners[{ "QA CSM": "csm", "QA Admin": "admin" }[r[idx("csm")]]]++;
  assert.deepEqual(owners, EXPECTED.countByOwner);
  assert.equal(data.find(r => r[idx("csm")] === "QA Admin")[0], `QA ${RUN} ${EXPECTED.adminOwned}`);
});

test("renewal dates are DD-MM-YYYY, within the next 120 days", () => {
  const [head, ...data] = parseCSV(csv);
  const i = head.indexOf("renewalDate");
  const t0 = Date.UTC(2026, 9, 14);
  for (const r of data) {
    const [d, m, y] = r[i].split("-").map(Number);
    const days = (Date.UTC(y, m - 1, d) - t0) / 864e5;
    assert.ok(days >= 1 && days <= 120, r[i]);
  }
});

test("stale = other runs' QA accounts only", () => {
  assert.deepEqual(staleAccountNames(
    ["QA qa-20261013-0900 Acme", "QA qa-20261014-1530 Beta", "Real Customer", "QA Tier Co"],
    "qa-20261014-1530"), ["QA qa-20261013-0900 Acme"]);
});

test("parseImportBanner: clean, warned and error banners", () => {
  const base = "Imported 15 new · updated 0 existing (matched by account # or name). Columns: accountNo, name (required), tier";
  assert.deepEqual(parseImportBanner(base + "✕"), { ok: 15, updated: 0, warnings: [] });
  const w = parseImportBanner(base + " ⚠ 2 unreadable date(s) left unchanged (A, B). ⚠ 1 row(s) had an unrecognized tier (set to Mid).✕");
  assert.equal(w.ok, 15);
  assert.deepEqual(w.warnings, ["2 unreadable date(s) left unchanged (A, B).", "1 row(s) had an unrecognized tier (set to Mid)."]);
  assert.deepEqual(parseImportBanner("Dates in this file mix DD-MM-YYYY and MM-DD-YYYY, so nothing was imported.✕"),
    { err: "Dates in this file mix DD-MM-YYYY and MM-DD-YYYY, so nothing was imported." });
});
