// Dashboard narrow cards at 1280px with ~40-char names: rows must not overlap or wrap
// into each other, truncated cells carry a title, and the "N more" cue never sits on a
// half-visible row.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const NAMES = ["Nimbus Telecom", "Globex Corporation", "Initech Systems", "Umbrella Holdings", "Hooli Platforms", "Stark Industries", "Wayne Enterprises", "Cyberdyne Robotics"];
const long = s => `QA qa-20261028-2010 ${s} International`.slice(0, 42);
const accts = NAMES.map((n, i) => seedAccount({ id: "a" + i, name: long(n), arr: 100000 + i * 37000, renewalDate: d(5 + i * 10),
  inputs: i % 2 ? { usage: 25, sentiment: 25, tickets: 9, nps: -40 } : { usage: 80, sentiment: 80, tickets: 0, nps: 40 } }));
const OWNERS = ["Priyanka Ramachandran-Venkataraman", "Rahul Subramanian Iyer-Krishnamurthy", "Unassigned"];
const tasks = Array.from({ length: 10 }, (_, i) => {
  const id = "t" + i;
  return { id, data: { id, accountId: "a" + (i % 8), title: `Prepare the quarterly business review deck and exec summary ${i}`,
    due: d(i - 2), owner: OWNERS[i % 3], priority: ["High", "Medium", "Low"][i % 3], status: "Open", createdAt: d(-10) } };
});
export const crowdSeed = `window.__seedRows = { accounts: ${JSON.stringify(accts.map(a => ({ id: a.id, data: a })))}, contacts: [], activities: [],
  tasks: ${JSON.stringify(tasks)}, opportunities: [], team: [{ id: "u1", data: { name: "Priya" } }], settings: [] };`;

const CARDS = ["Renewals in the next 90 days", "Needs attention", "Tasks this week", "Team tasks"];

for (const width of [1280, 1440]) test(`dashboard narrow cards do not crowd at ${width}px with long names`, async () => {
  const { page, browser } = await launch(crowdSeed);
  try {
    await page.setViewportSize({ width, height: 900 });
    for (const c of CARDS) await page.waitForSelector(`[data-scroll-list="${c}"] [data-row]`);
    await page.waitForTimeout(600);
    const problems = await page.evaluate(cards => {
      const out = [];
      const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      for (const c of cards) {
        const wrap = document.querySelector(`[data-scroll-list="${c}"]`);
        const sc = wrap.querySelector("[aria-label]");
        const box = sc.getBoundingClientRect();
        const rows = Array.from(sc.querySelectorAll("[data-row]"));
        // leaf text boxes: elements holding their own non-blank text
        const leaves = [];
        rows.forEach((r, ri) => r.querySelectorAll("*").forEach(el => {
          if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) return;
          const rect = el.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
          if (el.getClientRects().length > 1 || rect.height > lh * 1.6) out.push(`${c}: "${el.textContent.trim().slice(0, 30)}" wraps`);
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline" && !el.getAttribute("title")) out.push(`${c}: truncated "${el.textContent.trim().slice(0, 30)}" lacks title`);
          if (rect.width < 40 && el.scrollWidth > el.clientWidth + 1) out.push(`${c}: "${el.textContent.trim().slice(0, 30)}" squeezed to ${Math.round(rect.width)}px`);
          if (getComputedStyle(el).display !== "inline" && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis") out.push(`${c}: "${el.textContent.trim().slice(0, 30)}" is clipped without an ellipsis`);
          leaves.push({ ri, el, rect });
        }));
        for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
          const a = leaves[i], b = leaves[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          if (hit(a.rect, b.rect)) out.push(`${c}: "${a.el.textContent.trim().slice(0, 20)}" overlaps "${b.el.textContent.trim().slice(0, 20)}"`);
        }
        // at rest, each row is whole: fully visible or fully below the fold
        rows.forEach(r => { const b = r.getBoundingClientRect();
          if (b.top < box.bottom - 1 && b.bottom > box.bottom + 1) out.push(`${c}: a row is cut by the card edge`); });
        const pill = wrap.querySelector("[data-more-count]");
        if (pill) { const p = pill.getBoundingClientRect();
          leaves.filter(l => l.rect.bottom <= box.bottom + 1).forEach(l => { if (hit(p, l.rect)) out.push(`${c}: more cue covers "${l.el.textContent.trim().slice(0, 20)}"`); }); }
      }
      return out;
    }, CARDS);
    assert(problems.length === 0, problems.slice(0, 12).join("\n  "));
  } finally { await browser.close(); }
});
