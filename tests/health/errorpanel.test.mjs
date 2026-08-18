import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

const ROWS = [
  { fingerprint: "fp1", level: "crash", message: "Cannot read x", stack: "at A()",
    context: { view: "Accounts" }, count: 12, last_seen: "2026-08-18T10:00:00Z" },
  { fingerprint: "fp2", level: "write_failed", message: "timeout", stack: null,
    context: { table: "accounts" }, count: 3, last_seen: "2026-08-18T09:00:00Z" },
];

const seedFor = (role, rows) => `window.__seedRows = { accounts: [], contacts: [],
  activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: ${JSON.stringify(role)} }],
  error_log: ${JSON.stringify(rows)} };`;

test("an admin sees the error panel with counts", async () => {
  const { page, browser } = await launch(seedFor("admin", ROWS));
  await page.waitForFunction(() => window.__store);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("[data-errorlog]", { timeout: 10000 });
  const text = await page.textContent("[data-errorlog]");
  assert(/Cannot read x/.test(text), `the message is missing: ${text}`);
  assert(/12/.test(text), `the occurrence count is missing: ${text}`);
  await browser.close();
});

test("the panel lists the most recent error first", async () => {
  const { page, browser } = await launch(seedFor("admin", ROWS));
  await page.waitForFunction(() => window.__store);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("[data-errorlog-row]", { timeout: 10000 });
  const first = await page.evaluate(() =>
    document.querySelector("[data-errorlog-row]").textContent);
  assert(/Cannot read x/.test(first),
    `expected the newest error first, got: ${first}`);
  await browser.close();
});

test("a plain user has no Settings view, so no error panel", async () => {
  // Settings is removed from VIEWS entirely for non-admins (crm.html:3297), so the panel
  // is unreachable rather than merely hidden. Assert BOTH: that the nav button is gone and
  // that the panel is nowhere in the document -- checking only the second would pass just
  // because the user is parked on a different view.
  const { page, browser } = await launch(seedFor("user", ROWS));
  await page.waitForFunction(() => window.__store);
  const settingsBtn = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Settings"));
  assert(!settingsBtn, "a plain user was offered the Settings view");
  const present = await page.evaluate(() => !!document.querySelector("[data-errorlog]"));
  assert(!present, "the error panel rendered for a non-admin");
  await browser.close();
});

test("an empty log shows a neutral message, not an error state", async () => {
  const { page, browser } = await launch(seedFor("admin", []));
  await page.waitForFunction(() => window.__store);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("[data-errorlog]", { timeout: 10000 });
  const text = await page.textContent("[data-errorlog]");
  assert(/no errors/i.test(text), `expected a neutral empty state, got: ${text}`);
  await browser.close();
});
