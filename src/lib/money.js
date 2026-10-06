export const CURRENCIES = ["USD", "INR", "PHP"];
export const CUR_SYM = { USD: "$", INR: "₹", PHP: "₱" };
export const DEFAULT_RATES = { INR: 0.012, PHP: 0.018 }; // 1 unit -> USD; USD is always 1
export const toUSD = (n, cur, rates) => (cur === "USD" || !cur) ? n : n * (rates?.[cur] ?? 0);
export const fmtMoney = (n, cur = "USD") => (CUR_SYM[cur] || "$") + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : Math.round(n));
