import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// supabase-js 2.45 resolves signOut() with an error -- and keeps the stored session --
// when the server says the session is already gone (403 session_not_found). The button
// then did nothing at all. The app must clear the stored session itself and reload.
const A = seedAccount({ id: "so1", name: "Signout Co" });
const seed = `window.__seedRows = { accounts: [{ id: "so1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

async function clickSignOut(page) {
  await page.waitForFunction(() => window.__store);
  await page.locator('button[title^="Sign out"]').first().click();
}

test("a sign-out the server rejects still clears the stored session and reloads", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.evaluate(() => {
      localStorage.setItem("sb-test-auth-token", "{\"access_token\":\"stale\"}");
      window.__signOutResult = { error: { name: "AuthSessionMissingError", status: 400 } };
      window.__beforeReload = true;
    });
    const reloaded = page.waitForEvent("load", { timeout: 8000 });
    await clickSignOut(page);
    await reloaded;
    const left = await page.evaluate(() => localStorage.getItem("sb-test-auth-token"));
    assert(left === null, `stored session survived a failed sign-out: ${left}`);
  } finally {
    await browser.close();
  }
});

test("a normal sign-out does not force a reload", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.evaluate(() => { window.__marker = 1; });
    await clickSignOut(page);
    await page.waitForFunction(() => window.__signOutCalls === 1);
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => window.__marker) === 1, "the page reloaded on a successful sign-out");
  } finally {
    await browser.close();
  }
});
