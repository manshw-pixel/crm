// accountRetention(account, rates, now) took `now` for the Dec baseline but its NRR/GRR came
// from retentionStats, which always used the real clock -- so "as of" a date gave a ratio
// from a different 12-month window than the baseline beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountRetention, retentionStats, arrBridge } from "../../src/lib/retention.js";

// churned 2026-03-01. As of 2026-06-01 that is inside the trailing year (GRR 0);
// as of 2027-06-01 it is outside it, and the account is simply not retained anything.
const acct = { id: "a", arr: 50000, arrUSD: 0, currency: "USD", startDate: "2020-01-01",
  churn: { date: "2026-03-01", arr: 50000, currency: "USD" } };

test("retentionStats and arrBridge honour an explicit now", () => {
  assert.equal(retentionStats([acct], {}, "2026-06-01").churnedARR, 50000);
  assert.equal(retentionStats([acct], {}, "2026-06-01").grr, 0);
  assert.equal(retentionStats([acct], {}, "2027-06-01").churnedARR, 0);
  assert.equal(arrBridge([acct], {}, "2026-06-01").churn, 50000);
  assert.equal(arrBridge([acct], {}, "2027-06-01").churn, 0);
});

test("accountRetention's ratios use the same `now` as its baseline", () => {
  assert.equal(accountRetention(acct, {}, "2026-06-01").grr, 0);
  assert.equal(accountRetention(acct, {}, "2027-06-01").grr, null); // nothing a year before, nothing churned in-window
});

test("new-logo test uses `now` too", () => {
  const young = { id: "y", arr: 1000, arrUSD: 1000, currency: "USD", startDate: "2026-05-01" };
  assert.equal(arrBridge([young], {}, "2026-06-01").newLogos, 1);
  assert.equal(arrBridge([young], {}, "2027-06-01").newLogos, 0);
});
