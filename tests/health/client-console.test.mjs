import { test, assert } from "./framework.mjs";
import { launch, rootText } from "./harness.mjs";

const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("a user of a disabled client sees the suspended screen, not the app", async () => {
  const { page, browser } = await launch(`${empty}
    window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp", disabled: true }];
    window.__seedProfile = { id: "u1", name: "Csm", role: "user", org_id: "org-a", platform_admin: false };`);
  await page.waitForSelector("[data-org-suspended]", { timeout: 15000 });
  const txt = await rootText(page);
  assert(txt.includes("Your organisation's access is suspended."), "suspended heading missing");
  assert(txt.includes("Contact your provider to restore it."), "suspended sub-line missing");
  assert(!/Dashboard/.test(txt), "the app rendered for a disabled client's user");
  await browser.close();
});

test("a user of an enabled client gets the app (control for the suspended test)", async () => {
  const { page, browser } = await launch(`${empty}
    window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp", disabled: false }];
    window.__seedProfile = { id: "u1", name: "Csm", role: "user", org_id: "org-a", platform_admin: false };`);
  await page.waitForSelector("aside >> text=Csm", { timeout: 15000 });
  assert(!(await page.$("[data-org-suspended]")), "suspended screen shown for an enabled client");
  await browser.close();
});

const HOME = "00000000-0000-0000-0000-000000000001";
const seedConsole = (extra = "") => `${empty}
  window.__seedRows.orgs = [{ id: "${HOME}", name: "OneVio" }];
  window.__seedOrgs = [
    { id: "${HOME}", name: "OneVio", created_at: "2025-01-01", users: 12, disabled: false },
    { id: "org-b", name: "Beta Ltd", created_at: "2026-02-01", users: 1, disabled: false },
    { id: "org-c", name: "Gone Inc", created_at: "2026-03-01", users: 4, disabled: true }];
  window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "${HOME}", platform_admin: true };
  ${extra}`;

test("a platform admin lands on the console, not the CRM; an org admin lands on the CRM", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console] >> text=Beta Ltd", { timeout: 15000 });
  const txt = await page.textContent("[data-client-console]");
  assert(/OneVio/.test(txt) && /Gone Inc/.test(txt), "orgs not all listed");
  assert(/12 users/.test(txt) && /1 user\b/.test(txt), "user counts missing");
  assert(await page.$('[data-org-disabled="org-c"]'), "disabled badge missing");
  assert(!(await page.$('[data-org-disabled="org-b"]')), "enabled org badged as disabled");
  assert(!(await page.$('button[title="Settings"]')), "CRM nav rendered on the console");
  await browser.close();
  const admin = await launch(`${empty} window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`);
  await admin.page.click('button[title="Settings"]', { timeout: 15000 });
  await admin.page.waitForSelector("text=Add user", { timeout: 15000 });
  assert(!(await admin.page.$("[data-client-console]")), "console shown to an org admin");
  assert(!(await admin.page.evaluate(() => (window.__rpcCalls || []).some(c => c.fn === "list_orgs"))), "list_orgs called for a non-platform admin");
  await admin.browser.close();
});

test("Settings no longer carries the platform card", async () => {
  const { page, browser } = await launch(seedConsole(`try { sessionStorage.setItem("onevio.inClient", "1"); } catch {}`));
  await page.click('button[title="Settings"]', { timeout: 15000 });
  await page.waitForSelector("text=Add user", { timeout: 15000 });
  assert(!(await page.$("text=Create client")) && !(await page.$("text=Platform · clients")) && !(await page.$("[data-client-console]")), "clients UI still in Settings");
  await browser.close();
});

test("Open on another org sets the flag, calls switch_org and reloads", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector('[data-open-org="org-c"]', { timeout: 15000 });
  await page.evaluate(() => { window.__reloads = 0; window.__reload = () => window.__reloads++; });
  await page.click('[data-open-org="org-c"]');   // a disabled client can still be opened
  await page.waitForFunction(() => window.__reloads === 1);
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "switch_org"));
  assert(call.args.p_org_id === "org-c", JSON.stringify(call.args));
  assert(await page.evaluate(() => sessionStorage.getItem("onevio.inClient")) === "1", "in-client flag not set");
  await browser.close();
});

test("Open on the current org enters the CRM without switch_org; ← Clients returns to the console", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  await page.click(`[data-open-org="${HOME}"]`);
  await page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  assert(!(await page.evaluate(() => (window.__rpcCalls || []).some(c => c.fn === "switch_org"))), "switch_org called for the current org");
  await page.click("[data-back-to-clients]");
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  assert(await page.evaluate(() => sessionStorage.getItem("onevio.inClient")) === null, "flag not cleared on back");
  await browser.close();
});

test("a reload inside a client stays inside it", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  await page.click(`[data-open-org="${HOME}"]`);
  await page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  await page.reload();
  await page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  assert(!(await page.$("[data-client-console]")), "reload dropped back to the console");
  await browser.close();
});

test("Disable confirms, calls set_org_disabled and shows the badge; Enable clears it", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  await page.click('[data-org-toggle="org-b"]');
  await page.waitForSelector("text=All 1 users lose access immediately", { timeout: 15000 });
  assert(!(await page.$("text=This is your own company's workspace")), "OneVio warning shown for another client");
  await page.click('[data-confirm-go]');
  await page.waitForSelector('[data-org-disabled="org-b"]', { timeout: 15000 });
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "set_org_disabled"));
  assert(call.args.p_org_id === "org-b" && call.args.p_disabled === true, JSON.stringify(call.args));
  await page.click('[data-org-toggle="org-b"]');   // Enable: no confirm
  await page.waitForFunction(() => !document.querySelector('[data-org-disabled="org-b"]'));
  await browser.close();
});

test("disabling OneVio shows the extra warning", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  await page.click(`[data-org-toggle="${HOME}"]`);
  await page.waitForSelector("text=This is your own company's workspace", { timeout: 15000 });
  assert(await page.$("text=Your super-admin login is not affected."), "reassurance sentence missing");
  await browser.close();
});

// Replace signUpUser()'s throwaway client with one whose signUp answers as GoTrue would.
const stubSignUp = (page, data) => page.evaluate(d => {
  window.__signUps = 0;
  window.supabase.createClient = () => ({ auth: { signUp: async () => { window.__signUps++; return { data: d, error: null }; } } });
}, data);

const fillClient = async (page, name = "Gamma Inc") => {
  await page.fill('[data-client-console] input[placeholder="Client name"]', name);
  await page.fill('[data-client-console] input[placeholder="Admin name"]', "Gina");
  await page.fill('[data-client-console] input[placeholder="Admin email"]', "gina@gamma.com");
  await page.fill('[data-client-console] input[placeholder="Temporary password"]', "secret12");
  await page.click("[data-client-console] >> text=Create client");
};

test("+ New client reveals the create form and creates through create_org, then signs the admin up", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  await page.click("[data-new-client]");
  await stubSignUp(page, { user: { identities: [{}], email_confirmed_at: null }, session: null });
  await fillClient(page);
  await page.waitForSelector("[data-client-console] >> text=Gamma Inc created", { timeout: 15000 });
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "create_org"));
  assert(call.args.p_name === "Gamma Inc" && call.args.p_admin_email === "gina@gamma.com", JSON.stringify(call.args));
  assert((await page.evaluate(() => window.__signUps)) === 1, "admin was not signed up exactly once");
  assert(/confirmation email was sent/i.test(await page.textContent("[data-client-console]")), "pending status not reported");
  await browser.close();
});

test("New client with an existing org-less login reports it was added, not created", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-new-client]", { timeout: 15000 });
  await page.click("[data-new-client]");
  await stubSignUp(page, { user: { identities: [] }, session: null });
  await fillClient(page);
  await page.waitForSelector("[data-client-console] >> text=Existing login added", { timeout: 15000 });
  await browser.close();
});

test("create_org's refusal is shown and no sign-up is attempted", async () => {
  const { page, browser } = await launch(`${seedConsole()} window.__createOrgError = "create_org: an org named Gamma Inc already exists";`);
  await page.waitForSelector("[data-new-client]", { timeout: 15000 });
  await page.click("[data-new-client]");
  await stubSignUp(page, { user: { identities: [{}] }, session: {} });
  await fillClient(page);
  await page.waitForSelector("[data-client-console] >> text=already exists", { timeout: 15000 });
  assert((await page.evaluate(() => window.__signUps)) === 0, "signed up after create_org refused");
  await browser.close();
});

