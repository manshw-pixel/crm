// Implementation projects (spec 2026-10-26, PR 1). Every "cannot" is paired with a "can".
// Seeds go through SQL as postgres (auth.uid() is null, so the guards stand aside); every
// attack goes through merge_row, the app's real write path, so a patch-only upsert is what
// the triggers and policies actually judge.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, invitedFresh, valueOf, stillExists, ORG_A } from "./fixtures.mjs";

const people = {};
const mk = async (key, email, role, name) => {
  if (people[key]) return people[key];
  const p = await invitedFresh(email);
  await sql(`update profiles set role = $2, name = $3 where id = $1`, [p.id, role, name]);
  return (people[key] = p);
};
const implLead = () => mk("lead", "impl-lead@test.local", "impl_lead", "Impl Lead");
const implementer = () => mk("impl", "impl-user@test.local", "impl_user", "Impl User");
const otherImpl = () => mk("other", "impl-other@test.local", "impl_user", "Other Impl");

const merge = (client, tbl, row_id, patch) => client.rpc("merge_row", { tbl, row_id, patch, appends: {} });
const seed = (table, id, data) => sql(`insert into public.${table} (org_id, id, data) values ($1, $2, $3)
  on conflict (org_id, id) do update set data = excluded.data`, [ORG_A, id, data]);
const clean = () => sql(`delete from public.project_tasks where id like 'im-%'; delete from public.projects where id like 'im-%';
  delete from public.accounts where id like 'im-%'; delete from public.contacts where id like 'im-%'`);
const errMatch = (r, re, what) => assert(r.error && re.test(r.error.message), `${what}: ` + JSON.stringify(r.error || "no error"));
const ok = (r, what) => assert(!r.error, `${what} failed: ` + r.error?.message);

// An account whose CSM is "Plain User" (sessions.user), a project assigned to `implementer`.
async function world(stage = "in_progress") {
  const impl = await implementer();
  await seed("accounts", "im-acc", { name: "ImplCo", csm: "Plain User", arr: 100 });
  await seed("projects", "im-p", { accountId: "im-acc", type: "onboarding", stage, implementerId: impl.id, history: [] });
  return impl;
}

test("impl_user reads accounts but cannot write CRM data; a CSM still can", async () => {
  const impl = await implementer();
  try {
    await world();
    await seed("contacts", "im-c", { accountId: "im-acc", name: "C" });
    const seen = ((await impl.client.from("accounts").select("id")).data || []).map(r => r.id);
    assert(seen.includes("im-acc"), "impl_user cannot read the account: " + JSON.stringify(seen));
    const edit = await merge(impl.client, "accounts", "im-acc", { arr: 999 });
    assert(edit.error, "impl_user edited an account's ARR");
    assert((await valueOf("accounts", "im-acc")).arr === 100, "ARR changed despite the error");
    const add = await merge(impl.client, "contacts", "im-c2", { accountId: "im-acc", name: "X" });
    assert(add.error && !(await stillExists("contacts", "im-c2")), "impl_user created a contact");
    await impl.client.from("contacts").delete().eq("id", "im-c");   // a denied delete raises nothing
    assert(await stillExists("contacts", "im-c"), "impl_user deleted a contact");
    ok(await merge(sessions.user, "accounts", "im-acc", { arr: 150 }), "control: CSM ARR edit");
    assert((await valueOf("accounts", "im-acc")).arr === 150, "control: CSM ARR edit did not land");
  } finally { await clean(); }
});

test("a CSM creates a handover project but cannot assign or skip ahead; impl_lead assigns", async () => {
  const lead = await implLead(); const impl = await implementer();
  try {
    await seed("accounts", "im-acc", { name: "ImplCo", csm: "Plain User" });
    ok(await merge(sessions.user, "projects", "im-p", { accountId: "im-acc", stage: "handover", history: [] }), "CSM handover insert");
    assert((await valueOf("projects", "im-p"))?.stage === "handover", "handover project was not stored");
    errMatch(await merge(sessions.user, "projects", "im-p2", { accountId: "im-acc", stage: "planning" }),
      /must start in Handover or Queued/, "CSM inserted a project at Planning");
    ok(await merge(sessions.user, "projects", "im-p", { stage: "queued" }), "CSM handover -> queued (patch only)");
    errMatch(await merge(sessions.user, "projects", "im-p", { implementerId: impl.id }),
      /assign the implementer/, "CSM set implementerId");
    errMatch(await merge(impl.client, "projects", "im-p", { implementerId: impl.id }),
      /assign the implementer/, "impl_user assigned themselves");
    assert(!(await valueOf("projects", "im-p")).implementerId, "implementerId stored despite the errors");
    ok(await merge(lead.client, "projects", "im-p", { implementerId: impl.id }), "impl_lead assigns");
    errMatch(await merge(impl.client, "projects", "im-p", { stage: "planning" }),
      /start planning/, "implementer moved queued -> planning");
    ok(await merge(lead.client, "projects", "im-p", { stage: "planning" }), "impl_lead queued -> planning");
    ok(await merge(impl.client, "projects", "im-p", { stage: "in_progress" }), "implementer planning -> in_progress");
    errMatch(await merge(sessions.user, "projects", "im-p", { targetGoLive: "2027-01-01" }),
      /Only the implementer/, "CSM edited a project in progress");
    const v = await valueOf("projects", "im-p");
    assert(v.implementerId === impl.id && v.stage === "in_progress" && !v.targetGoLive, "stored project: " + JSON.stringify(v));
  } finally { await clean(); }
});

test("the implementer adds and edits tasks; another impl_user cannot", async () => {
  const other = await otherImpl();
  try {
    const impl = await world();
    ok(await merge(impl.client, "project_tasks", "im-t", { projectId: "im-p", accountId: "im-acc", title: "Setup",
      status: "todo", signoff: "pending", estHours: 4 }), "implementer adds a task");
    errMatch(await merge(other.client, "project_tasks", "im-t", { title: "Hijacked" }),
      /Only the implementer/, "other impl_user edited the task");
    errMatch(await merge(other.client, "project_tasks", "im-t2", { projectId: "im-p", accountId: "im-acc", title: "X" }),
      /Only the implementer/, "other impl_user added a task");
    errMatch(await merge(impl.client, "project_tasks", "im-t3", { projectId: "im-p", accountId: "elsewhere", title: "X" }),
      /account must match/, "task attached under a different account");
    ok(await merge(impl.client, "project_tasks", "im-t", { status: "done" }), "implementer edits own task (patch only)");
    const t = await valueOf("project_tasks", "im-t");
    assert(t.title === "Setup" && t.status === "done", "stored task: " + JSON.stringify(t));
  } finally { await clean(); }
});

test("the account CSM signs a task; the implementer cannot sign", async () => {
  try {
    const impl = await world("csm_review");
    await seed("project_tasks", "im-t", { projectId: "im-p", accountId: "im-acc", title: "A", status: "done", signoff: "pending" });
    errMatch(await merge(impl.client, "project_tasks", "im-t", { signoff: "signed", signedBy: "Impl User" }),
      /sign off a task/, "implementer signed their own task");
    assert((await valueOf("project_tasks", "im-t")).signoff === "pending", "signoff stored despite the error");
    ok(await merge(sessions.user, "project_tasks", "im-t", { signoff: "signed", signedBy: "Plain User", signedAt: "2026-10-26" }),
      "CSM signs");
    ok(await merge(sessions.user, "project_tasks", "im-t", { signoff: "returned", signoffNote: "redo", status: "todo" }),
      "CSM sends back (status rides with the verdict)");
    errMatch(await merge(sessions.user, "project_tasks", "im-t", { title: "renamed by CSM" }),
      /Only the implementer/, "CSM edited a non-signoff field");
  } finally { await clean(); }
});

test("a renamed CSM signs once the account follows the rename", async () => {
  const [u] = await sql(`select id from profiles where org_id = $1 and name = 'Plain User'`, [ORG_A]);
  try {
    await world("csm_review");
    await seed("project_tasks", "im-t", { projectId: "im-p", accountId: "im-acc", title: "A", status: "done", signoff: "pending" });
    await sql(`update profiles set name = 'New Name' where id = $1`, [u.id]);
    errMatch(await merge(sessions.user, "project_tasks", "im-t", { signoff: "signed" }),
      /sign off a task/, "stale name still signed (account still says Plain User)");
    await sql(`update accounts set data = data || '{"csm":"New Name"}' where org_id = $1 and id = 'im-acc'`, [ORG_A]);
    ok(await merge(sessions.user, "project_tasks", "im-t", { signoff: "signed" }), "renamed CSM signs");
  } finally { await sql(`update profiles set name = 'Plain User' where id = $1`, [u.id]); await clean(); }
});

test("go-live needs every task signed", async () => {
  try {
    await world("csm_review");
    await seed("project_tasks", "im-t1", { projectId: "im-p", accountId: "im-acc", title: "A", status: "done", signoff: "signed" });
    await seed("project_tasks", "im-t2", { projectId: "im-p", accountId: "im-acc", title: "B", status: "done", signoff: "pending" });
    errMatch(await merge(sessions.user, "projects", "im-p", { stage: "live" }), /signed off before/, "live with an unsigned task");
    assert((await valueOf("projects", "im-p")).stage === "csm_review", "stage moved despite the error");
    ok(await merge(sessions.user, "project_tasks", "im-t2", { signoff: "signed" }), "CSM signs the last task");
    ok(await merge(sessions.user, "projects", "im-p", { stage: "live" }), "CSM moves to live with all signed");
    assert((await valueOf("projects", "im-p")).stage === "live", "project not live");
  } finally { await clean(); }
});

test("restricted lead sees and edits only own-account projects", async () => {
  const l = await invitedFresh("impl-rl@test.local");
  await sql(`update profiles set role = 'lead', name = 'Impl RL' where id = $1`, [l.id]);
  try {
    await seed("accounts", "im-mine", { name: "Mine", leadId: l.id });
    await seed("accounts", "im-other", { name: "Other" });
    await seed("projects", "im-p-mine", { accountId: "im-mine", stage: "handover" });
    await seed("projects", "im-p-other", { accountId: "im-other", stage: "handover" });
    const seen = ((await l.client.from("projects").select("id")).data || []).map(r => r.id).filter(i => i.startsWith("im-")).sort();
    assert(JSON.stringify(seen) === '["im-p-mine"]', "lead projects: " + JSON.stringify(seen));
    const ctl = ((await sessions.user.from("projects").select("id")).data || []).map(r => r.id).filter(i => i.startsWith("im-"));
    assert(ctl.length === 2, "control: a CSM sees both projects: " + JSON.stringify(ctl));
    ok(await merge(l.client, "projects", "im-p-mine", { holdReason: "x" }), "lead edits own project (patch only)");
    const other = await merge(l.client, "projects", "im-p-other", { holdReason: "x" });
    assert(other.error && !(await valueOf("projects", "im-p-other")).holdReason, "lead edited another account's project");
  } finally { await clean(); }
});

test("only an implementation lead or admin deletes a project", async () => {
  const lead = await implLead();
  try {
    await world();
    await sessions.user.from("projects").delete().eq("id", "im-p");
    assert(await stillExists("projects", "im-p"), "CSM deleted a project");
    const { error } = await lead.client.from("projects").delete().eq("id", "im-p");
    assert(!error && !(await stillExists("projects", "im-p")), "control: impl_lead delete failed: " + error?.message);
  } finally { await clean(); }
});

test("invite_user accepts impl_lead and impl_user", async () => {
  try {
    for (const role of ["impl_lead", "impl_user"]) {
      const r = await sessions.admin.rpc("invite_user", { p_email: `inv-${role}@test.local`, p_role: role });
      ok(r, `invite as ${role}`);
    }
    errMatch(await sessions.admin.rpc("invite_user", { p_email: "inv-bad@test.local", p_role: "impl_boss" }),
      /role must be/, "control: an unknown role was accepted");
  } finally { await sql(`delete from invites where email like 'inv-%@test.local'`); }
});

test("the implementer deletes tasks on their own project; another impl_user cannot", async () => {
  const other = await otherImpl();
  try {
    const impl = await world();
    await seed("project_tasks", "im-t", { projectId: "im-p", accountId: "im-acc", title: "A", status: "todo", signoff: "pending" });
    await other.client.from("project_tasks").delete().eq("id", "im-t");   // a denied delete raises nothing
    assert(await stillExists("project_tasks", "im-t"), "another impl_user deleted the task");
    const { error } = await impl.client.from("project_tasks").delete().eq("id", "im-t");
    assert(!error && !(await stillExists("project_tasks", "im-t")), "control: implementer delete failed: " + error?.message);
  } finally { await clean(); }
});

test("only a lead moves a project out of Queued, even skipping ahead", async () => {
  const lead = await implLead();
  try {
    const impl = await world("queued");
    errMatch(await merge(sessions.user, "projects", "im-p", { stage: "in_progress" }), /start planning/, "CSM skipped queued -> in_progress");
    errMatch(await merge(impl.client, "projects", "im-p", { stage: "csm_review" }), /start planning/, "implementer skipped queued -> csm_review");
    assert((await valueOf("projects", "im-p")).stage === "queued", "stage moved despite the errors");
    ok(await merge(lead.client, "projects", "im-p", { stage: "in_progress" }), "impl_lead queued -> in_progress");
  } finally { await clean(); }
});

test("go-live only from CSM review", async () => {
  try {
    await world("in_progress");
    await seed("project_tasks", "im-t", { projectId: "im-p", accountId: "im-acc", title: "A", status: "done", signoff: "signed" });
    errMatch(await merge(sessions.admin, "projects", "im-p", { stage: "live" }), /only from CSM review/, "in_progress -> live skip");
    assert((await valueOf("projects", "im-p")).stage === "in_progress", "stage moved despite the error");
    await sql(`update projects set data = data || '{"stage":"csm_review"}' where org_id = $1 and id = 'im-p'`, [ORG_A]);
    ok(await merge(sessions.admin, "projects", "im-p", { stage: "live" }), "admin csm_review -> live");
  } finally { await clean(); }
});
