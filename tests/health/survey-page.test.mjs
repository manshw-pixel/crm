// dist/survey.html is the public, customer-facing survey page. It runs under its REAL CSP
// (no bypass) with /rest/v1/rpc/* routed to fixtures, like csp.test.mjs does for the CRM.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { test, assert } from "./framework.mjs";

const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";
const FILE = fileURLToPath(new URL("../../dist/survey.html", import.meta.url));
const BASE = "file://" + FILE.replace(/\\/g, "/");

const QUESTIONS = [
  { id: "nps", type: "nps", text: "How likely are you to recommend {orgName} to a friend or colleague?", required: true },
  { id: "reason", type: "text", text: "What's the main reason for your score?", required: false },
];
const SURVEY = { orgName: "Acme Corp", csmName: "Priya", firstName: "Sam", accountName: "Globex",
  intro: "Thanks for working with us — this takes under a minute.", questions: QUESTIONS, editable: true };
const XSS = "<img src=x onerror=window.__x=1>";
const FIXTURES = {
  xss: { ...SURVEY, orgName: XSS, csmName: XSS, questions: [
    { id: "nps", type: "nps", text: "Q " + XSS, required: true },
    { id: "pick", type: "single", text: "Pick", options: [XSS], required: false }] },
  fresh: SURVEY,
  types: { ...SURVEY, questions: [
    { id: "r1", type: "rating", text: "Rate onboarding", required: true, scale: 5, lowLabel: "Poor", highLabel: "Excellent" },
    { id: "s1", type: "single", text: "Best feature?", required: false, options: ["Reports", "Alerts", "Tasks"] },
    { id: "m1", type: "multi", text: "Which modules?", required: false, options: ["Accounts", "Renewals", "Finance"] }] },
  multireq: { ...SURVEY, questions: [
    { id: "m1", type: "multi", text: "Which modules?", required: true, options: ["Accounts", "Renewals", "Finance"] }] },
  done: { ...SURVEY, answers: { nps: 7, reason: "Good support" }, submittedAt: "2026-11-01T10:00:00Z", editable: true },
  locked: { ...SURVEY, answers: { nps: 7 }, submittedAt: "2026-10-01T10:00:00Z", editable: false },
};

async function open(query, fn, { width = 1024 } = {}) {
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const calls = [], violations = [], errors = [];
    await page.exposeFunction("__cspViolation", v => violations.push(v));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation",
      e => window.__cspViolation(`${e.violatedDirective} ${e.blockedURI}`)));
    page.on("pageerror", e => errors.push(e.message));
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    await page.route("**/rest/v1/rpc/*", async r => {
      const req = r.request();
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
      const fn = req.url().split("/rpc/")[1];
      const body = JSON.parse(req.postData() || "{}");
      calls.push({ fn, body, headers: req.headers() });
      let res = null;
      if (fn === "get_survey") res = FIXTURES[body.p_token] || null;
      else res = { ok: !!FIXTURES[body.p_token] || (fn === "unsubscribe_survey" && body.p_token === "expired") };
      return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(res) });
    });
    await page.goto(BASE + query);
    await page.waitForSelector("[data-state]", { timeout: 10000 });
    return await fn(page, { calls, violations, errors });
  } finally { await browser.close(); }
}
const text = page => page.locator("main").innerText();

test("survey page: renders snapshot with greeting", async () => {
  await open("?t=fresh", async page => {
    assert(await page.locator("header").innerText().then(t => t.includes("Acme Corp")), "org name in header");
    const t = await text(page);
    assert(t.includes("Hi Sam"), "greeting: " + t);
    assert(t.includes("Priya from Acme Corp would like your feedback"), "csm line");
    assert(t.includes("How likely are you to recommend Acme Corp"), "placeholder filled");
    assert(await page.locator("fieldset legend").count() === 2, "fieldset/legend per question");
    assert(await page.locator('input[type=radio][name=nps]').count() === 11, "11 nps radios");
    assert(t.includes("Not likely") && t.includes("Very likely"), "end labels");
    assert(await page.locator("textarea").count() === 1, "textarea");
  });
});

test("survey page: rating renders scale with labels", async () => {
  await open("?t=types", async page => {
    assert(await page.locator('input[type=radio][name=r1]').count() === 5, "5 rating radios");
    const t = await text(page);
    assert(t.includes("Poor") && t.includes("Excellent"), "end labels: " + t);
    assert(!t.includes("Not likely"), "no nps labels on rating");
  });
});

test("survey page: single and multi submit", async () => {
  await open("?t=types", async (page, { calls }) => {
    await page.check('input[name=r1][value="4"]');
    await page.check('input[name=s1][value="Alerts"]');
    await page.check('input[name=m1][value="Accounts"]');
    await page.check('input[name=m1][value="Finance"]');
    await page.click("button[type=submit]");
    await page.waitForSelector('[data-state="thanks"]');
    const sub = calls.find(c => c.fn === "submit_survey");
    assert(JSON.stringify(sub.body.p_answers) === JSON.stringify({ r1: 4, s1: "Alerts", m1: ["Accounts", "Finance"] }), JSON.stringify(sub.body));
  });
});

test("survey page: multi required error", async () => {
  await open("?t=multireq", async (page, { calls }) => {
    await page.click("button[type=submit]");
    assert(await page.locator("#err-m1").isVisible(), "error visible");
    assert(!calls.some(c => c.fn === "submit_survey"), "nothing posted");
    await page.check('input[name=m1][value="Renewals"]');
    await page.click("button[type=submit]");
    await page.waitForSelector('[data-state="thanks"]');
    const sub = calls.find(c => c.fn === "submit_survey");
    assert(JSON.stringify(sub.body.p_answers) === JSON.stringify({ m1: ["Renewals"] }), JSON.stringify(sub.body));
  });
});

test("survey page: prefill selects 9", async () => {
  await open("?t=fresh&q=nps&v=9", async page => {
    assert(await page.locator('input[name=nps][value="9"]').isChecked(), "9 checked");
  });
});

test("survey page: bad prefill ignored", async () => {
  for (const q of ["?t=fresh&q=nps&v=11", "?t=fresh&q=reason&v=3", "?t=fresh&q=nps&v=x"]) {
    await open(q, async page => {
      assert(await page.locator('input[name=nps]:checked').count() === 0, "nothing checked for " + q);
    });
  }
});

test("survey page: required error shown and nothing posted", async () => {
  await open("?t=fresh", async (page, { calls }) => {
    await page.click("button[type=submit]");
    const err = page.locator("#err-nps");
    assert(await err.isVisible(), "error visible");
    const desc = await page.locator("fieldset").first().getAttribute("aria-describedby");
    assert(desc && desc.includes("err-nps"), "aria-describedby: " + desc);
    assert(!calls.some(c => c.fn === "submit_survey"), "nothing posted");
  });
});

test("survey page: submit posts answers and thanks", async () => {
  await open("?t=fresh", async (page, { calls }) => {
    await page.check('input[name=nps][value="8"]');
    await page.fill("textarea", "Fast replies");
    await page.click("button[type=submit]");
    await page.waitForSelector('[data-state="thanks"]');
    const sub = calls.find(c => c.fn === "submit_survey");
    assert(sub && sub.body.p_token === "fresh", "posted token");
    assert(JSON.stringify(sub.body.p_answers) === JSON.stringify({ nps: 8, reason: "Fast replies" }), JSON.stringify(sub.body));
    assert(sub.headers.apikey && /^Bearer /.test(sub.headers.authorization), "auth headers");
    assert((await text(page)).includes("Thank you — your answers were sent."), "thanks");
    await page.click("text=Edit answers");
    await page.waitForSelector('[data-state="form"]');
    assert(await page.locator('input[name=nps][value="8"]').isChecked(), "kept answer");
    assert((await page.locator("button[type=submit]").innerText()).includes("Update answers"), "update label");
  });
});

test("survey page: revisit shows prior answers", async () => {
  await open("?t=done", async page => {
    assert(await page.locator('input[name=nps][value="7"]').isChecked(), "7 checked");
    assert(await page.inputValue("textarea") === "Good support", "text kept");
    assert((await page.locator("button[type=submit]").innerText()).includes("Update answers"), "update label");
  });
});

test("survey page: not editable message", async () => {
  await open("?t=locked", async page => {
    assert((await text(page)).includes("This survey can no longer be changed."), "locked msg");
    assert(await page.locator("button[type=submit]").count() === 0, "no submit");
  });
});

test("survey page: unsubscribe flow", async () => {
  await open("?t=fresh&u=1", async (page, { calls }) => {
    assert((await text(page)).includes("Unsubscribe from these surveys?"), "prompt");
    assert(!calls.length, "no rpc before click: " + calls.map(c => c.fn));
    await page.click("button:has-text('Unsubscribe')");
    await page.waitForSelector('[data-state="unsubscribed"]');
    assert((await text(page)).includes("You won't receive more surveys."), "done msg");
    assert(!calls.some(c => c.fn === "get_survey"), "get_survey never called");
  });
});

test("survey page: unsubscribe works for an expired token", async () => {
  await open("?t=expired&u=1", async (page, { calls }) => {
    await page.click("button:has-text('Unsubscribe')");
    await page.waitForSelector('[data-state="unsubscribed"]');
    assert(!calls.some(c => c.fn === "get_survey"), "get_survey never called");
    assert(calls.some(c => c.fn === "unsubscribe_survey" && c.body.p_token === "expired"), "unsubscribe posted");
  });
});

test("survey page: unsubscribe with unknown token says invalid", async () => {
  await open("?t=nope&u=1", async page => {
    await page.click("button:has-text('Unsubscribe')");
    await page.waitForSelector('[data-state="invalid"]');
    assert((await text(page)).includes("This survey link is no longer valid."), "invalid msg");
  });
});

test("survey page: hostile text renders as literal text", async () => {
  await open("?t=xss", async page => {
    const t = await page.locator("body").innerText();
    assert(t.includes(XSS), "literal text shown: " + t);
    assert(await page.locator("main img, header img").count() === 0, "no img element");
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => window.__x) === undefined, "onerror ran");
  });
});

test("survey page: bad token message", async () => {
  for (const q of ["?t=nope", ""]) {
    await open(q, async page => {
      assert((await text(page)).includes("This survey link is no longer valid."), "bad token " + q);
    });
  }
});

test("survey page: no CSP violations", async () => {
  const html = readFileSync(FILE, "utf8");
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  assert(/default-src 'none'/.test(csp) && /script-src 'sha256-/.test(csp) && /style-src 'sha256-/.test(csp), "csp: " + csp);
  assert(/connect-src https:\/\/hmnbhweoktljjuiigzqo\.supabase\.co/.test(csp) && /img-src data:/.test(csp), "csp: " + csp);
  assert(!html.includes("__SUPABASE_") && !html.includes("__SURVEYS_LIB__"), "placeholders replaced");
  await open("?t=fresh", async (page, { violations, errors }) => {
    await page.check('input[name=nps][value="10"]');
    await page.click("button[type=submit]");
    await page.waitForSelector('[data-state="thanks"]');
    assert(violations.length === 0, "violations: " + violations.join(" | "));
    assert(errors.length === 0, "errors: " + errors.join(" | "));
  });
});

test("survey page: 390px no horizontal overflow", async () => {
  await open("?t=fresh", async page => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(o <= 0, "overflow " + o);
  }, { width: 390 });
});
