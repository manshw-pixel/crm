import { test, assert } from "./framework.mjs";
import { launch, rootText } from "./harness.mjs";

const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("a signed-in user with no org sees the no-workspace screen, not the app", async () => {
  const { page, browser } = await launch(`${empty} window.__seedProfile = { id: "u1", name: "Nobody", role: "user", org_id: null, platform_admin: false };`);
  await page.waitForSelector("text=Sign out", { timeout: 15000 });
  const txt = await rootText(page);
  assert(/not attached to a workspace/i.test(txt), "no-workspace message missing");
  assert(!/Dashboard/.test(txt), "the app rendered for an org-less user");
  await browser.close();
});

test("a platform admin sees the current org name in the sidebar; a normal user does not", async () => {
  const seedOrgs = `window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp" }];`;
  const { page, browser } = await launch(`${empty} ${seedOrgs} window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "org-a", platform_admin: true };`);
  await page.waitForSelector("[data-current-org]:has-text('Acme Corp')", { timeout: 15000 });
  assert((await page.textContent("[data-current-org]")).includes("Acme Corp"), "org name not shown for platform admin");
  await browser.close();
  const plain = await launch(`${empty} ${seedOrgs} window.__seedProfile = { id: "u1", name: "Plain", role: "user", org_id: "org-a", platform_admin: false };`);
  // F15: prove the sidebar rendered (the user's name in the footer) before asserting absence.
  await plain.page.waitForSelector("aside >> text=Plain", { timeout: 15000 });
  assert(!(await plain.page.$("[data-current-org]")), "org name badge shown to a normal user");
  await plain.browser.close();
});

test("adding a user invites them before signing them up", async () => {
  const { page, browser } = await launch(`${empty} window.__seedUsers = [{ id: "u1", name: "Test User", role: "admin", disabled: false, email: "t@t.io" }];`);
  await page.click('button[title="Settings"]');
  await page.fill('input[placeholder="Name"]', "New Person");
  await page.fill('input[placeholder="Email"]', "new@example.com");
  await page.fill('input[placeholder="Temp password"]', "secret12");
  await page.click("text=Add user");
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "invite_user"));
  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "invite_user"));
  assert(calls[0].args.p_email === "new@example.com" && calls[0].args.p_role === "user", `invite args ${JSON.stringify(calls[0].args)}`);
  await browser.close();
});
