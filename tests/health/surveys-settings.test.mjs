// Surveys PR 2 Task 3: Settings → Surveys (admin) — templates editor and survey settings.
import { test, assert } from "./framework.mjs";
import { launch, launchPersistent, seedAccount, gotoSettings } from "./harness.mjs";

const A = seedAccount({ id: "s1", name: "Survey Co" });
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = (role, settings) => `window.__seedRows = { accounts: ${rows([A])}, contacts: [], activities: [], tasks: [], opportunities: [],
  settings: ${settings ? JSON.stringify([{ id: "1", data: settings }]) : "[]"}, surveys: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;
const stored = page => page.evaluate(() => window.__store.getState().settings.surveyTemplates || []);

async function openSurveys(page, w = 1440, h = 900) {
  await page.setViewportSize({ width: w, height: h });
  await gotoSettings(page);
  await page.waitForSelector("[data-surveys-settings]");
}

test("surveys settings: a CSM is not offered Settings, so no Surveys section", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await page.waitForSelector('button[title="Accounts"]');
    assert(await page.locator('button[title="Settings"]').count() === 0, "CSM has no Settings nav item");
    assert(await page.locator("[data-surveys-settings]").count() === 0, "no surveys card");
  } finally { await browser.close(); }
  const admin = await launch(seed("admin"));
  try {
    await admin.page.waitForSelector('button[title="Accounts"]');
    assert(await admin.page.locator('button[title="Settings"]').count() === 1, "admin does have the Settings nav item (selector is real)");
  } finally { await admin.browser.close(); }
});

test("surveys settings: retyping a question gives a new id; other edits keep it", async () => {
  const { page, browser } = await launch(seed("admin", { surveyTemplates: [{ id: "t1", name: "T", intro: "", archived: false, questions: [
    { id: "qa", type: "rating", text: "Rate", required: true, scale: 5, lowLabel: "", highLabel: "" },
    { id: "qb", type: "single", text: "Pick", required: false, options: ["A", "B"] },
    { id: "qc", type: "text", text: "Say", required: false, long: false }] }] }));
  try {
    await openSurveys(page);
    await page.locator('[data-template-row="t1"] [data-template-edit]').click();
    const ed = page.locator("[data-template-editor]");
    const rows = ed.locator("[data-q-row]");
    await rows.nth(0).locator("[data-q-text]").fill("Rate us");
    await rows.nth(0).locator("[data-q-scale]").selectOption("10");
    await rows.nth(1).locator("[data-q-option]").first().fill("Alpha");
    await rows.nth(2).locator("[data-q-type]").selectOption("multi");
    const ids = await rows.evaluateAll(els => els.map(e => e.getAttribute("data-q-row")));
    assert(ids[0] === "qa" && ids[1] === "qb", "edits keep ids: " + ids);
    assert(ids[2] && ids[2] !== "qc", "retype gets new id: " + ids);
    await rows.nth(2).locator("[data-q-option]").nth(0).fill("X");
    await rows.nth(2).locator("[data-q-option]").nth(1).fill("Y");
    await ed.locator("[data-template-save]").click();
    await page.waitForSelector("[data-template-editor]", { state: "detached" });
    const t = (await stored(page)).find(x => x.id === "t1");
    assert(t.questions.map(q => q.id).join() === "qa,qb," + ids[2], "saved ids: " + t.questions.map(q => q.id));
    assert(t.questions[0].scale === 10 && t.questions[1].options[0] === "Alpha" && t.questions[2].type === "multi", "edits saved");
  } finally { await browser.close(); }
});

test("surveys settings: NPS and Archived pills are legible in dark mode", async () => {
  const { page, browser } = await launch(seed("admin", { surveyTemplates: [
    { id: "t-arch", name: "Old", intro: "", archived: true, questions: [{ id: "a", type: "nps", text: "x", required: true }] }] }));
  try {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await openSurveys(page);
    const ratio = await page.evaluate(() => {
      const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      return [...document.querySelectorAll("[data-template-nps], [data-template-archived]")].map(e => {
        const cs = getComputedStyle(e), a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    });
    assert(await page.evaluate(() => document.documentElement.classList.contains("dark")), "dark still applied");
    assert(ratio.length >= 3 && ratio.every(r => r >= 4.5), "contrast " + ratio.map(r => r.toFixed(2)));
  } finally { await browser.close(); }
});

test("surveys settings: add starters, edit, reorder, save persists", async () => {
  const { page, browser, reload } = await launchPersistent(seed("admin"));
  try {
    await openSurveys(page);
    assert(await page.locator('a[href="#set-surveys"]').count() === 1, "index entry");
    assert(await page.locator('[data-template-row="nps-checkin"]').count() === 1, "built-in NPS row");
    await page.click("[data-starter-open]");
    const dlg = page.locator("[data-starter-dialog]");
    await dlg.locator('[data-starter="onboarding-review"] input').check();
    await dlg.locator('[data-starter="product-usage"] input').check();
    await dlg.locator("[data-starter-add]").click();
    await page.waitForSelector('[data-template-row="product-usage"]');
    let list = await stored(page);
    assert(list.map(t => t.id).join() === "nps-checkin,onboarding-review,product-usage", "ids: " + list.map(t => t.id));
    assert(list[1].createdAt && list[1].updatedAt, "stamped");
    // Re-opening shows the added ones disabled.
    await page.click("[data-starter-open]");
    const box = page.locator('[data-starter-dialog] [data-starter="onboarding-review"]');
    assert(await box.locator("input").isDisabled() && /Added/.test(await box.innerText()), "added disabled");
    await page.keyboard.press("Escape");
    // Edit: rename, set scale 7 (string from select), reorder.
    await page.locator('[data-template-row="onboarding-review"] [data-template-edit]').click();
    const ed = page.locator("[data-template-editor]");
    await ed.locator("[data-template-name]").fill("Onboarding check");
    await ed.locator("[data-q-scale]").first().selectOption("7");
    await ed.getByRole("button", { name: "Move question 2 up" }).click();
    const prev = await ed.locator("[data-template-preview]").innerText();
    assert(/What could we have done better\?[\s\S]*How was your onboarding/.test(prev), "preview reordered: " + prev);
    await ed.locator("[data-template-save]").click();
    await page.waitForSelector("[data-template-editor]", { state: "detached" });
    // the write queue flushes asynchronously; reload only once the save reached the mock DB
    await page.waitForFunction(() => JSON.stringify(window.__dump()).includes("Onboarding check"), null, { timeout: 10000 });
    await reload();
    await openSurveys(page);
    list = await stored(page);
    const t = list.find(x => x.id === "onboarding-review");
    assert(t.name === "Onboarding check", "name persisted");
    assert(t.questions.map(q => q.id).join() === "q2,q1", "order persisted");
    assert(t.questions[1].scale === 7, "scale number: " + t.questions[1].scale);
  } finally { await browser.close(); }
});

test("surveys settings: two NPS refused with message", async () => {
  const { page, browser } = await launch(seed("admin"));
  try {
    await openSurveys(page);
    await page.locator('[data-template-row="nps-checkin"] [data-template-edit]').click();
    const ed = page.locator("[data-template-editor]");
    await ed.locator("[data-add-question]").click();
    assert(await ed.locator('[data-add-type="nps"]').isDisabled(), "NPS add disabled");
    await ed.locator('[data-add-type="rating"]').click();
    const last = ed.locator("[data-q-row]").last();
    await last.locator("[data-q-type]").selectOption("nps");
    await ed.locator("[data-template-save]").click();
    const err = ed.locator('[data-template-error][role="alert"]');
    assert((await err.innerText()) === "Only one NPS question per template", "error: " + await err.innerText());
    assert((await stored(page)).length === 0, "nothing saved");
    // Cancel with changes asks first.
    await ed.getByRole("button", { name: "Cancel" }).click();
    await page.waitForSelector("[data-confirmdialog]");
    assert(/Discard changes\?/.test(await page.locator("[data-confirmdialog]").innerText()), "discard prompt");
    await page.locator("[data-confirm-go]").click();
    await page.waitForSelector("[data-template-editor]", { state: "detached" });
  } finally { await browser.close(); }
});

test("surveys settings: copy and archive", async () => {
  const long = "N".repeat(78);
  const { page, browser } = await launch(seed("admin", { surveyTemplates: [
    { id: "t-long", name: long, intro: "", archived: false, questions: [{ id: "a", type: "text", text: "Hi", required: false, long: false }] }] }));
  try {
    await openSurveys(page);
    assert(await page.locator('[data-template-row="nps-checkin"] [data-template-archive]').count() === 0, "only NPS: no archive");
    await page.locator('[data-template-row="t-long"] [data-template-copy]').click();
    let list = await stored(page);
    const c = list.find(t => t.id !== "t-long" && t.id !== "nps-checkin");
    assert(c && c.name.startsWith("Copy of ") && c.name.length <= 80, "copy name: " + (c && c.name.length));
    assert(c.questions[0].id === "a", "question ids kept");
    await page.locator('[data-template-row="t-long"] [data-template-archive]').click();
    const row = page.locator('[data-template-row="t-long"]');
    await row.locator("[data-template-archived]").waitFor();
    assert((await row.locator("[data-template-archive]").innerText()).trim() === "Restore", "restore button");
    list = await stored(page);
    assert(list.find(t => t.id === "t-long").archived === true, "archived stored");
    await row.locator("[data-template-archive]").click();
    assert((await stored(page)).find(t => t.id === "t-long").archived === false, "restored");
  } finally { await browser.close(); }
});

test("surveys settings: settings fields save", async () => {
  const { page, browser } = await launch(seed("admin"));
  try {
    await openSurveys(page);
    const th = page.locator("[data-survey-throttle]");
    assert((await th.inputValue()) === "90", "default 90");
    await th.fill("400"); await th.blur();
    await page.waitForFunction(() => window.__store.getState().settings.surveys.throttleDays === 365);
    const dc = page.locator("[data-survey-dailycap]");
    await dc.fill("12.6"); await dc.blur();
    await page.waitForFunction(() => window.__store.getState().settings.surveys.dailyCap === 13);
    const fn = page.locator("[data-survey-fromname]");
    await fn.fill("Acme Success"); await fn.blur();
    await page.waitForFunction(() => window.__store.getState().settings.surveys.fromName === "Acme Success");
    assert(/Survey settings saved/.test(await page.locator("body").innerText()), "toast");
  } finally { await browser.close(); }
});

test("surveys settings: editor fits 1280x720", async () => {
  const { page, browser } = await launch(seed("admin"));
  try {
    await openSurveys(page, 1280, 720);
    await page.locator('[data-template-row="nps-checkin"] [data-template-edit]').click();
    const ed = page.locator("[data-template-editor]");
    for (let i = 0; i < 6; i++) { await ed.locator("[data-add-question]").click(); await ed.locator('[data-add-type="single"]').click(); }
    const b = await ed.locator("[data-template-save]").boundingBox();
    assert(b && b.y >= 0 && b.y + b.height <= 720, "save visible: " + JSON.stringify(b));
  } finally { await browser.close(); }
});

test("surveys settings: 390px no horizontal overflow", async () => {
  const { page, browser } = await launch(seed("admin"));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoSettings(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector("[data-surveys-settings]");
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    // the resize reflows the settings layout; wait for it to settle before measuring
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 3000 }).catch(() => {});
    assert(await over() <= 0, "page overflow " + await over());
    await page.locator('[data-template-row="nps-checkin"] [data-template-edit]').click();
    await page.waitForSelector("[data-template-editor]");
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 3000 }).catch(() => {});
    assert(await over() <= 0, "editor overflow " + await over());
  } finally { await browser.close(); }
});
