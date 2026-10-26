import { readFileSync, writeFileSync } from "node:fs";
import { buildMockedHtml, seedAccount } from "./health/harness.mjs";
import { fileURLToPath } from "node:url";
const accounts = [
  seedAccount({ id: "a1", name: "Globex", arr: 240000, csm: "Priya" }),
  seedAccount({ id: "a2", name: "Initech", arr: 90000, csm: "Rahul", inputs: { usage: 40, sentiment: 50, tickets: 6, nps: -10 } }),
  seedAccount({ id: "a3", name: "Umbrella", arr: 150000, csm: "Priya" }),
];
const base = `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })), team: [{ id: "u1", data: { name: "Priya" } }, { id: "u2", data: { name: "Rahul" } }], contacts: [], activities: [], tasks: [], opportunities: [], settings: [], orgs: [{ id: "org-a", name: "Acme Corp" }] };
window.__seedOrgs = [{ id: "org-a", name: "Acme Corp", created_at: "2026-01-01", users: 3 }, { id: "org-b", name: "Beta Ltd", created_at: "2026-02-01", users: 1 }];
window.__seedUsers = [{ id: "u1", name: "Owner", role: "admin", disabled: false, email: "owner@acme.test" }, { id: "u2", name: "Priya", role: "user", disabled: false, email: "priya@acme.test" }];`;
const pages = {
  "demo-platform.html": `${base} window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "org-a", platform_admin: true };`,
  "demo-user.html": `${base} window.__seedProfile = { id: "u2", name: "Priya", role: "user", org_id: "org-a", platform_admin: false };`,
  "demo-noorg.html": `${base} window.__seedProfile = { id: "u9", name: "Stranger", role: "user", org_id: null, platform_admin: false };`,
};
for (const [name, seed] of Object.entries(pages)) {
  const src = fileURLToPath(buildMockedHtml(seed));
  writeFileSync(new URL(`../dist/${name}`, import.meta.url), readFileSync(src));
  console.log("wrote dist/" + name);
}
