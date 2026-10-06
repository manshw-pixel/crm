import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
async function H() {
  const { page, browser } = await launch(empty);
  await page.waitForFunction(() => window.__health && window.__health.scoreComponents);
  return { page, browser };
}

test("windowScore: full, midpoint, zero, never, future, and a zero<=full step", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(() => {
      const w = window.__health.windowScore;
      return [w(0, 7, 60), w(7, 7, 60), w(33.5, 7, 60), w(60, 7, 60), w(90, 7, 60), w(null, 7, 60), w(-5, 7, 60), w(7, 7, 7), w(8, 7, 7), w(3, 10, 5)];
    });
    assert(JSON.stringify(r) === JSON.stringify([100, 100, 50, 0, 0, 0, 100, 100, 0, 100]), "windowScore: " + JSON.stringify(r));
  } finally { await browser.close(); }
});

test("inert defaults reproduce today's score for every sample-data account", async () => {
  const { page, browser } = await H();
  try {
    const bad = await page.evaluate(() => {
      const H = window.__health, d = seedData();
      const settings = H.mergeSettings({});
      const legacy = (a, acts) => { // today's formula, copied verbatim as the reference
        const la = acts.filter(x => x.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0];
        const ds = la ? Math.floor((Date.now() - new Date(la.date)) / 864e5) : 999;
        return ds <= 7 ? 100 : ds >= 60 ? 0 : Math.round(100 * (1 - (ds - 7) / 53));
      };
      return d.accounts.filter(a => {
        const c = H.scoreComponents(a, d.activities, settings);
        return c.recency !== legacy(a, d.activities) || c.value !== 0 ||
          H.healthScore(a, d.activities, settings.weights, settings) !== H.healthScore(a, d.activities, { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15 });
      }).map(a => a.name);
    });
    assert(bad.length === 0, "scores moved with inert settings: " + bad.join(", "));
  } finally { await browser.close(); }
});

test("recency blend uses each type's own window; unknown types are ignored", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(({ d0, d120 }) => {
      const H = window.__health;
      const mix = { enabled: true, types: { ...H.mergeSettings({}).recencyMix.types } };
      Object.keys(mix.types).forEach(t => mix.types[t] = { ...mix.types[t], weight: 0 });
      mix.types.call = { weight: 50, fullDays: 7, zeroDays: 60 };
      mix.types.QBR = { weight: 50, fullDays: 90, zeroDays: 180 };
      const a = { id: "x", inputs: {} };
      const acts = [{ accountId: "x", type: "call", date: d0 }, { accountId: "x", type: "QBR", date: d120 }, { accountId: "x", type: "meeting", date: d0 }];
      const settings = { ...H.mergeSettings({}), recencyMix: mix };
      return { rec: H.scoreComponents(a, acts, settings).recency, bd: H.recencyBreakdown(a, acts, mix).filter(b => b.weight > 0).map(b => [b.type, b.score]) };
    }, { d0: day(0), d120: day(-120) });
    // call 100, QBR at 120d in a 90->180 window = 67; blend (100+67)/2 = 84 (rounded)
    assert(r.rec === 84, "blend: " + JSON.stringify(r));
    assert(JSON.stringify(r.bd) === JSON.stringify([["call", 100], ["QBR", 67]]), "breakdown: " + JSON.stringify(r.bd));
  } finally { await browser.close(); }
});

test("enabled mix with every sub-weight 0 falls back to today's rule", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(d => {
      const H = window.__health;
      const base = H.mergeSettings({});
      const types = {}; Object.keys(base.recencyMix.types).forEach(t => types[t] = { ...base.recencyMix.types[t], weight: 0 });
      const s = { ...base, recencyMix: { enabled: true, types } };
      return H.scoreComponents({ id: "x", inputs: {} }, [{ accountId: "x", type: "QBR", date: d }], s).recency;
    }, day(-3));
    assert(r === 100, "fallback recency: " + r);
  } finally { await browser.close(); }
});

test("value blends the Yes/No answers; zero sub-weights and malformed input read as 0", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(() => {
      const H = window.__health, s = H.mergeSettings({});
      const v = val => H.scoreComponents({ id: "x", inputs: { value: val } }, [], s).value;
      const zero = { ...s, valueMix: { caseStudy: 0, savings: 0, roi: 0 }, weights: { ...s.weights, value: 50 } };
      return [v({ caseStudy: true, savings: true, roi: true }), v({ caseStudy: true }), v(undefined), v("yes"), v({ caseStudy: "yes" }),
        H.scoreComponents({ id: "x", inputs: { value: { caseStudy: true } } }, [], zero).value,
        H.healthScore({ id: "x", inputs: { value: { caseStudy: true } } }, [], zero.weights, zero)];
    });
    assert(r[0] === 100 && r[1] === 34 && r[2] === 0 && r[3] === 0 && r[4] === 0 && r[5] === 0, "value: " + JSON.stringify(r));
    assert(Number.isFinite(r[6]), "score is not finite: " + r[6]);
  } finally { await browser.close(); }
});

test("an old settings row loads with the defaults and per-type deep merge", async () => {
  const { page, browser } = await H();
  try {
    const s = await page.evaluate(() => window.__health.mergeSettings({
      weights: { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15 },
      recencyMix: { enabled: true, types: { call: { weight: 5, fullDays: 3, zeroDays: 30 } } } }));
    assert(s.weights.value === 0, "value weight default missing");
    assert(s.recencyMix.enabled === true && s.recencyMix.types.call.weight === 5, "saved mix lost");
    assert(s.recencyMix.types.QBR.fullDays === 90, "missing type not defaulted");
    assert(s.valueMix.caseStudy === 34, "valueMix default missing");
  } finally { await browser.close(); }
});

test("SET_RECENCY_MIX and SET_VALUE_MIX update settings", async () => {
  const { page, browser } = await launch(`window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`);
  try {
    await page.waitForFunction(() => window.__store);
    const s = await page.evaluate(async () => {
      const st = window.__store.getState().settings;
      window.__store.dispatch({ type: "SET_RECENCY_MIX", mix: { ...st.recencyMix, enabled: true } });
      window.__store.dispatch({ type: "SET_VALUE_MIX", mix: { caseStudy: 1, savings: 0, roi: 0 } });
      await new Promise(r => setTimeout(r, 50));
      const n = window.__store.getState().settings;
      return [n.recencyMix.enabled, n.valueMix.caseStudy];
    });
    assert(s[0] === true && s[1] === 1, "actions did not apply: " + JSON.stringify(s));
  } finally { await browser.close(); }
});
