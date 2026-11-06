// Surveys PR 3 Task 4: follow-up rule in the template question editor.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount, gotoSettings } from "./harness.mjs";

const A = seedAccount({ id: "s1", name: "Survey Co" });
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = settings => `window.__seedRows = { accounts: ${rows([A])}, contacts: [], activities: [], tasks: [], opportunities: [],
  settings: ${JSON.stringify([{ id: "1", data: settings }])}, surveys: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] };`;
const stored = page => page.evaluate(() => window.__store.getState().settings.surveyTemplates || []);
const TPL = { id: "t1", name: "T", intro: "", archived: false, questions: [
  { id: "qn", type: "nps", text: "Recommend?", required: true },
  { id: "qr", type: "rating", text: "Rate", required: false, scale: 5, lowLabel: "", highLabel: "" },
  { id: "qs", type: "single", text: "Pick", required: false, options: ["A", "B", "C"] },
  { id: "qt", type: "text", text: "Say", required: false, long: false }] };

async function open(page, w = 1440, h = 900) {
  await page.setViewportSize({ width: w, height: h });
  await gotoSettings(page);
  await page.waitForSelector("[data-surveys-settings]");
  await page.locator('[data-template-row="t1"] [data-template-edit]').click();
  await page.waitForSelector("[data-template-editor]");
}
const save = async page => { await page.locator("[data-template-save]").click(); };
const saved = async page => { await page.waitForSelector("[data-template-editor]", { state: "detached" }); return (await stored(page)).find(t => t.id === "t1"); };

test("followup editor: NPS shows the rule on at 6; off saves null; text has none", async () => {
  const { page, browser } = await launch(seed({ surveyTemplates: [TPL] }));
  try {
    await open(page);
    const r = page.locator("[data-template-editor] [data-q-row]");
    assert(await r.nth(0).locator("[data-q-followup]").isChecked(), "NPS on by default");
    assert(await r.nth(0).locator("[data-q-followup-value]").inputValue() === "6", "default 6");
    assert(!(await r.nth(1).locator("[data-q-followup]").isChecked()), "rating off by default");
    assert(await r.nth(3).locator("[data-q-followup]").count() === 0, "text has no rule");
    assert(/NPS questions start with this on, at 6 or lower/.test(await page.locator("[data-followup-helper]").innerText()), "helper line");
    await r.nth(0).locator("[data-q-followup]").uncheck();
    await save(page);
    const t = await saved(page);
    assert(t.questions[0].followUp === null, "off saved as null: " + JSON.stringify(t.questions[0].followUp));
  } finally { await browser.close(); }
});

test("followup editor: rating saves lte 2 within its scale; choice saves ticked options", async () => {
  const { page, browser } = await launch(seed({ surveyTemplates: [TPL] }));
  try {
    await open(page);
    const r = page.locator("[data-template-editor] [data-q-row]");
    await r.nth(1).locator("[data-q-followup]").check();
    const opts = await r.nth(1).locator("[data-q-followup-value] option").evaluateAll(o => o.map(x => x.value));
    assert(opts.join() === "1,2,3,4,5", "limited to scale: " + opts);
    await r.nth(2).locator("[data-q-followup]").check();
    await r.nth(2).locator("[data-q-followup-option]").nth(0).check();
    await r.nth(2).locator("[data-q-followup-option]").nth(2).check();
    await save(page);
    const t = await saved(page);
    assert(JSON.stringify(t.questions[1].followUp) === '{"op":"lte","value":2}', "rating: " + JSON.stringify(t.questions[1].followUp));
    assert(JSON.stringify(t.questions[2].followUp) === '{"op":"in","value":["A","C"]}', "choice: " + JSON.stringify(t.questions[2].followUp));
    assert(!("followUp" in t.questions[3]), "text has none");
  } finally { await browser.close(); }
});

test("followup editor: shrinking a scale below the rule value blocks save", async () => {
  const tpl = { ...TPL, questions: [{ id: "qr", type: "rating", text: "Rate", required: false, scale: 7, lowLabel: "", highLabel: "", followUp: { op: "lte", value: 6 } }] };
  const { page, browser } = await launch(seed({ surveyTemplates: [tpl] }));
  try {
    await open(page);
    const row = page.locator("[data-template-editor] [data-q-row]").first();
    await row.locator("[data-q-scale]").selectOption("5");
    await save(page);
    const err = page.locator('[data-template-error][role="alert"]');
    assert(/Question 1: follow-up score must be a whole number from 1 to 5/.test(await err.innerText()), "error: " + await err.innerText());
    assert((await stored(page)).find(t => t.id === "t1").questions[0].scale === 7, "nothing saved");
    await row.locator("[data-q-followup-value]").selectOption("3");
    await save(page);
    const t = await saved(page);
    assert(t.questions[0].scale === 5 && t.questions[0].followUp.value === 3, "fixed and saved");
  } finally { await browser.close(); }
});

test("followup editor: dark mode and 390px", async () => {
  const { page, browser } = await launch(seed({ surveyTemplates: [TPL] }));
  try {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await open(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const r = page.locator("[data-template-editor] [data-q-row]");
    await r.nth(2).locator("[data-q-followup]").check();
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 3000 }).catch(() => {});
    assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "no page overflow");
    const sizes = await page.evaluate(() => [...document.querySelectorAll("[data-q-followup], [data-q-followup-option]")].map(e => [e.getBoundingClientRect().width, e.closest("label").getBoundingClientRect().height]));
    assert(sizes.length >= 5 && sizes.every(([w, h]) => w >= 18 && h >= 44), "18px box, 44px row: " + JSON.stringify(sizes));
    const sel = await r.nth(0).locator("[data-q-followup-value]").boundingBox();
    assert(sel.height >= 44, "select 44px: " + sel.height);
    const inside = await page.evaluate(() => [...document.querySelectorAll("[data-q-followup-block]")].every(b => b.getBoundingClientRect().right <= window.innerWidth + 1));
    assert(inside, "block inside viewport");
    const color = await page.evaluate(() => getComputedStyle(document.querySelector("[data-q-followup-block] span")).color);
    assert(color !== "rgb(0, 0, 0)", "text colour themed: " + color);
  } finally { await browser.close(); }
});

test("followup editor: helper line shows once", async () => {
  const { page, browser } = await launch(seed({ surveyTemplates: [TPL] }));
  try {
    await open(page);
    const txt = await page.locator("[data-template-editor]").innerText();
    const n = txt.split("NPS questions start with this on, at 6 or lower. Text questions have no rule.").length - 1;
    assert(n === 1, "helper count " + n);
  } finally { await browser.close(); }
});

test("followup editor: blank rename drops the value; emptying shows a hint", async () => {
  const tpl = { ...TPL, questions: [{ id: "qs", type: "single", text: "Pick", required: false, options: ["A", "B", "C"], followUp: { op: "in", value: ["A", "B"] } }] };
  const { page, browser } = await launch(seed({ surveyTemplates: [tpl] }));
  try {
    await open(page);
    const row = page.locator("[data-template-editor] [data-q-row]").first();
    assert(await row.locator("[data-q-followup-hint]").count() === 0, "no hint while ticked");
    await row.locator("[data-q-option]").nth(0).fill("");
    assert(await row.locator("[data-q-followup-option]").count() === 2, "blank option has no checkbox");
    // blank options block save (validator), so the "" in the rule can never be saved
    await save(page);
    assert(/Question 1: add 2 to 12 options/.test(await page.locator("[data-template-error]").innerText()), "blank option blocks save");
    assert((await stored(page)).find(t => t.id === "t1").questions[0].followUp.value.join() === "A,B", "nothing saved, stored rule intact");
    await row.locator("[data-q-option]").nth(0).fill("A");
    assert(await row.locator("[data-q-followup-option]:checked").count() === 2, "retype restores the tick");
    await row.getByRole("button", { name: "Remove option 2" }).click();
    await row.locator("[data-q-followup-option]:checked").first().uncheck();
    assert(await row.locator("[data-q-followup]").isChecked(), "box still checked");
    assert(/Tick at least one option/.test(await row.innerText()), "hint shown");
    await row.locator("[data-q-followup-option]").first().check();
    assert(await row.locator("[data-q-followup-hint]").count() === 0, "hint gone after ticking");
  } finally { await browser.close(); }
});

test("followup editor: an 'in' rule with no options ticked blocks save", async () => {
  const tpl = { ...TPL, questions: [{ id: "qs", type: "single", text: "Pick", required: false, options: ["A", "B"], followUp: { op: "in", value: ["A"] } }] };
  const { page, browser } = await launch(seed({ surveyTemplates: [tpl] }));
  try {
    await open(page);
    const row = page.locator("[data-template-editor] [data-q-row]").first();
    await row.locator("[data-q-followup-option]").first().uncheck();
    await save(page);
    assert(/follow-up options must be some of the question's options/.test(await page.locator("[data-template-error]").innerText()), "empty rule blocked");
    assert((await stored(page)).find(t => t.id === "t1").questions[0].followUp.value.join() === "A", "nothing saved");
  } finally { await browser.close(); }
});
