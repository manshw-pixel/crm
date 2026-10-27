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
const FULL = `${HEAD}\nKestrel,onboarding,yes,15-11-2026,Asha,Core\n`;

async function run(csv, fn) {
  const { page, browser } = await launch(seed);
  try {
    await page.click('button[title="Settings"]', { timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll("h3")].some(h => /shared drive/i.test(h.textContent)), null, { timeout: 10000 });
    await page.waitForSelector("[data-files='sales']", { timeout: 10000 });
    const sync = async (text, mtime) => {
      await page.evaluate(([t, m]) => { window.__csv = t; window.__mtime = m; }, [text, mtime]);
      const count = () => page.evaluate(() => { const i = window.__store.getState().settings.integrations; return i ? i.log.length : 0; });
      const before = await count();
      await page.evaluate(() => [...document.querySelectorAll("button")].find(b => /Sync now/.test(b.textContent)).click());
      await page.waitForFunction(() => { const i = window.__store.getState().settings.integrations; return i && i.log.length > 0; }, null, { timeout: 10000 });
      for (let i = 0; i < 100 && await count() <= before; i++) await page.waitForTimeout(100);
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
