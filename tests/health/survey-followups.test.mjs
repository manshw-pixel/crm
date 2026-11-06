// Surveys PR 3 Task 5: Survey tag, bell alert and the outcome dialog behind all three checkboxes.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const ago = n => new Date(Date.now() - n * 864e5).toISOString();
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A = seedAccount({ id: "a1", name: "Survey Co", csm: "Test User" });
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const ID = "sv-fu-sv1-q1";
const T = (o = {}) => ({ id: ID, accountId: "a1", title: "Follow up: Ann Lee — How likely are you to recommend us?: 3", details: "", due: day(0),
  priority: "High", status: "Open", owner: "Test User", source: "survey", surveyId: "sv1", questionId: "q1", createdAt: ago(1), ...o });
const PLAIN = { id: "p1", accountId: "a1", title: "Plain task", due: day(0), priority: "Low", status: "Open", owner: "Test User" };
const seed = (tasks, role = "admin") => `window.__seedRows = { accounts: ${rows([A])}, contacts: [], activities: [], tasks: ${rows(tasks)}, opportunities: [],
  settings: [], surveys: [], profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: ${JSON.stringify(role)} }] };`;

async function start(tasks, role) {
  const r = await launch(seed(tasks, role));
  await r.page.setViewportSize({ width: 1280, height: 800 });
  await r.page.waitForFunction(n => window.__store && window.__store.getState().tasks.length >= n, tasks.length);
  return r;
}
const nav = (page, v) => page.locator(`nav[aria-label="Main"] button[title="${v}"]`).click();
const task = (page, id = ID) => page.evaluate(i => window.__store.getState().tasks.find(t => t.id === i), id);
const waitTask = (page, status, id = ID) => page.waitForFunction(([i, s]) => window.__store.getState().tasks.find(t => t.id === i)?.status === s, [id, status]);
const DLG = "[data-survey-outcome-dialog]";
const tasksCheck = page => page.locator('[data-task-row] input[aria-label^="Complete"]').first();
async function complete(page, result, note) {
  await page.waitForSelector(DLG);
  await page.locator(`${DLG} input[value="${result}"]`).check();
  if (note !== undefined) await page.locator(`${DLG} [data-outcome-note]`).fill(note);
  await page.locator(`${DLG} [data-outcome-save]`).click();
  await page.waitForSelector(DLG, { state: "detached" });
  await waitTask(page, "Done");
}
const surveyAlertIds = async page => {
  await page.locator("[data-bell]").click();
  await page.waitForSelector("[data-notif-panel]");
  const ids = await page.locator("[data-notif-item]").evaluateAll(l => l.map(x => x.getAttribute("data-notif-item")));
  return ids.filter(i => i.startsWith("survey-"));
};

test("survey followups: Survey tag shows and the source filter finds the task", async () => {
  const { page, browser } = await start([T(), PLAIN]);
  try {
    await nav(page, "Tasks");
    const tag = page.locator('[data-task-source="survey"]');
    assert(await tag.innerText() === "Survey", "tag word");
    const bg = await tag.evaluate(e => getComputedStyle(e).backgroundColor);
    assert(bg !== "rgba(0, 0, 0, 0)", "tag has the accent fill: " + bg);
    await page.locator('select[title="Source"]').selectOption("survey");
    assert(await page.locator("[data-task-row]").count() === 1, "filter keeps only the survey task");
    assert(/How likely/.test(await page.locator("[data-task-title]").innerText()), "the survey task");
    assert(/Survey/.test(await page.textContent("[data-source-legend]")), "legend names Survey");
  } finally { await browser.close(); }
});

test("survey followups: bell gives one alert per survey with the approved copy", async () => {
  const { page, browser } = await start([T(), T({ id: "sv-fu-sv1-q2", questionId: "q2", createdAt: ago(3) })]);
  try {
    const ids = await surveyAlertIds(page);
    assert(ids.join() === "survey-sv1", "one alert: " + ids);
    const item = await page.locator('[data-notif-item="survey-sv1"]').innerText();
    assert(/Survey Co/.test(item) && /Survey follow-up needed/.test(item), "copy: " + item);
    assert(!/expired/.test(item), "a follow-up is not expired: " + item);
  } finally { await browser.close(); }
});

test("survey followups: bell keeps the newest task's date whichever order they load in", async () => {
  const { page, browser } = await start([T({ createdAt: ago(3) }), T({ id: "sv-fu-sv1-q2", questionId: "q2", createdAt: ago(1) }),
    T({ id: "sv-fu-sv2-q1", surveyId: "sv2", createdAt: ago(2) }), T({ id: "sv-fu-sv2-q2", surveyId: "sv2", questionId: "q2", createdAt: ago(5) })]);
  try {
    await surveyAlertIds(page);
    const one = await page.locator('[data-notif-item="survey-sv1"]').innerText();
    const two = await page.locator('[data-notif-item="survey-sv2"]').innerText();
    assert(/1d ago/.test(one), "newest last: " + one);
    assert(/2d ago/.test(two), "newest first: " + two);
  } finally { await browser.close(); }
});

test("survey followups: bell window is 30 days both sides; a slightly future task reads today", async () => {
  const { page, browser } = await start([T({ createdAt: ago(31) }),
    T({ id: "sv-fu-sv2-q1", surveyId: "sv2", createdAt: ago(-2) }), T({ id: "sv-fu-sv3-q1", surveyId: "sv3", status: "Done" }),
    T({ id: "sv-fu-sv4-q1", surveyId: "sv4", createdAt: ago(29) }), T({ id: "sv-fu-sv5-q1", surveyId: "sv5", createdAt: ago(-32) }),
    T({ id: "sv-fu-sv6-q1", surveyId: "sv6", createdAt: ago(0) })]);
  try {
    const ids = await surveyAlertIds(page);
    assert([...ids].sort().join() === "survey-sv2,survey-sv4,survey-sv6", "in-window open ones: " + ids);
    assert(/today/.test(await page.locator('[data-notif-item="survey-sv2"]').innerText()), "future date reads today");
    assert(/today/.test(await page.locator('[data-notif-item="survey-sv6"]').innerText()), "same day reads today");
    assert(/29d ago/.test(await page.locator('[data-notif-item="survey-sv4"]').innerText()), "old one counts days");
  } finally { await browser.close(); }
});

test("survey followups: another CSM's task gives no alert; unowned goes to admins only", async () => {
  const tasks = [T({ owner: "Someone Else" }), T({ id: "sv-fu-sv2-q1", surveyId: "sv2", owner: "" })];
  let r = await start(tasks);
  try {
    const ids = await surveyAlertIds(r.page);
    assert(ids.join() === "survey-sv2", "admin sees unowned only: " + ids);
  } finally { await r.browser.close(); }
  r = await start(tasks, "user");
  try {
    const ids = await surveyAlertIds(r.page);
    assert(ids.length === 0, "CSM sees neither: " + ids);
  } finally { await r.browser.close(); }
});

test("survey followups: ticking from Tasks opens the dialog and saves the outcome", async () => {
  const { page, browser } = await start([T()]);
  try {
    await nav(page, "Tasks");
    await tasksCheck(page).click();
    await page.waitForSelector(DLG);
    const ctx = await page.locator(`${DLG} [data-outcome-context]`).innerText();
    assert(ctx === "Ann Lee · Survey Co · How likely are you to recommend us?", "context: " + ctx);
    assert(await page.locator(`${DLG} legend`).innerText() === "What happened?", "legend");
    assert((await task(page)).status === "Open", "ticking alone completes nothing");
    await complete(page, "Fixed", "  Sorted the login  ");
    const t = await task(page);
    const o = t.surveyOutcome;
    assert(o.result === "Fixed" && o.note === "Sorted the login" && o.by === "Test User", "outcome: " + JSON.stringify(o));
    assert(o.at && t.doneAt === o.at, "doneAt stamped: " + t.doneAt);
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "merge_row" && c.args.tbl === "tasks"));
    const w = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "merge_row" && c.args.tbl === "tasks").map(c => c.args));
    assert(w.some(x => x.row_id === ID && x.patch.surveyOutcome?.result === "Fixed" && x.patch.status === "Done"), "written through: " + JSON.stringify(w));
  } finally { await browser.close(); }
});

test("survey followups: ticking from the dashboard opens the dialog and saves", async () => {
  const { page, browser } = await start([T()]);
  try {
    await page.locator(`[data-week-task="${ID}"] input[type=checkbox]`).click();
    await complete(page, "Called");
    const o = (await task(page)).surveyOutcome;
    assert(o.result === "Called" && o.note === "", "outcome: " + JSON.stringify(o));
  } finally { await browser.close(); }
});

test("survey followups: ticking from the account card opens the dialog and saves", async () => {
  const { page, browser } = await start([T()]);
  try {
    await nav(page, "Tasks");
    await page.locator("[data-task-account]").click();
    await page.locator(".ad-task input[type=checkbox]").click();
    await complete(page, "No action needed", "Customer happy now");
    const o = (await task(page)).surveyOutcome;
    assert(o.result === "No action needed" && o.note === "Customer happy now", "outcome: " + JSON.stringify(o));
  } finally { await browser.close(); }
});

test("survey followups: no radio starts selected and Complete task needs one", async () => {
  const { page, browser } = await start([T()]);
  try {
    await nav(page, "Tasks");
    await tasksCheck(page).click();
    await page.waitForSelector(DLG);
    assert(await page.locator(`${DLG} input[type=radio]:checked`).count() === 0, "nothing preselected");
    const save = page.locator(`${DLG} [data-outcome-save]`);
    assert(await save.isDisabled(), "blocked with no choice");
    await page.locator(`${DLG} [data-outcome-note]`).fill("only a note");
    assert(await save.isDisabled(), "a note is not an outcome");
    assert((await task(page)).status === "Open", "still open");
    await page.locator(`${DLG} input[value="Called"]`).check();
    assert(await save.isEnabled(), "unblocked by a choice");
  } finally { await browser.close(); }
});

test("survey followups: Cancel, Escape and the backdrop leave the task Open", async () => {
  const { page, browser } = await start([T()]);
  try {
    await nav(page, "Tasks");
    const closes = [() => page.locator(`${DLG} [data-outcome-cancel]`).click(), () => page.keyboard.press("Escape"), () => page.mouse.click(5, 5)];
    for (const close of closes) {
      await tasksCheck(page).click();
      await page.waitForSelector(DLG);
      await page.locator(`${DLG} input[value="Fixed"]`).check();
      await close();
      await page.waitForSelector(DLG, { state: "detached" });
      const t = await task(page);
      assert(t.status === "Open" && !t.surveyOutcome && !t.doneAt, "untouched: " + JSON.stringify(t));
      assert(!(await tasksCheck(page).isChecked()), "box stays clear");
    }
  } finally { await browser.close(); }
});

test("survey followups: un-ticking reopens with no dialog, keeps the outcome; completing again overwrites", async () => {
  const first = { result: "Called", note: "First call", by: "Test User", at: ago(2) };
  const { page, browser } = await start([T({ status: "Done", doneAt: first.at, surveyOutcome: first })]);
  try {
    await nav(page, "Tasks");
    await page.locator('[data-task-section="done"] .tk-sec-head').click();
    await tasksCheck(page).click();
    await waitTask(page, "Open");
    assert(await page.locator(DLG).count() === 0, "no dialog on un-tick");
    assert(JSON.stringify((await task(page)).surveyOutcome) === JSON.stringify(first), "outcome kept on reopen");
    await tasksCheck(page).click();
    await page.waitForSelector(DLG);
    const last = await page.locator(`${DLG} [data-survey-last-outcome]`).innerText();
    assert(/Called/.test(last) && /First call/.test(last), "old outcome visible: " + last);
    assert(await page.locator(`${DLG} input[type=radio]:checked`).count() === 0, "old outcome is not preselected");
    await complete(page, "Fixed", "Second go");
    const t = await task(page);
    assert(t.surveyOutcome.result === "Fixed" && t.surveyOutcome.note === "Second go" && t.doneAt === t.surveyOutcome.at, "overwritten: " + JSON.stringify(t));
  } finally { await browser.close(); }
});

test("survey followups: a task finished elsewhere closes the dialog, and a later reopen does not bring it back", async () => {
  const { page, browser } = await start([T()]);
  try {
    await nav(page, "Tasks");
    await tasksCheck(page).click();
    await page.waitForSelector(DLG);
    await page.evaluate(i => window.__store.dispatch({ type: "TOGGLE_TASK", id: i }), ID);
    await page.waitForSelector(DLG, { state: "detached" });
    await page.evaluate(i => window.__store.dispatch({ type: "TOGGLE_TASK", id: i }), ID);
    await waitTask(page, "Open");
    await page.waitForTimeout(200);
    assert(await page.locator(DLG).count() === 0, "dialog stayed closed after the reopen");
  } finally { await browser.close(); }
});

test("survey followups: an ordinary task toggles with no dialog", async () => {
  const { page, browser } = await start([PLAIN]);
  try {
    await nav(page, "Tasks");
    await tasksCheck(page).click();
    await waitTask(page, "Done", "p1");
    assert(await page.locator(DLG).count() === 0, "no dialog");
    assert(!(await task(page, "p1")).surveyOutcome, "no outcome");
  } finally { await browser.close(); }
});

test("survey followups: 390px dialog has 44px controls and no sideways scroll", async () => {
  const { page, browser } = await start([T()]);
  try {
    await nav(page, "Tasks");
    await page.setViewportSize({ width: 390, height: 780 });
    await tasksCheck(page).click();
    await page.waitForSelector(DLG);
    const m = await page.evaluate(sel => {
      const d = document.querySelector(sel), h = e => Math.round(e.getBoundingClientRect().height);
      return { controls: [...d.querySelectorAll("[data-outcome-option], [data-outcome-note], [data-outcome-cancel], [data-outcome-save]")].map(h),
        page: document.documentElement.scrollWidth, box: d.scrollWidth - d.clientWidth };
    }, DLG);
    assert(m.controls.length === 6 && m.controls.every(x => x >= 44), "44px: " + m.controls);
    assert(m.page <= 390 && m.box <= 0, "sideways: " + JSON.stringify(m));
  } finally { await browser.close(); }
});
