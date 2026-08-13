import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya", tier: "Mid" });
const B = seedAccount({ id: "a2", name: "Beta", csm: "Dana", tier: "SMB" });
const seed = `window.__seedRows = { accounts: ${JSON.stringify([A, B])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("settings.segments defaults to an empty array when absent", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const segs = await page.evaluate(() => window.__store.getState().settings.segments);
  assert(Array.isArray(segs) && segs.length === 0, `expected [], got ${JSON.stringify(segs)}`);
  await browser.close();
});

test("SET_SEGMENTS persists a segment carrying all ten filter fields", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const seg = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SET_SEGMENTS", segments: [{ id: "s1", name: "My book", filter: {
      q: "al", tier: "Mid", risk: "All", csm: "Priya", renew: "90", billing: "All",
      showChurned: false, onlyChurned: false, qbrDue: false, sort: { k: "arr", dir: -1 } } }] });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().settings.segments[0];
  });
  assert(seg.name === "My book", "segment not stored");
  assert(Object.keys(seg.filter).length === 10, `expected 10 filter fields, got ${Object.keys(seg.filter).length}`);
  assert(seg.filter.sort.k === "arr" && seg.filter.sort.dir === -1, "sort not carried");
  await browser.close();
});

test("applying a segment sets every filter field", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-segment-select]");
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SET_SEGMENTS", segments: [{ id: "s1", name: "Dana book", filter: {
      q: "", tier: "All", risk: "All", csm: "Dana", renew: "All", billing: "All",
      showChurned: false, onlyChurned: false, qbrDue: false, sort: { k: "accountNo", dir: 1 } } }] });
    await new Promise(r => setTimeout(r, 150));
    const sel = document.querySelector("[data-segment-select]");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, "s1");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return [...document.querySelectorAll("tbody tr")].map(r => r.textContent);
  });
  assert(res.length === 1 && res[0].includes("Beta"), `segment did not filter to Dana's book: ${JSON.stringify(res)}`);
  await browser.close();
});

// REGRESSION (spec 7.1): a dashboard card passes a PARTIAL filter and must not
// clobber filter fields it does not mention.
test("a partial filter from a dashboard card preserves the typed search", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector('input[placeholder^="Search"]');
  const q = await page.evaluate(async () => {
    const box = document.querySelector('input[placeholder^="Search"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(box, "Alpha");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    window.__openAccounts({ risk: "Red" }); // what a dashboard card click does
    await new Promise(r => setTimeout(r, 200));
    return document.querySelector('input[placeholder^="Search"]').value;
  });
  assert(q === "Alpha", `partial filter wiped the search box (got "${q}")`);
  await browser.close();
});

// REGRESSION (controller-added, not in the plan). Before segments, the initialFilter
// effect reset risk/showChurned/onlyChurned/billing/qbrDue on EVERY dashboard card
// click, because it read them as `initialFilter.risk || "All"` etc. Moving to a
// "only apply keys that are present" merge silently drops that: a card passing
// {risk:"Red"} would leave a previously-set qbrDue filter switched on, and a bare
// openAccounts() from the Total ARR card would stop clearing anything at all.
// openAccounts() therefore has to keep supplying those five defaults explicitly.
// This test pins the old behavior so the merge cannot quietly weaken it.
test("a dashboard card still clears the filters it cleared before segments existed", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector('input[placeholder^="Search"]');
  // qbrDue has no toggle in the list UI -- it is set only by the QBR dashboard card and
  // cleared by its pill, so the pill's presence is the observable for this filter.
  const pill = () => !!document.querySelector('[title="Remove QBR-due filter"]');
  const res = await page.evaluate(async pillSrc => {
    const hasPill = eval(pillSrc);
    // turn on a filter that the next card's filter will NOT mention
    window.__openAccounts({ qbrDue: true });
    await new Promise(r => setTimeout(r, 200));
    const before = hasPill();
    window.__openAccounts({ risk: "Red" });
    await new Promise(r => setTimeout(r, 200));
    return { before, after: hasPill() };
  }, pill.toString());
  assert(res.before === true, "precondition: the QBR-due pill should be showing");
  assert(res.after === false, "a dashboard card must reset qbrDue as it always has");
  await browser.close();
});

test("saving a view stores the current filters as a segment", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-save-segment]");
  const segs = await page.evaluate(async () => {
    window.prompt = () => "Dana book";
    const box = document.querySelector('input[placeholder^="Search"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(box, "Beta");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    document.querySelector("[data-save-segment]").click();
    await new Promise(r => setTimeout(r, 150));
    return window.__store.getState().settings.segments;
  });
  assert(segs.length === 1, `expected one saved segment, got ${JSON.stringify(segs)}`);
  assert(segs[0].name === "Dana book", `wrong name: ${segs[0].name}`);
  assert(segs[0].filter.q === "Beta", `segment should capture the typed search, got ${JSON.stringify(segs[0].filter)}`);
  assert(Object.keys(segs[0].filter).length === 10, `expected 10 filter fields, got ${Object.keys(segs[0].filter).length}`);
  await browser.close();
});

test("cancelling the save-view prompt stores nothing", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-save-segment]");
  const segs = await page.evaluate(async () => {
    window.prompt = () => null; // user hit Cancel
    document.querySelector("[data-save-segment]").click();
    await new Promise(r => setTimeout(r, 150));
    return window.__store.getState().settings.segments;
  });
  assert(segs.length === 0, `cancelling must not save a segment, got ${JSON.stringify(segs)}`);
  await browser.close();
});

test("deleting the active segment removes it and clears the selection", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-segment-select]");
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SET_SEGMENTS", segments: [{ id: "s1", name: "Dana book", filter: {
      q: "", tier: "All", risk: "All", csm: "Dana", renew: "All", billing: "All",
      showChurned: false, onlyChurned: false, qbrDue: false, sort: { k: "accountNo", dir: 1 } } }] });
    await new Promise(r => setTimeout(r, 150));
    const sel = document.querySelector("[data-segment-select]");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, "s1");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    document.querySelector("[data-delete-segment]").click();
    await new Promise(r => setTimeout(r, 200));
    return {
      segments: window.__store.getState().settings.segments,
      value: document.querySelector("[data-segment-select]").value,
      deleteBtn: !!document.querySelector("[data-delete-segment]"),
    };
  });
  assert(res.segments.length === 0, `segment should be gone, got ${JSON.stringify(res.segments)}`);
  assert(res.value === "", `selection should reset to the placeholder, got "${res.value}"`);
  assert(res.deleteBtn === false, "delete button should disappear with no active segment");
  await browser.close();
});

test("the segment dropdown shows segment names, not raw ids", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-segment-select]");
  const opts = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SET_SEGMENTS", segments: [{ id: "seg-abc123", name: "Dana book", filter: {
      q: "", tier: "All", risk: "All", csm: "Dana", renew: "All", billing: "All",
      showChurned: false, onlyChurned: false, qbrDue: false, sort: { k: "accountNo", dir: 1 } } }] });
    await new Promise(r => setTimeout(r, 200));
    return [...document.querySelectorAll("[data-segment-select] option")].map(o => ({ v: o.value, t: o.textContent }));
  });
  const named = opts.find(o => o.v === "seg-abc123");
  assert(named, `segment option missing: ${JSON.stringify(opts)}`);
  assert(named.t === "Dana book", `option should show the name, got "${named.t}"`);
  await browser.close();
});
