import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Distinct ids: seedAccount() defaults id to "t1" when omitted, so both accounts need an
// explicit, distinct id or they collide into a single seeded row.
const a1 = seedAccount({ id: "a1", name: "Northwind Co" });
const a2 = seedAccount({ id: "a2", name: "Bluepeak Co" });
const seed = `window.__seedRows = { accounts: ${JSON.stringify([a1, a2].map(d => ({ id: d.id, data: d })))}, `
  + `contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("the app records one health snapshot per account, once per session", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  const calls = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();

  assert(calls.length === 1, `expected exactly 1 record_health call, got ${calls.length}`);
  const scores = calls[0];
  assert(scores.length === 2, `expected 2 accounts scored, got ${scores.length}`);
  assert(scores.every(s => typeof s.score === "number" && s.score >= 0 && s.score <= 100),
    "a score was missing or outside the 0-100 range");
  assert(scores.some(s => s.accountId === a1.id), "the first account was not in the snapshot");
});

test("editing an account does not re-send the baseline", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  // Force `scored` to genuinely recompute the way a real edit would: UPDATE_INPUTS (reducer
  // case at crm.html:654) recomputes healthScore and returns new state, unlike an unknown
  // action type which React would bail out of re-rendering for.
  await page.evaluate(() => window.__store && window.__store.dispatch
    && window.__store.dispatch({ type: "UPDATE_INPUTS", id: "a1", inputs: { usage: 10 } }));
  await page.waitForTimeout(200);
  const calls = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();
  assert(calls.length === 1,
    `a re-render sent the baseline again: ${calls.length} calls`);
});

test("adding an account does not re-send the baseline", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  // Unlike UPDATE_INPUTS, ADD_ACCOUNT changes scored.length (2 -> 3), which is the one case
  // that actually re-runs the effect (deps: [user, scored.length]) -- so this is the case that
  // genuinely exercises the once-per-session ref guard, not just a stable dependency array.
  const a3 = seedAccount({ id: "a3", name: "Cascade Co" });
  await page.evaluate(item => window.__store && window.__store.dispatch
    && window.__store.dispatch({ type: "ADD_ACCOUNT", item }), a3);
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();
  assert(calls.length === 1,
    `adding an account re-sent the baseline: ${calls.length} calls`);
});

test("the baseline waits for `loaded`, not just scored.length", async () => {
  // Holds fetchAll's reads open, then dispatches ADD_ACCOUNT into the store while `loaded`
  // is still false -- bumping scored.length before the initial load has landed. The unfixed
  // effect (deps [user, scored.length], no `loaded` guard) fires right here, on the
  // half-seeded store; the fixed effect must not fire until `loaded` flips true afterward.
  const delayed = `window.__loadDelay = 400; ${seed}`;
  const { page, browser } = await launch(delayed);
  const a3 = seedAccount({ id: "a3", name: "Cascade Co" });
  // Fires while the delayed fetch is still pending -- window.__store is wired up on the
  // first render, well before fetchAll's artificial 400ms delay resolves.
  await page.waitForFunction(() => !!window.__store);
  await page.evaluate(item => window.__store.dispatch({ type: "ADD_ACCOUNT", item }), a3);
  await page.waitForTimeout(100);
  const midFlightCalls = await page.evaluate(() => (window.__recordHealthCalls || []).length);
  await page.waitForSelector("#root");
  await page.waitForTimeout(500);
  const finalCalls = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();

  assert(midFlightCalls === 0,
    `record_health fired before \`loaded\` was true: ${midFlightCalls} call(s)`);
  assert(finalCalls.length === 1,
    `expected exactly 1 record_health call after load, got ${finalCalls.length}`);
});

test("a failed baseline write retries instead of being permanently skipped", async () => {
  // supabase-js REJECTS the rpc promise on a network/CORS failure (see the comment beside
  // the effect in crm.html) -- __recordHealthFails models exactly that for the first call.
  // The unfixed effect sets healthRecorded.current = true synchronously, before the promise
  // settles, so a rejected first call permanently skips the session's baseline. The fixed
  // effect only marks the ref on the SUCCESS path, so scored.length changing again (here,
  // via ADD_ACCOUNT) gives it another chance.
  const faulty = `window.__recordHealthFails = 1; ${seed}`;
  const { page, browser } = await launch(faulty);
  await page.waitForSelector("#root");
  await page.waitForTimeout(200);
  const afterFailure = await page.evaluate(() => (window.__recordHealthCalls || []).length);

  const a3 = seedAccount({ id: "a3", name: "Cascade Co" });
  await page.evaluate(item => window.__store && window.__store.dispatch
    && window.__store.dispatch({ type: "ADD_ACCOUNT", item }), a3);
  await page.waitForTimeout(300);
  const afterRetry = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();

  assert(afterFailure === 1,
    `expected the first (rejected) attempt to still be sent, got ${afterFailure}`);
  assert(afterRetry.length === 2,
    `a rejected first attempt was never retried: ${afterRetry.length} call(s) total`);
});
