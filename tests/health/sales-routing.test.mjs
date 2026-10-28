import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// Sales feed routing: rows marked destination=onboarding become implementation projects.
// The sales folder is a granted fake handle whose single CSV (window.__csv, window.__mtime) the
// test can rewrite between syncs, behind an in-memory IndexedDB.
const seed = `
window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
window.__csv = ""; window.__mtime = 1;
window.__handle = { kind: "directory", name: "Sales",
  async queryPermission() { return "granted"; },
  async requestPermission() { return "granted"; },
  async *entries() { yield ["sales.csv", { kind: "file", getFile: async () => new File([window.__csv], "sales.csv", { lastModified: window.__mtime }) }]; },
};
window.showDirectoryPicker = async () => window.__handle;
(() => {
  const store = new Map([["sales", window.__handle]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); },
    delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; },
  }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
})();
`;
const HEAD = "name,destination,order_form,go_live_target,customer_contact,modules_scope";
const NODEST = "name,order_form,go_live_target,customer_contact,modules_scope\nKestrel,yes,15-11-2026,Asha,Core\n";
const FULL = `${HEAD}\nKestrel,onboarding,yes,15-11-2026,Asha,Core\n`;

async function run(csv, fn) {
  const { page, browser } = await launch(seed);
  try {
    await page.click('button[title="Settings"]', { timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll("h3")].some(h => /shared drive/i.test(h.textContent)), null, { timeout: 10000 });
    await page.waitForSelector("[data-files='sales']", { timeout: 10000 });
    const sync = async (text, mtime) => {
      await page.evaluate(([t, m]) => { window.__csv = t; window.__mtime = m; }, [text, mtime]);
      const lastBefore = await page.evaluate(() => { const i = window.__store.getState().settings.integrations; const l = i && i.log[i.log.length - 1]; return l ? l.t + "|" + l.file + "|" + l.msg + "|" + i.log.length : ""; });
      await page.evaluate(() => [...document.querySelectorAll("button")].find(b => /Sync now/.test(b.textContent)).click());
      const last = () => page.evaluate(() => { const i = window.__store.getState().settings.integrations; const l = i && i.log[i.log.length - 1]; return l ? l.t + "|" + l.file + "|" + l.msg + "|" + i.log.length : ""; });
      for (let i = 0; i < 100 && await last() === lastBefore; i++) await page.waitForTimeout(100);
      return page.evaluate(() => { const s = window.__store.getState(); const l = s.settings.integrations.log; return { projects: s.projects || [], accounts: s.accounts, log: l[l.length - 1].msg }; });
    };
    await fn(sync, page);
  } finally { await browser.close(); }
}

test("onboarding row with full checklist queues a project", async () => {
  await run(FULL, async sync => {
    const r = await sync(FULL, 1);
    assert(r.accounts.some(a => a.name === "Kestrel"), "account imported");
    assert(r.projects.length === 1, "one project, got " + r.projects.length);
    const p = r.projects[0];
    assert(p.stage === "queued" && p.type === "onboarding" && p.source === "sales-feed", JSON.stringify(p));
    assert(/projects queued 1/.test(r.log), r.log);
  });
});

test("missing required item makes a handover draft", async () => {
  await run("", async sync => {
    const r = await sync(`${HEAD}\nKestrel,onboarding,yes,15-11-2026,,Core\n`, 1);
    assert(r.projects.length === 1 && r.projects[0].stage === "handover", JSON.stringify(r.projects.map(p => p.stage)));
    assert(/drafts 1/.test(r.log), r.log);
  });
});

test("label headers with * and tick values queue; drafts log what is missing", async () => {
  await run("", async sync => {
    const H = "name,destination,Signed order form attached *,Go-live target date *,Customer project contact *,Modules / scope purchased *";
    let r = await sync(`${H}
Kestrel,onboarding,✔,15-11-2026,Asha,Core
`, 1);
    assert(r.projects.length === 1 && r.projects[0].stage === "queued", JSON.stringify(r.projects.map(p => p.stage)));
    r = await sync(`${H}
Orion,onboarding,✔,15-11-2026,,Core
`, 2);
    assert(/drafts 1 \(missing: /.test(r.log) && /Customer project contact/.test(r.log), r.log);
  });
});

test("blank destination with default accounts changes nothing", async () => {
  await run("", async sync => {
    const r = await sync(`${HEAD}\nKestrel,,yes,15-11-2026,Asha,Core\n`, 1);
    assert(r.projects.length === 0, "no projects");
    assert(r.accounts.some(a => a.name === "Kestrel"), "account imported");
    assert(/projects queued 0 · drafts 0 · skipped 0/.test(r.log), r.log);
  });
});

test("re-sync of an edited file does not duplicate", async () => {
  await run("", async sync => {
    await sync(FULL, 1);
    const r = await sync(FULL, 2);
    assert(r.projects.length === 1, "still one project, got " + r.projects.length);
    assert(/open project exists: 1/.test(r.log), r.log);
  });
});

test("unknown destination imports the account only", async () => {
  await run("", async sync => {
    const r = await sync(`${HEAD}\nKestrel,crm,yes,15-11-2026,Asha,Core\n`, 1);
    assert(r.projects.length === 0, "no projects");
    assert(r.accounts.some(a => a.name === "Kestrel"), "account imported");
    assert(/unknown destination "crm"/.test(r.log), r.log);
  });
});

test("default destination onboarding routes rows without a destination column", async () => {
  await run("", async (sync, page) => {
    await page.selectOption("[data-sales-default]", "onboarding");
    const r = await sync(NODEST, 1);
    assert(r.projects.length === 1, "one project, got " + r.projects.length);
    await sync(NODEST, 2);
    const d = await page.evaluate(() => window.__store.getState().settings.integrations.salesDefault);
    assert(d === "onboarding", "salesDefault kept, got " + d);
  });
});

test("default onboarding applies to new accounts only; explicit onboarding still works for existing", async () => {
  await run("", async (sync, page) => {
    await sync(`${HEAD}
Kestrel,,yes,15-11-2026,Asha,Core
`, 1);
    await page.selectOption("[data-sales-default]", "onboarding");
    let r = await sync(`${HEAD}
Kestrel,,yes,15-11-2026,Asha,Core
Orion,,yes,15-11-2026,Asha,Core
`, 2);
    const names = r.projects.map(p => r.accounts.find(a => a.id === p.accountId)?.name);
    assert(r.projects.length === 1 && names[0] === "Orion", "only the new account gets a project, got " + JSON.stringify(names));
    r = await sync(`${HEAD}
Kestrel,onboarding,yes,15-11-2026,Asha,Core
`, 3);
    const k = r.accounts.find(a => a.name === "Kestrel");
    assert(r.projects.some(p => p.accountId === k.id), "explicit onboarding opens a project for the existing account");
  });
});

test("onboarding template lists checklist ids", async () => {
  await run("", async (sync, page) => {
    await page.evaluate(() => {
      window.__dl = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = b => { b.text().then(t => { window.__dlText = t; }); return orig.call(URL, b); };
      HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; };
    });
    await page.click('[data-feed=sales] [data-csv-template="Onboarding"]'); // the CSV link; the Excel button is covered by integrations-xlsx
    await page.waitForFunction(() => window.__dlText, null, { timeout: 5000 });
    const { name, text } = await page.evaluate(() => ({ name: window.__dl, text: window.__dlText }));
    const head = text.split("\n")[0];
    assert(name === "sales-onboarding.csv", name);
    for (const c of ["destination", "go_live_target", "customer_contact"]) assert(head.split(",").includes(c), c + " in " + head);
    assert(/Example Co \(delete this row\)/.test(text) && /,onboarding,/.test(text), text);
  });
});

// The QA hook is gated: absent for ordinary users, present only when the runner sets window.__qaHooks before app scripts.
for (const [label, flag] of [["absent without __qaHooks", false], ["present with __qaHooks", true]]) {
  test(`sales routing: QA hook __syncSalesText is ${label}`, async () => {
    const { page, browser } = await launch(seed + (flag ? "window.__qaHooks = true;" : ""));
    try {
      await page.click('button[title="Settings"]', { timeout: 15000 });
      await page.waitForSelector("[data-files='sales']", { timeout: 10000 });
      const has = await page.evaluate(() => typeof window.__syncSalesText === "function");
      assert(has === flag, `__syncSalesText ${has ? "exists" : "missing"}, expected ${flag ? "present" : "absent"}`);
    } finally { await browser.close(); }
  });
}
