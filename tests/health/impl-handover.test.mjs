import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Task 6: handover checklist, New project, the Won toast, the Implementation page.
const ACCT = seedAccount({ id: "a1", name: "Acme", csm: "Test User" });
const seed = role => `window.__seedRows = { accounts: ${JSON.stringify([ACCT])}.map(d => ({ id: d.id, data: d })),`
  + ` opportunities: [{ id: "o1", data: { id: "o1", accountId: "a1", type: "upsell", value: 5000, stage: "Discovery", closeDate: "2027-02-01" } }], settings: [],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;

const openAcct = async page => {
  await page.click('button[title="Accounts"]');
  await page.getByText("Acme").first().click();
  await page.waitForSelector("[data-header-card]");
};
const fillRequired = async page => {
  const f = page.locator("[data-handover-form]");
  await f.locator('[data-checklist-item="order_form"] input').check();
  await f.locator('[data-checklist-item="go_live_target"] input').fill("2027-03-01");
  await f.locator('[data-checklist-item="customer_contact"] input').fill("Jane");
  await f.locator('[data-checklist-item="modules_scope"] input').fill("Core");
};
const projects = page => page.evaluate(() => window.__store.getState().projects);

test("handover: required item empty is refused, filled creates a Queued onboarding project, second is expansion", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await openAcct(page);
    await page.click("[data-new-project]");
    await fillRequired(page);
    await page.locator('[data-checklist-item="modules_scope"] input').fill("");
    await page.click('[data-handover-form] button[type="submit"]');
    const err = await page.textContent("[data-handover-error]");
    assert(/Modules \/ scope purchased/.test(err), "error names the item: " + err);
    assert((await projects(page)).length === 0, "project created despite missing item");

    await page.locator('[data-checklist-item="modules_scope"] input').fill("Core");
    await page.click('[data-handover-form] button[type="submit"]');
    await page.waitForSelector("[data-project-row]");
    const row = page.locator("[data-project-row]").first();
    assert(await row.getAttribute("data-stage") === "queued" && (await row.textContent()).includes("Queued"), "not Queued");
    assert(await row.getAttribute("data-type") === "onboarding" && (await row.textContent()).includes("Onboarding"), "not Onboarding");
    const [p] = await projects(page);
    assert(p.targetGoLive === "2027-03-01", "targetGoLive " + p.targetGoLive);
    assert(p.checklistTemplate.length === 8 && p.history[0].from === "handover" && p.history[0].to === "queued", "template/history");

    await page.click("[data-new-project]");
    await fillRequired(page);
    await page.click('[data-handover-form] button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll("[data-project-row]").length === 2);
    const types = await page.locator("[data-project-row]").evaluateAll(els => els.map(e => e.dataset.type));
    assert(types.join("|") === "onboarding|expansion", "types " + types.join("|"));
  } finally { await browser.close(); }
});

test("handover: marking an opportunity Won shows Start onboarding, which opens the checklist", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await openAcct(page);
    await page.locator("select").filter({ hasText: "Discovery" }).last().selectOption("Won");
    await page.getByRole("button", { name: "Book it" }).click();
    const btn = page.locator("[data-toast-action]");
    await btn.waitFor({ timeout: 5000 });
    assert((await btn.textContent()) === "Start onboarding", "toast action label");
    assert(await page.locator("[data-handover-form]").count() === 0, "form already open");
    await btn.click();
    await page.waitForSelector("[data-handover-form]");
  } finally { await browser.close(); }
});

test("handover: impl roles see the Projects card but no New project; user sees Implementation in the sidebar", async () => {
  let { page, browser } = await launch(seed("impl_user"));
  try {
    await openAcct(page);
    await page.getByText("Projects (0)").waitFor({ timeout: 5000 });
    assert(await page.locator("[data-new-project]").count() === 0, "New project shown to impl role");
  } finally { await browser.close(); }
  ({ page, browser } = await launch(seed("user")));
  try {
    await page.click('button[title="Implementation"]');
    await page.locator('[data-impl-tab="Board"]').waitFor({ timeout: 5000 });
    assert(await page.locator('[data-impl-tab="My tasks"]').count() === 1, "tabs");
  } finally { await browser.close(); }
});

test("settings: admin edits the implementation checklist; user does not see it", async () => {
  let { page, browser } = await launch(seed("admin"));
  try {
    await page.click('button[title="Settings"]');
    await page.getByText("Implementation checklist").waitFor({ timeout: 5000 });
    await page.click("[data-impl-add-item]");
    await page.waitForTimeout(50);
    let items = await page.evaluate(() => window.__store.getState().settings.implChecklist);
    assert(items.length === 9 && items[8].label === "New item", "add item");
    await page.locator('[data-impl-item="kickoff"] [aria-label="Remove item"]').click();
    await page.locator('[data-impl-item="order_form"] [aria-label="Move down"]').click();
    await page.waitForTimeout(50);
    items = await page.evaluate(() => window.__store.getState().settings.implChecklist);
    assert(items.length === 8 && items[1].id === "order_form" && !items.some(i => i.id === "kickoff"), "remove/reorder " + items.map(i => i.id));
  } finally { await browser.close(); }
  ({ page, browser } = await launch(seed("user")));
  try {
    await page.click('button[title="Settings"]').catch(() => {});
    await page.waitForTimeout(300);
    assert(await page.locator("[data-impl-item]").count() === 0, "checklist editor shown to user");
  } finally { await browser.close(); }
});

test("handover: switching account (palette, same AccountDetail) closes the open form; toast focuses its first field", async () => {
  const B = seedAccount({ id: "b1", name: "Betamax", csm: "Test User" });
  const s = seed("user").replace(`${JSON.stringify([ACCT])}`, JSON.stringify([ACCT, B]));
  const { page, browser } = await launch(s);
  try {
    await openAcct(page);
    await page.locator("select").filter({ hasText: "Discovery" }).last().selectOption("Won");
    await page.getByRole("button", { name: "Book it" }).click();
    await page.locator("[data-toast-action]").click();
    await page.waitForSelector("[data-handover-form]");
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.closest("[data-checklist-item]")?.dataset.checklistItem);
    assert(focused === "order_form", "first field not focused: " + focused);
    await page.locator('[data-checklist-item="customer_contact"] input').fill("Typed for Acme");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("betamax");
    const opt = page.getByRole("option", { name: /Betamax/ }).first();
    await opt.waitFor({ timeout: 5000 }).then(() => opt.click()).catch(async () => { await page.getByText("Betamax").first().click(); });
    await page.waitForFunction(() => document.querySelector("#root").textContent.includes("← BackBetamax"));
    // wait on the condition: the Projects card can render a commit after the header under suite load
    await page.locator("[data-new-project]").waitFor({ timeout: 5000 }).catch(() => {});
    assert(await page.locator("[data-new-project]").count() === 1, "precondition: Projects card rendered on B");
    assert(await page.locator("[data-handover-form]").count() === 0, "handover form still open on the other account");
  } finally { await browser.close(); }
});

test("settings: the last checklist item cannot be removed", async () => {
  const one = `window.__seedRows.settings = [{ id: "implChecklist", data: [{ id: "only", label: "Only", kind: "check", required: true }] }];`;
  const { page, browser } = await launch(seed("admin") + one);
  try {
    await page.click('button[title="Settings"]');
    await page.locator('[data-impl-item]').first().waitFor({ timeout: 5000 });
    const n = await page.locator("[data-impl-item]").count();
    if (n !== 1) { // seed shape not honoured: remove down to one through the UI
      for (let i = n; i > 1; i--) { await page.locator('[data-impl-item] [aria-label="Remove item"]').first().click(); await page.waitForTimeout(30); }
    }
    assert(await page.locator("[data-impl-item]").count() === 1, "precondition: one item");
    assert(await page.locator('[data-impl-item] [aria-label="Remove item"]').isDisabled(), "last item removable");
  } finally { await browser.close(); }
});

test("handover: the Start onboarding toast does nothing once another account is shown", async () => {
  const BETA = seedAccount({ id: "a2", name: "Betaco", csm: "Test User" });
  const two = seed("user").replace("[" + JSON.stringify(ACCT) + "]", "[" + JSON.stringify(ACCT) + "," + JSON.stringify(BETA) + "]");
  assert(two.includes("Betaco"), "seed must include the second account");
  const { page, browser } = await launch(two);
  try {
    await openAcct(page);
    await page.locator("select").filter({ hasText: "Discovery" }).last().selectOption("Won");
    await page.getByRole("button", { name: "Book it" }).click();
    const btn = page.locator("[data-toast-action]");
    await btn.waitFor({ timeout: 5000 });
    // palette switch keeps the same AccountDetail instance (the case where a stale action could open the wrong form)
    await page.keyboard.press("Control+k");
    await page.keyboard.type("betaco");
    const opt = page.getByRole("option", { name: /Betaco/ }).first();
    await opt.waitFor({ timeout: 5000 }).then(() => opt.click()).catch(async () => { await page.getByText("Betaco").first().click(); });
    await page.waitForFunction(() => document.querySelector("#root").textContent.includes("← BackBetaco"));
    await page.locator("[data-new-project]").waitFor({ timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(400);
    assert(await page.locator("[data-handover-form]").count() === 0, "form opened on a different account");
  } finally { await browser.close(); }
});
