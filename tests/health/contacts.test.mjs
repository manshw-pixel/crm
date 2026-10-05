import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

// Edit and delete on the account page's Contacts card, against the stateful mock so the
// write path (persist -> writeQueue -> store) and a genuine reload are both exercised.
const A = seedAccount({ id: "ct1", name: "Contact Co", healthBand: "Yellow" });
const seed = `window.__seedRows = {
  accounts: [{ id: "ct1", data: ${JSON.stringify(A)} }],
  contacts: [{ id: "c1", data: { id: "c1", accountId: "ct1", name: "Ann Old", role: "CTO", email: "ann@old.example", sentiment: "Neutral", isChampion: false } },
             { id: "c2", data: { id: "c2", accountId: "ct1", name: "Bea Gone", role: "VP", email: "bea@contact.example", sentiment: "Positive", isChampion: true } }],
  activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "csm" }] };`;

async function openAccount(page) {
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await page.click('button[title="Accounts"]');
  await page.getByText("Contact Co").first().waitFor({ timeout: 8000 });
  await page.getByText("Contact Co").first().click();
  await page.waitForFunction(() => /Contacts \(\d+\)/.test(document.getElementById("root").textContent), { timeout: 8000 });
}
const saved = page => page.waitForFunction(
  () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
const contacts = page => page.evaluate(() => window.__store.getState().contacts);

test("a contact can be edited, and the edit survives a reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  try {
    await openAccount(page);
    await page.click('[data-edit-contact="c1"]');
    const form = page.locator("[data-contact-form]");
    assert(await form.locator('input[placeholder="Name *"]').inputValue() === "Ann Old", "edit form is not prefilled");
    await form.locator('input[placeholder="Name *"]').fill("Ann New");
    await form.locator('input[placeholder="Email"]').fill("ann@new.example");
    await form.getByText("Save changes").click();
    await saved(page);
    await reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().contacts.length === 2);
    const c1 = (await contacts(page)).find(c => c.id === "c1");
    assert(c1.name === "Ann New" && c1.email === "ann@new.example", `edit not persisted: ${JSON.stringify(c1)}`);
    assert(c1.role === "CTO" && c1.accountId === "ct1", `untouched fields changed: ${JSON.stringify(c1)}`);
    // Control: the other contact is unchanged.
    const c2 = (await contacts(page)).find(c => c.id === "c2");
    assert(c2 && c2.name === "Bea Gone", "the other contact changed");
  } finally {
    await browser.close();
  }
});

test("an edit with a blank name is refused", async () => {
  const { page, browser } = await launchPersistent(seed);
  try {
    await openAccount(page);
    await page.click('[data-edit-contact="c1"]');
    const form = page.locator("[data-contact-form]");
    await form.locator('input[placeholder="Name *"]').fill("   ");
    await form.getByText("Save changes").click();
    const c1 = (await contacts(page)).find(c => c.id === "c1");
    assert(c1.name === "Ann Old", `a blank name was saved: ${JSON.stringify(c1.name)}`);
  } finally {
    await browser.close();
  }
});

test("deleting a contact asks first, then removes it from the store and the database", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  try {
    await openAccount(page);
    // Cancel first: nothing happens.
    await page.click('[data-delete-contact="c2"]');
    await page.waitForSelector("[data-confirmdialog]");
    assert(/Bea Gone/.test(await page.textContent("[data-confirmdialog]")), "dialog does not name the contact");
    await page.locator("[data-confirmdialog]").getByText("Cancel").click();
    assert((await contacts(page)).some(c => c.id === "c2"), "cancel deleted the contact");

    await page.click('[data-delete-contact="c2"]');
    await page.click("[data-confirm-go]");
    await saved(page);
    assert(!(await contacts(page)).some(c => c.id === "c2"), "contact still in the store");
    await reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const after = await contacts(page);
    assert(!after.some(c => c.id === "c2"), "deleted contact came back after a reload");
    assert(after.some(c => c.id === "c1"), "control: the other contact was lost");
  } finally {
    await browser.close();
  }
});
