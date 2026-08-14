import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

// Two different corruption vectors, because the boundary has two jobs.
//
// `audit` as a string breaks ChangeHistoryCard, which renders only inside AccountDetail —
// a crash confined to one view, where the per-view boundary should degrade gracefully.
const BAD_VIEW = { ...scored({ id: "bad", name: "Corrupt Co", arr: 100000 }), audit: "not-an-array" };
//
// `renewals` as a string breaks retentionStats, which App calls in its OWN body before any
// view renders. Nothing renders at all without the outer boundary. Both are what a
// malformed Supabase row would actually do: `(x || []).forEach` only guards null/undefined,
// so any truthy non-array reaches .forEach and throws.
const BAD_APP = { ...scored({ id: "bad2", name: "Broken Co", arr: 100000 }), renewals: "not-an-array" };

test("a crash confined to one view leaves the rest of the app usable", async () => {
  const { page, browser } = await launch(bookSeed([BAD_VIEW]));
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Accounts"]');
  await page.getByText("Corrupt Co").first().click();
  await page.waitForSelector("[data-viewerror]", { timeout: 5000 });
  const r = await page.evaluate(() => ({
    text: document.querySelector("[data-viewerror]").textContent,
    navCount: document.querySelectorAll("button[title]").length,
  }));
  assert(/something went wrong/i.test(r.text), `the panel should explain the failure, got: ${r.text.slice(0, 120)}`);
  assert(r.navCount > 0, "the nav must survive a single view crashing");
  await browser.close();
});

test("navigating away from a crashed view clears the error", async () => {
  const { page, browser } = await launch(bookSeed([BAD_VIEW]));
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Accounts"]');
  await page.getByText("Corrupt Co").first().click();
  await page.waitForSelector("[data-viewerror]", { timeout: 5000 });
  await page.click('button[title="Dashboard"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 150)));
  const stillBroken = await page.evaluate(() => !!document.querySelector("[data-viewerror]"));
  assert(!stillBroken, "the boundary is keyed on the view, so switching should clear it");
  await browser.close();
});

test("data that breaks the app shell shows a panel, not a blank page", async () => {
  const { page, browser } = await launch(bookSeed([BAD_APP]));
  // No waitForFunction on __store here: the whole app fails to render, so the outer
  // boundary's panel is all there is.
  await page.waitForSelector("[data-viewerror]", { timeout: 8000 });
  const len = await page.evaluate(() => document.querySelector("#root").textContent.length);
  assert(len > 50, `the page must not be blank, got ${len} characters of text`);
  await browser.close();
});

test("a healthy book renders no error panel", async () => {
  const { page, browser } = await launch(bookSeed([scored({ id: "ok", name: "Fine Co", arr: 100000 })]));
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Renewals"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  const broken = await page.evaluate(() => !!document.querySelector("[data-viewerror]"));
  assert(!broken, "a valid book must not trip the boundary");
  await browser.close();
});
