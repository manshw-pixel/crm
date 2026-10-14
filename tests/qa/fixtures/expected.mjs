// Hand-summed from accounts.csv. unit/reset.test.mjs re-derives these from the CSV, so the
// two cannot drift. NOTE: the importer accepts only USD, INR and PHP (src/lib/money.js:1),
// so the brief's "2 EUR" rows are PHP here, and "Churned" is not importable
// (src/17-csv.jsx:69-71), so the fixture's 15th status is "In negotiation".
export const EXPECTED = {
  accounts: 15,
  arrByCurrency: { INR: 13450000, USD: 273000, PHP: 3500000 },
  countByCurrency: { INR: 9, USD: 4, PHP: 2 },
  countByStatus: { "Active": 9, "Auto-renew": 3, "Churn risk": 2, "In negotiation": 1 },
  customFieldLabel: "QA Tier",
};
