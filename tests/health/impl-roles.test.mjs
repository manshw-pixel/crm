import { test, assert } from "./framework.mjs";
import { launch, launchFinance, gotoSettings, seedAccount } from "./harness.mjs";

// impl_lead / impl_user are read-only everywhere except the Implementation view (Task 6).
// Every absence assertion below is paired with a presence assertion (the account name rendered,
// or the same control shown to a normal role) so it cannot pass against an empty page.

const ACCT = seedAccount({ id: "a1", name: "Acme", csm: "Ravi", documents: [{ id: "d1", category: "Contract", title: "MSA", name: "msa.pdf", url: "https://x.test/msa.pdf", path: "p/msa.pdf" }] });
const seed = role => `window.__seedRows = { accounts: ${JSON.stringify([ACCT])}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [{ id: "c1", data: { id: "c1", accountId: "a1", name: "Cathy Contact", role: "CTO", email: "c@x.test", sentiment: "Positive" } }],`
  + ` activities: [{ id: "x1", data: { id: "x1", accountId: "a1", type: "call", date: "2026-10-01", summary: "Kickoff call" } }],`
  + ` tasks: [{ id: "t1", data: { id: "t1", accountId: "a1", title: "Send deck", due: "2027-01-01", priority: "Med", status: "Open", owner: "Ravi" } }],`
  + ` opportunities: [{ id: "o1", data: { id: "o1", accountId: "a1", type: "Upsell", value: 5000, stage: "Discovery", closeDate: "2027-02-01" } }], settings: [],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Ravi", role: "user" }] };`;

const openAcct = async page => {
  await page.click('button[title="Accounts"]');
  await page.getByText("Acme").first().click();
  await page.waitForSelector("[data-header-card]");
};
const navTitles = page => page.locator('nav[aria-label="Main"] button').evaluateAll(els => els.map(e => e.title));

for (const role of ["impl_user", "impl_lead"]) {
  test(`${role}: sidebar lists exactly Implementation and Accounts, lands on Implementation`, async () => {
    const { page, browser } = await launch(seed(role));
    try {
      await page.waitForSelector('nav[aria-label="Main"] button');
      const titles = await navTitles(page);
      assert(titles.join("|") === "Implementation|Accounts", "sidebar: " + titles.join("|"));
      await page.getByText("Implementation projects").first().waitFor({ timeout: 10000 });
      assert(await page.locator("[data-scope-toggle]").count() === 0, "scope toggle shown");
    } finally { await browser.close(); }
  });

  test(`${role}: accounts list is read-only and the account is visible`, async () => {
    const { page, browser } = await launch(seed(role));
    try {
      await page.click('button[title="Accounts"]');
      await page.getByText("Acme").first().waitFor({ timeout: 10000 });
      const txt = await page.textContent("#root");
      assert(!/\+ New account/.test(txt), "New account shown");
      assert(!/Import CSV/.test(txt), "Import CSV shown");
      assert(await page.locator("[data-select]").count() === 0, "row select checkboxes shown");
      assert(await page.locator("[data-select-all]").count() === 0, "select-all shown");
    } finally { await browser.close(); }
  });

  test(`${role}: account detail shows data but no edit controls`, async () => {
    const { page, browser } = await launch(seed(role));
    try {
      await openAcct(page);
      const txt = await page.textContent("#root");
      for (const s of ["Acme", "Cathy Contact", "Kickoff call", "Send deck", "MSA"]) assert(txt.includes(s), "missing data: " + s);
      for (const s of ["Edit account", "Add task", "Log activity", "Update health", "Complete renewal", "Add document"])
        assert(!txt.includes(s), "control shown: " + s);
      for (const sel of ['[title="Edit task"]', '[title="Edit contact"]', '[title="Delete contact"]', '[title="Edit activity"]',
        '[title="Edit document"]', '[title="Delete document"]', '[title="Renewal stage"]', '[data-account-tab="Invoices"]', '[data-account-tab="Purchase orders"]'])
        assert(await page.locator(sel).count() === 0, "control present: " + sel);
      assert(await page.locator('input[type="checkbox"]').count() === 0, "task checkbox shown");
      assert(await page.locator("select").count() === 0, "a select (stage) is editable");
    } finally { await browser.close(); }
  });

  test(`${role}: makes no automatic writes (no health/playbook/snapshot seeding)`, async () => {
    const { page, browser } = await launch(seed(role));
    try {
      await page.click('button[title="Accounts"]');
      await page.getByText("Acme").first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => ({ a: window.__store.getState().accounts.find(x => x.id === "a1"), snaps: window.__store.getState().settings.snapshots, rec: window.__recordHealthCalls }));
      assert(r.a && r.a.healthBand === undefined, "health band was auto-seeded: " + (r.a && r.a.healthBand));
      assert(!r.snaps || r.snaps.length === 0, "snapshot auto-written");
      assert(!r.rec, "record_health called");
    } finally { await browser.close(); }
  });
}

test("control: a normal user DOES see the controls the impl roles must not", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await openAcct(page);
    const txt = await page.textContent("#root");
    assert(/Edit account/.test(txt) && /Add task/.test(txt), "precondition: controls absent for a user");
    assert(await page.locator('[title="Edit contact"]').count() === 1, "precondition: edit contact absent");
    const titles = await navTitles(page);
    assert(!titles.includes("Implementation"), "Implementation shown to a normal role: " + titles.join("|"));
  } finally { await browser.close(); }
});

test("palette: impl user sees no contextual edit actions and no Finance", async () => {
  const { page, browser } = await launch(seed("impl_user"));
  try {
    await page.waitForSelector('nav[aria-label="Main"] button');
    await page.keyboard.press("Control+k");
    await page.keyboard.type("acme");
    await page.waitForTimeout(200);
    const txt = await page.textContent("#root");
    assert(/Acme/.test(txt), "palette did not list the account");
    assert(!/Edit account|Log activity|Add task|Complete renewal|Update health/.test(txt), "palette action shown");
    await page.keyboard.press("Control+a"); await page.keyboard.type("go to");
    await page.waitForTimeout(200);
    const t2 = await page.textContent("#root");
    assert(/Go to Accounts/.test(t2) && /Go to Implementation/.test(t2), "palette views missing");
    assert(!/Go to Finance|Go to Settings|Go to Dashboard|Go to Renewals|Go to Tasks/.test(t2), "palette offers a forbidden view");
  } finally { await browser.close(); }
});

test("Team screen: admin can assign and invite impl_lead and impl_user", async () => {
  const LENA = { id: "u2", name: "Lena", role: "user", disabled: false, finance: false, email: "l@x.test" };
  const { page, browser } = await launchFinance({ users: [LENA] });
  try {
    await gotoSettings(page);
    await page.locator('[data-user-id="u2"]').waitFor({ timeout: 10000 });
    const rowOpts = await page.locator('[data-role-select="u2"] option').allTextContents();
    assert(rowOpts.includes("impl_lead") && rowOpts.includes("impl_user"), "row options: " + rowOpts.join(","));
    const inviteOpts = await page.locator('form:has(input[placeholder="Temp password"]) select option').allTextContents();
    assert(inviteOpts.includes("impl_lead") && inviteOpts.includes("impl_user"), "invite options: " + inviteOpts.join(","));
    await page.locator('[data-role-select="u2"]').selectOption("impl_user");
    await page.waitForFunction(() => window.__mockDb.profiles.find(p => p.id === "u2")?.role === "impl_user", null, { timeout: 5000 });
  } finally { await browser.close(); }
});
