import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// surveys.sql is run in production only after the app ships: a missing `surveys` relation must
// not fail the whole load (it is deliberately outside fetchAll's fail-the-load check).
const acc = seedAccount({ id: "ld1", name: "Loaded Co", accountNo: 1 });
const rows = `window.__seedRows = { accounts: ${JSON.stringify([{ id: acc.id, data: acc }])}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("fetchAll still loads the CRM when the surveys query errors; surveys is []", async () => {
  const { page, browser } = await launch(`${rows} window.__tableError = { surveys: { code: "42P01", message: 'relation "public.surveys" does not exist' } };`);
  try {
    // the seeded account only reaches the store if fetchAll succeeded -- proves the load completed
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.some(a => a.id === "ld1"), null, { timeout: 15000 });
    const s = await page.evaluate(() => { const st = window.__store.getState(); return { surveys: st.surveys, accounts: st.accounts.length }; });
    assert(Array.isArray(s.surveys) && s.surveys.length === 0, "surveys should be []: " + JSON.stringify(s));
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

const mkSurvey = i => ({ id: "s" + String(i).padStart(5, "0"), account_id: "a1", contact_id: null, contact_name: "N", contact_role: "", template_id: "t", template_snapshot: {}, source: "manual",
  sent_at: "2026-11-01T00:00:00Z", expires_at: null, submitted_at: null, survey_answers: [] });
const many = Array.from({ length: 1002 }, (_, i) => mkSurvey(i));

test("surveys read pages past 1000", async () => {
  const { page, browser } = await launch(`${rows} window.__seedRows.surveys = ${JSON.stringify(many)};`);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().surveys && window.__store.getState().surveys.length >= 1000, null, { timeout: 15000 });
    const n = await page.evaluate(() => window.__store.getState().surveys.length);
    assert(n === 1002, "expected 1002 surveys, got " + n);
  } finally { await browser.close(); }
});

test("a failed second page keeps surveys unknown", async () => {
  const { page, browser } = await launch(`${rows} window.__seedRows.surveys = ${JSON.stringify(many)}; window.__rangeFailFrom = { surveys: 1000 };`);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.some(a => a.id === "ld1"), null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => window.__store.getState().surveys);
    assert(s === null, "surveys must stay null on a partial read, got " + (s && s.length));
  } finally { await browser.close(); }
});
