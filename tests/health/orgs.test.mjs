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

test("an address with an existing org-less login is attached, and no sign-up is attempted", async () => {
  const { page, browser } = await launch(`${empty} window.__inviteResult = "attached"; window.__seedUsers = [{ id: "u1", name: "Test User", role: "admin", disabled: false, email: "t@t.io" }];`);
  await page.click('button[title="Settings"]');
  await page.waitForSelector("text=Add user");
  // Count sign-ups: signUpUser() is the only caller of supabase.createClient after boot.
  await page.evaluate(() => {
    window.__signUps = 0;
    const real = window.supabase.createClient;
    window.supabase.createClient = (...a) => { window.__signUps++; return real(...a); };
  });
  await page.fill('input[placeholder="Name"]', "Old Login");
  await page.fill('input[placeholder="Email"]', "old@example.com");
  await page.fill('input[placeholder="Temp password"]', "secret12");
  await page.click("text=Add user");
  await page.waitForSelector("text=Existing login added to this workspace", { timeout: 15000 });
  assert((await page.evaluate(() => window.__signUps)) === 0, "a sign-up was attempted for an attached login");
  await browser.close();
});

// ---------- Task 8: the Platform card ----------
const seedPlatform = `${empty}
  window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp" }];
  window.__seedOrgs = [{ id: "org-a", name: "Acme Corp", created_at: "2026-01-01", users: 3 }, { id: "org-b", name: "Beta Ltd", created_at: "2026-02-01", users: 1 }];
  window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "org-a", platform_admin: true };`;

// Replace signUpUser()'s throwaway client with one whose signUp answers as GoTrue would.
const stubSignUp = (page, data) => page.evaluate(d => {
  window.__signUps = 0;
  window.supabase.createClient = () => ({ auth: { signUp: async () => { window.__signUps++; return { data: d, error: null }; } } });
}, data);

const fillClient = async (page, name = "Gamma Inc") => {
  await page.fill('[data-platform-card] input[placeholder="Client name"]', name);
  await page.fill('[data-platform-card] input[placeholder="Admin name"]', "Gina");
  await page.fill('[data-platform-card] input[placeholder="Admin email"]', "gina@gamma.com");
  await page.fill('[data-platform-card] input[placeholder="Temporary password"]', "secret12");
  await page.click("[data-platform-card] >> text=Create client");
};

test("the Platform card lists orgs for a platform admin and is absent for an org admin", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.waitForSelector("[data-platform-card] >> text=Beta Ltd", { timeout: 15000 });
  const txt = await page.textContent("[data-platform-card]");
  assert(/Acme Corp/.test(txt) && /Beta Ltd/.test(txt), "orgs not listed");
  assert(/3 users/.test(txt) && /1 user\b/.test(txt), "user count missing");
  assert(!(await page.$('[data-switch-org="org-a"]')), "offered to switch into the current org");
  await browser.close();
  const admin = await launch(`${empty} window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`);
  await admin.page.click('button[title="Settings"]');
  // F15: Settings must have rendered (UsersCard's Add user button) before absence means anything.
  await admin.page.waitForSelector("text=Add user", { timeout: 15000 });
  assert(!(await admin.page.$("[data-platform-card]")), "Platform card rendered for a non-platform admin");
  assert(!(await admin.page.evaluate(() => (window.__rpcCalls || []).some(c => c.fn === "list_orgs"))), "list_orgs called for a non-platform admin");
  await admin.browser.close();
});

test("New client calls create_org with the name and admin email, then signs the admin up", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.waitForSelector("[data-platform-card]", { timeout: 15000 });
  await stubSignUp(page, { user: { identities: [{}], email_confirmed_at: null }, session: null });
  await fillClient(page);
  await page.waitForSelector("[data-platform-card] >> text=Gamma Inc created", { timeout: 15000 });
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "create_org"));
  assert(call.args.p_name === "Gamma Inc" && call.args.p_admin_email === "gina@gamma.com", JSON.stringify(call.args));
  const txt = await page.textContent("[data-platform-card]");
  assert(/confirmation email was sent/i.test(txt), `pending status not reported: ${txt}`);
  assert((await page.evaluate(() => window.__signUps)) === 1, "admin was not signed up");
  await browser.close();
});

test("New client with an existing org-less login reports it was added, not created", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.waitForSelector("[data-platform-card]", { timeout: 15000 });
  await stubSignUp(page, { user: { identities: [] }, session: null });
  await fillClient(page);
  await page.waitForSelector("[data-platform-card] >> text=Existing login added", { timeout: 15000 });
  await browser.close();
});

test("create_org's refusal is shown and no sign-up is attempted", async () => {
  const { page, browser } = await launch(`${seedPlatform} window.__createOrgError = "create_org: an org named Gamma Inc already exists";`);
  await page.click('button[title="Settings"]');
  await page.waitForSelector("[data-platform-card]", { timeout: 15000 });
  await stubSignUp(page, { user: { identities: [{}] }, session: {} });
  await fillClient(page);
  await page.waitForSelector("[data-platform-card] >> text=already exists", { timeout: 15000 });
  assert((await page.evaluate(() => window.__signUps)) === 0, "signed up after create_org refused");
  await browser.close();
});

test("Switch into calls switch_org with that org, then reloads", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.waitForSelector('[data-platform-card] button[data-switch-org="org-b"]', { timeout: 15000 });
  await page.evaluate(() => { window.__reloads = 0; window.__reload = () => window.__reloads++; });
  await page.click('[data-platform-card] button[data-switch-org="org-b"]');
  await page.waitForFunction(() => window.__reloads === 1);
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "switch_org"));
  assert(call.args.p_org_id === "org-b", JSON.stringify(call.args));
  await browser.close();
});
