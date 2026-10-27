// Implementation -> CSM handover dates on the account header: derived from each project's CSM sign-off
// (csm_review -> live), one pill per project beside the manual Sales -> AM pill.
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const ACCT = seedAccount({ id: "a1", name: "Acme", csm: "Cara", transitionDate: "2026-01-10" });
const live = (id, type, at) => ({ id, accountId: "a1", type, stage: "live", implementerId: "u2", createdBy: "Cara",
  checklistTemplate: [], checklist: {}, targetGoLive: null, startedAt: null, liveAt: at, holdReason: "",
  history: [{ at: "2026-01-15T00:00:00Z", by: "Cara", from: "handover", to: "queued" }, { at, by: "Cara", from: "csm_review", to: "live" }] });
const rows = list => `${JSON.stringify(list)}.map(d => ({ id: d.id, data: d }))`;
const seed = projects => `window.__seedRows = { accounts: ${rows([ACCT])}, settings: [], projects: ${rows(projects)}, project_tasks: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Cara", role: "admin" }] };`;
const openDetail = async page => {
  await page.click('button[title="Accounts"]');
  await page.getByText("Acme").first().click();
  await page.waitForSelector("[data-transition-pill]");
};

test("account header: one Impl -> CSM pill per signed-off project, oldest first, beside Sales -> AM", async () => {
  const { page, browser } = await launch(seed([live("p2", "expansion", "2026-06-10T09:00:00Z"), live("p1", "onboarding", "2026-03-05T09:00:00Z")]));
  try {
    await openDetail(page);
    const texts = await page.locator("[data-csm-handover-pill]").allTextContents();
    assert(texts.length === 2, "pills " + JSON.stringify(texts));
    assert(/^Impl → CSM .*2026/.test(texts[0]) && /Mar/.test(texts[0]), "first " + texts[0]);
    assert(/^Project 2 → CSM .*2026/.test(texts[1]) && /Jun/.test(texts[1]), "second " + texts[1]);
    assert(/Sales → AM/.test(await page.textContent("[data-transition-pill]")), "transition pill changed");
  } finally { await browser.close(); }
});

test("account header: no handover pill until a project is signed off", async () => {
  const p = live("p1", "onboarding", "2026-03-05T09:00:00Z");
  p.stage = "csm_review"; p.history = p.history.slice(0, 1);
  const { page, browser } = await launch(seed([p]));
  try {
    await openDetail(page);
    assert(await page.locator("[data-csm-handover-pill]").count() === 0, "pill shown before sign-off");
  } finally { await browser.close(); }
});
