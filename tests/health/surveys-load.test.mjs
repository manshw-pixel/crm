import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// surveys.sql is run in production only after the app ships: a missing `surveys` relation must
// not fail the whole load (it is deliberately outside fetchAll's fail-the-load check).
const rows = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("fetchAll still loads the CRM when the surveys query errors; surveys is []", async () => {
  const { page, browser } = await launch(`${rows} window.__tableError = { surveys: { code: "42P01", message: 'relation "public.surveys" does not exist' } };`);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().settings, null, { timeout: 15000 });
    const s = await page.evaluate(() => { const st = window.__store.getState(); return { surveys: st.surveys, accounts: st.accounts.length }; });
    assert(Array.isArray(s.surveys) && s.surveys.length === 0, "surveys should be []: " + JSON.stringify(s));
    assert(!(await page.evaluate(() => /could not load|failed to load/i.test(document.body.innerText))), "load error shown");
  } finally { await browser.close(); }
});

test("fetchAll maps survey rows to camelCase and never asks for the token", async () => {
  const sv = { id: "s1", account_id: "a1", contact_id: "c1", contact_name: "Ann", contact_role: "CIO", template_id: "nps-checkin", template_snapshot: { name: "NPS" }, source: "manual",
    sent_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", submitted_at: "2026-11-02T00:00:00Z",
    survey_answers: [{ question_id: "nps", value_num: 9, value_text: null, value_choices: null }, { question_id: "reason", value_num: null, value_text: "Great", value_choices: null }] };
  const { page, browser } = await launch(`${rows} window.__seedRows.surveys = ${JSON.stringify([sv])};`);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().surveys && window.__store.getState().surveys.length === 1, null, { timeout: 15000 });
    const s = await page.evaluate(() => window.__store.getState().surveys[0]);
    assert(s.accountId === "a1" && s.contactName === "Ann" && s.answers.nps === 9 && s.answers.reason === "Great", JSON.stringify(s));
    assert(!("token" in s), "token must not be loaded");
  } finally { await browser.close(); }
});
