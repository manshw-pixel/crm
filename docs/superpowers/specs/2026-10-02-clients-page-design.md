# Super-admin client console and client enable/disable — design

Date: 2026-10-02 · Status: approved in chat, awaiting spec review

## Goal

The platform (super) admin signs in to a **client console**, not a CRM workspace. It
lists every client org, OneVio included, and is where the admin adds clients, enables or
disables them, and opens one to work inside it. The "Platform · clients" card leaves
Settings. Disabling is a full, reversible lockout of that client's users; data is kept.

## Decisions (from the user)

- On sign-in the super admin lands on the console (option A). They see no CRM until they
  open a client.
- OneVio is a row like any other and **can be disabled**, behind a stronger warning.
- Disable = **full lockout**: every user of the client loses all access immediately, as if
  each were individually disabled. Re-enable restores everything.
- The super admin can still open (switch into) a disabled client.
- Create client keeps its current behaviour; only its location changes.

## 1. Database (`supabase-setup.sql`, additive only)

- `alter table public.orgs add column if not exists disabled boolean not null default false;`
- `is_active()` becomes: the profile exists, is not disabled, has an org, **and** (the org is
  not disabled **or** the caller is the platform admin). Every RLS policy already calls
  `is_active()`, so this one change enforces the lockout on all tables. The super admin's
  own access never depends on any org's flag, so disabling OneVio cannot lock them out.
- New `set_org_disabled(p_org_id uuid, p_disabled boolean)`, security definer:
  - raises `set_org_disabled: platform admin only` unless `is_platform_admin()`;
  - raises `set_org_disabled: no such org` for an unknown id;
  - any org may be disabled, OneVio included.
- `list_orgs()` gains a `disabled boolean` output column. The return type changes, so it is
  `drop function if exists` + recreate.
- New `my_org_disabled()` returning boolean, security definer, so the app can tell a
  locked-out user why they see nothing (they cannot read `orgs` themselves).

### Definer audit (required)

Definer functions bypass RLS. Every `security definer` function in `supabase-setup.sql`,
`email-alerts.sql` and `renewal-alerts.sql` is reviewed. Anything callable by an org user,
or doing work on an org's behalf, must refuse or skip a disabled org, normally by calling
`is_active()`. Specifically:

- user-callable RPCs (e.g. `invite_user`, `admin_user_list`): refuse when not `is_active()`;
- scheduled senders (email alerts, renewal alerts): skip rows whose org is disabled, so a
  disabled client's users get no email;
- `handle_new_user`: a sign-up matching an invite into a disabled org is still attached
  (so it works on re-enable), but `is_active()` gates its access.

The plan lists each function and its verdict.

## 2. UI (`crm.html`)

### Console vs. workspace

- After profile load, when `profile.platform_admin` is true, the app renders a
  `ClientConsole` screen **instead of** the CRM shell, unless the admin has opened a client
  in this browser session.
- "Opened a client" is a `sessionStorage` flag (`onevio.inClient`), set right before the
  existing `switch_org` + reload. Every access is wrapped in try/catch. When storage is
  unavailable the admin simply lands on the console again, which is safe.
- Inside a client, the sidebar's amber current-org banner gains a **← Clients** link. It
  clears the flag and returns to the console without a reload.
- Signing out clears the flag, so every sign-in starts at the console.
- `PlatformCard` is removed from Settings (`crm.html:3462`). Its logic moves into
  `ClientConsole`.

### Console layout

- Header "OneVio Platform" with the admin's name and Sign out.
- A **Clients** table: name, users, created date, status badge (Enabled / Disabled), and
  actions **Open** and **Disable** / **Enable**. OneVio is listed like the others.
- **+ New client** reveals the existing create form (client name, admin name, admin email,
  temporary password), with the same messages as today.
- Disable confirm: "Disable <name>? All N users lose access immediately. Their data is kept
  and re-enabling restores it." For OneVio the confirm adds: "This is your own company's
  workspace — OneVio's CSMs and admins will be locked out too. Your super-admin login is not
  affected." It follows the existing user-disable confirm pattern in `UsersCard`.
- **Open** works for disabled clients too.

### Locked-out user

- After profile load, a user who is not the platform admin and for whom `my_org_disabled()`
  is true sees a lockout screen next to the existing `profile.disabled` one: "Your
  organisation's access is suspended." / "Contact your provider to restore it." with Sign
  out.

### Test hooks

`data-client-console`, `data-org-row={id}`, `data-org-toggle={id}`, `data-org-disabled={id}`
(badge), `data-open-org={id}`, `data-back-to-clients`. Existing tests that use
`data-platform-card` / `data-switch-org` are updated to the new hooks.

## 3. Testing

RLS suite (`tests/rls`). Each negative assertion is preceded by a positive one on the same
session, so the test cannot pass vacuously (see the anon-key vacuity lesson):

1. A client user reads its accounts → the org is disabled → the same user reads nothing
   and writes fail on every org table.
2. The same user's user-callable definer RPCs refuse while disabled.
3. Re-enable → reads and writes work again.
4. The platform admin, switched into a disabled org, still reads its data. With OneVio
   disabled, the platform admin still works.
5. An org admin calling `set_org_disabled` is refused.
6. `list_orgs()` reports `disabled` correctly.
7. Email/renewal senders skip a disabled org (where the suite can drive them).

E2E (browser):

- The platform admin lands on the console after sign-in; an org admin lands on the CRM.
- Open → CRM for that client → ← Clients → console; reload inside a client stays inside it.
- Settings no longer contains the platform card.
- Disable → confirm → badge appears; Enable → badge clears; the OneVio confirm shows the
  extra warning.
- A disabled client's user sees the "suspended" screen.

## Out of scope

Deleting clients, renaming clients, per-client billing or plans, a bulk toggle, and a
separate URL or domain for the console.
