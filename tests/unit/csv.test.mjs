import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/csv.js";
goldenSuite("csv", lib);

import { test } from "node:test";
import assert from "node:assert/strict";
test("accountsCSVText exports deployedLicenses right after licenses; unrecorded is empty", () => {
  const base = { name: "X", tier: "Mid", arr: 1, currency: "USD", arrUSD: 1, renewalDate: "2026-09-01", licenses: 200 };
  const [head, r1, r2] = lib.accountsCSVText([{ ...base, deployedLicenses: 150 }, { ...base, deployedLicenses: null }]).split("\n");
  const cols = head.split(",");
  assert.equal(cols[cols.indexOf("licenses") + 1], "deployedLicenses");
  const i = cols.indexOf("deployedLicenses");
  assert.equal(r1.split(",")[i], '"150"');
  assert.equal(r2.split(",")[i], '""');
});
