export const CURRENCIES = ["USD", "INR", "PHP"];
export const CUR_SYM = { USD: "$", INR: "₹", PHP: "₱" };
export const DEFAULT_RATES = { INR: 0.012, PHP: 0.018 }; // 1 unit -> USD; USD is always 1
export const toUSD = (n, cur, rates) => (cur === "USD" || !cur) ? n : n * (rates?.[cur] ?? 0);
// Sign before the symbol and abbreviation by magnitude, so a contraction reads "-$12K" like
// its expansion "+$12K" (it used to be "$-12000"). M is chosen AFTER rounding to K, else
// 999,999 showed as "$1000K". B follows the same rule, so 999,999,999 is "$1.00B", not "$1000.00M".
export const fmtMoney = (n, cur = "USD") => {
  const a = Math.abs(n), sym = CUR_SYM[cur] || "$";
  const body = Math.round(a / 1e4) >= 1e5 ? (a / 1e9).toFixed(2) + "B"
    : Math.round(a / 1e3) >= 1000 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? Math.round(a / 1e3) + "K" : Math.round(a);
  return (n < 0 && body !== 0 ? "-" : "") + sym + body;
};
// Finance cards show the currency code beside the number, so no symbol here. Exact to 2 decimals
// below a million; from a million up, M/B like fmtMoney so the card doesn't cut the number off.
export const fmtFinance = n => Math.abs(n) < 1e6
  ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : fmtMoney(n).replace("$", "");
