import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("Settings shows Health playbook editor with Yellow & Red sections", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  // navigate to Settings view
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Health playbook"));
  const txt = await rootText(page);
  assert(/Health playbook/.test(txt), "Health playbook card missing");
  assert(/Yellow/.test(txt) && /Red/.test(txt), "band sections missing");
  await browser.close();
});
