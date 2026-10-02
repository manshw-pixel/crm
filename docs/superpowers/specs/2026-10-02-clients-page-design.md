# Clients page and client enable/disable — design

Date: 2026-10-02 · Status: approved in chat, awaiting spec review

## Goal

The platform admin manages client orgs from a dedicated **Clients** page instead of a card
inside Settings, and can **disable / enable** a client. Disabling is a full, reversible
lockout of that client's users; data is kept.

## Decisions (from the user)

- Disable = **full lockout**: every user of the client loses all access immediately, as if
  each were individually disabled. Re-enable restores everything.
- The platform admin **can still switch into** a disabled client.
- Existing behaviour (client list, Switch into, Create client) moves to the page unchanged.

## 1. Database (`supabase-setup.sql`, additive only)

- `alter table public.orgs add column if not exists disabled boolean not null default false;`
- `is_active()` becomes: the profile exists, is not disabled, has an org, **and** (the org is
  not disabled **or** the caller is the platform admin). Every RLS policy already calls
  `is_active()`, so this one change enforces the lockout on all tables.
- New `set_org_disabled(p_org_id uuid, p_disabled boolean)`, security definer:
  - raises `set_org_disabled: platform admin only` unless `is_platform_admin()`;
  - raises `set_org_disabled: no such org` for an unknown id;
  - raises `set_org_disabled: cannot disable your home org` when disabling the org
    `00000000-0000-0000-0000-000000000001` (the platform admin's home org). Re-enabling is
    always allowed.
- `list_orgs()` gains a `disabled boolean` output column. Return type changes, so it is
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

- New nav entry **Clients** (with an icon in `NAV_ICONS`), rendered only when
  `user.platform_admin`. It renders a `ClientsPage` built from the current `PlatformCard`
  contents.
- `PlatformCard` is removed from Settings (`crm.html:3462`).
- Each client row shows a **Disabled** badge when disabled and a Disable / Enable button.
  The home org has no Disable button. Disable opens a confirm: "Disable <name>? All N users
  lose access immediately. Their data is kept and re-enabling restores it." The confirm
  follows the existing user-disable pattern in `UsersCard`.
- Switch into stays available for disabled clients.
- After profile load, the app calls `my_org_disabled()`. If true (and the user is not the
  platform admin), it shows a lockout screen next to the existing `profile.disabled` one:
  "Your organisation's access is suspended." / "Contact your provider to restore it." with
  Sign out.
- Test hooks: `data-clients-page`, `data-org-toggle={id}`, `data-org-disabled={id}` badge;
  `data-platform-card` and `data-switch-org` are kept so existing tests still find them.

## 3. Testing

RLS suite (`tests/rls`), each negative assertion preceded by a positive one on the same
session, so the test cannot pass vacuously (see the anon-key vacuity lesson):

1. A client user reads its accounts → then the org is disabled → the same user reads
   nothing and writes fail on every org table.
2. The same user's user-callable definer RPCs refuse while disabled.
3. Re-enable → reads and writes work again.
4. The platform admin, switched into the disabled org, still reads its data.
5. An org admin calling `set_org_disabled` is refused; disabling the home org is refused.
6. `list_orgs()` reports `disabled` correctly.
7. Email/renewal senders skip a disabled org (where the suite can drive them).

E2E (browser):

- Platform admin sees **Clients** in the nav; an org admin does not.
- Settings no longer contains the platform card.
- Disable → confirm → badge appears; Enable → badge clears.
- A disabled client's user sees the "suspended" screen.

## Out of scope

Deleting clients, editing client names, per-client billing or plans, and a bulk toggle.
