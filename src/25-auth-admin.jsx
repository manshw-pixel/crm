/* --------------------------------- Auth (Supabase) --------------------------------- */
function SetupScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="nm w-full max-w-lg p-8">
        <h1 className="text-xl font-bold tracking-tight">One<span className="text-indigo-600">Vio</span> <span className="text-sm font-normal text-slate-500">team edition — not configured yet</span></h1>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-800">
          <li>Create a free project at <b>supabase.com</b> (pick a region near your team).</li>
          <li>Open its <b>SQL Editor</b>, paste the contents of <code>supabase-setup.sql</code>, and click Run.</li>
          <li>In <b>Project Settings → API</b>, copy the <b>Project URL</b> and <b>anon public</b> key.</li>
          <li>Open <code>src/00-core-config.jsx</code> in a text editor and paste both into the <code>TEAM CONFIG</code> block near the top.</li>
          <li>Reload this page — you'll see the sign-up screen. The first person to sign up becomes admin.</li>
        </ol>
        <p className="mt-4 text-xs text-slate-500">Full instructions: <code>TEAM-SETUP.md</code> in the repository.</p>
        <Copyright />
      </div>
    </div>
  );
}
function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | reset — self-signup disabled; admins add users in Settings
  const [email, setEmail] = useState(""); const [pass, setPass] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      if (mode === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() });
        if (error) throw error;
        setMsg("Password-reset email sent (check spam too).");
        setMode("signin");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      }
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="nm w-full max-w-sm p-8">
        <h1 className="text-xl font-bold tracking-tight">One<span className="text-indigo-600">Vio</span></h1>
        <p className="mb-4 mt-1 text-xs text-slate-700">
          {mode === "reset" ? "We'll email you a password-reset link." : "Sign in with your team account."}
        </p>
        <label className="mb-2 block text-xs font-semibold text-slate-700">Email
          <Input type="email" required value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} className="mt-1" autoFocus /></label>
        {mode !== "reset" && <label className="mb-2 block text-xs font-semibold text-slate-700">Password
          <Input type="password" required minLength={6} value={pass} onChange={e => { setPass(e.target.value); setErr(""); }} className="mt-1" /></label>}
        {err && <div className="mb-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{err}</div>}
        {msg && <div className="mb-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{msg}</div>}
        <button type="submit" disabled={busy} className="grad mt-3 w-full py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "…" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
        <div className="mt-3 flex justify-between text-xs text-indigo-600">
          {mode === "signin"
            ? <button type="button" className="hover:underline" onClick={() => { setMode("reset"); setErr(""); setMsg(""); }}>Forgot password?</button>
            : <button type="button" className="hover:underline" onClick={() => { setMode("signin"); setErr(""); setMsg(""); }}>Back to sign in</button>}
        </div>
        <p className="mt-3 text-[11px] leading-4 text-slate-500">Accounts are created by your administrator (Settings → Users). Ask them for access if you don't have a login yet.</p>
        <Copyright />
      </form>
    </div>
  );
}
function NewPasswordScreen({ onDone }) {
  const [pass, setPass] = useState(""); const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr("");
    if (pass !== confirm) return setErr("The two passwords do not match.");
    setBusy(true);
    try {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      onDone();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="nm w-full max-w-sm p-8">
        <h1 className="text-xl font-bold tracking-tight">One<span className="text-indigo-600">Vio</span></h1>
        <p className="mb-4 mt-1 text-xs text-slate-700">Choose a new password for your account.</p>
        <label className="mb-2 block text-xs font-semibold text-slate-700">New password
          <Input type="password" required minLength={6} value={pass} onChange={e => { setPass(e.target.value); setErr(""); }} className="mt-1" autoFocus /></label>
        <label className="mb-2 block text-xs font-semibold text-slate-700">Confirm new password
          <Input type="password" required minLength={6} value={confirm} onChange={e => { setConfirm(e.target.value); setErr(""); }} className="mt-1" /></label>
        {err && <div className="mb-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{err}</div>}
        <button type="submit" disabled={busy} className="grad mt-3 w-full py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "…" : "Set password"}</button>
        {/* The recovery session is a real session -- someone who followed the link but did
            not mean to change anything must be able to leave without being stuck here. */}
        <div className="mt-3 text-xs text-indigo-600">
          <button type="button" className="hover:underline" onClick={onDone}>Skip for now</button>
        </div>
        <Copyright />
      </form>
    </div>
  );
}
// Creates a login without touching our own session: a throwaway client, so signing the new
// user up does NOT switch who is signed in here. Shared by every "add a user" surface.
async function signUpUser({ email, pass, name }) {
  const tmp = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await tmp.auth.signUp({ email: email.trim(), password: pass, options: { data: { name: name.trim() }, emailRedirectTo: authRedirect() } });
  if (error) throw error;
  // With email confirmation on, GoTrue answers an ALREADY-registered address with a fake
  // user and no error; the tell is an empty identities array. Report it, never "added".
  const status = data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0 ? "exists"
    : !data.session && data.user && !data.user.email_confirmed_at ? "pending" : "created";
  return { ...data, status };
}
// The admin-facing sentence for a signUpUser() status, shared by every "add a user" surface.
const signUpMessage = (name, role, status) =>
  status === "exists" ? `${name}'s email already has a login, so no new login was created. Ask them to sign in; if they still see "not attached to a workspace", tell your platform admin.`
  : status === "pending" ? `${name} added as ${role}. A confirmation email was sent: they must click its link before they can sign in with the temporary password.`
  : `${name} added as ${role}. Share the email + temporary password with them (they can change it via "Forgot password?").`;
function ClientConsole({ me, onEnter }) {
  const [orgs, setOrgs] = useState([]);
  const [v, setV] = useState({ name: "", adminName: "", email: "", pass: "" });
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmOrg, setConfirmOrg] = useState(null); // the org pending disable
  const load = () => sb.rpc("list_orgs").then(({ data, error }) => error ? setErr(error.message) : setOrgs(data || []));
  useEffect(() => { load(); }, []);
  const createClient = async e => {
    e.preventDefault(); setErr(""); setMsg("");
    if (!v.name.trim() || !v.adminName.trim() || !v.email.trim()) return setErr("Client name, admin name and admin email are required.");
    if (v.pass.length < 6) return setErr("Temporary password must be at least 6 characters.");
    setBusy(true);
    try {
      // create_org refuses a duplicate name, an address with an open invite and a login in
      // another workspace; its message goes to the user as-is. It attaches an org-less login.
      const { error } = await sb.rpc("create_org", { p_name: v.name.trim(), p_admin_email: v.email.trim() });
      if (error) throw error;
      // Otherwise it left an admin invite, which handle_new_user applies to this sign-up.
      // 'exists' can then only mean the org-less login create_org already attached.
      const { status } = await signUpUser({ email: v.email, pass: v.pass, name: v.adminName });
      setMsg(`${v.name.trim()} created. ` + (status === "exists"
        ? `Existing login added to it as admin: ${v.adminName.trim()} signs in with their current password.`
        : signUpMessage(v.adminName.trim(), "admin", status)));
      setV({ name: "", adminName: "", email: "", pass: "" });
    } catch (ex) { setErr(ex.message); }
    load();
    setBusy(false);
  };
  const open = async o => {
    setErr(""); setMsg("");
    // Already in this org: no switch, no reload -- just enter.
    if (o.id === me.org_id) { inClientSet(true); return onEnter(); }
    inClientSet(true);
    // A thrown rejection (network down, fetch aborted) must clear the flag just like a
    // returned error, or the next reload drops the admin into a client they never entered.
    let error;
    try { ({ error } = await sb.rpc("switch_org", { p_org_id: o.id })); } catch (ex) { error = ex; }
    if (error) { inClientSet(false); return setErr(error.message); }
    // window.__reload is a test seam: the health suite counts the reload instead of taking it.
    (window.__reload || (() => location.reload()))();
  };
  const applyDisabled = async (o, disabled) => {
    setErr(""); setMsg("");
    const { error } = await sb.rpc("set_org_disabled", { p_org_id: o.id, p_disabled: disabled });
    if (error) setErr(error.message);
    else { setMsg(`${o.name} ${disabled ? "disabled — its users have lost access" : "re-enabled"}.`); load(); }
  };
  return (
    <div data-client-console className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">OneVio Platform</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{me.name}</span>
            <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={signOut}>Sign out</button>
          </div>
        </div>
        <Card title={`Clients (${orgs.length})`}>
          {orgs.map(o => (
            <div key={o.id} data-org-row={o.id} className="flex items-center gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
              <span className="flex-1">
                <div className="font-medium">{o.name}</div>
                <div className="text-xs text-slate-500">{o.users} user{o.users === 1 ? "" : "s"} · since {String(o.created_at).slice(0, 10)}</div>
              </span>
              {o.disabled
                ? <span data-org-disabled={o.id} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700">Disabled</span>
                : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Enabled</span>}
              <button data-org-toggle={o.id} className="text-xs font-bold text-slate-600 hover:underline"
                onClick={() => o.disabled ? applyDisabled(o, false) : setConfirmOrg(o)}>{o.disabled ? "Enable" : "Disable"}</button>
              <button data-open-org={o.id} className="text-xs font-bold text-indigo-600 hover:underline" onClick={() => open(o)}>Open</button>
            </div>
          ))}
          <div className="mt-3">
            {!showNew && <Btn data-new-client onClick={() => setShowNew(true)}>+ New client</Btn>}
            {showNew && <form onSubmit={createClient} className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Client name" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} />
              <Input placeholder="Admin name" value={v.adminName} onChange={e => setV({ ...v, adminName: e.target.value })} />
              <Input type="email" placeholder="Admin email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} />
              <Input type="password" placeholder="Temporary password" value={v.pass} onChange={e => setV({ ...v, pass: e.target.value })} />
              <div className="sm:col-span-2"><Btn kind="primary" type="submit" disabled={busy}>{busy ? "…" : "Create client"}</Btn></div>
            </form>}
          </div>
          {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}
          {msg && <div className="mt-2 text-xs text-emerald-700">{msg}</div>}
          <p className="mt-2 text-xs text-slate-500">Each client is a separate workspace: its users see only its accounts. Open a client to work as its admin; use ← Clients to come back.</p>
        </Card>
      </div>
      {confirmOrg && <ConfirmDialog
        title={`Disable ${confirmOrg.name}?`}
        body={`All ${confirmOrg.users} users lose access immediately. Their data is kept and re-enabling restores it.`
          + (confirmOrg.id === HOME_ORG ? " This is your own company's workspace — OneVio's CSMs and admins will be locked out too. Your super-admin login is not affected." : "")}
        confirmLabel="Disable"
        onConfirm={async () => { await applyDisabled(confirmOrg, true); setConfirmOrg(null); }}
        onClose={() => setConfirmOrg(null)} />}
    </div>
  );
}
function UsersCard({ me }) {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ name: "", email: "", pass: "", role: "user" });
  const load = () => sb.rpc("admin_user_list").then(({ data, error }) =>
    error ? setErr(error.message) : setUsers(data || []));
  useEffect(() => { load(); }, []);
  const setRole = async (u, role) => {
    setErr(""); setMsg("");
    const { error } = await sb.from("profiles").update({ role }).eq("id", u.id);
    if (error) setErr(error.message); else load();
  };
  const [confirmDisable, setConfirmDisable] = useState(null); // the user pending disable
  const applyDisabled = async (u, disabled) => {
    setErr(""); setMsg("");
    const { error } = await sb.from("profiles").update({ disabled }).eq("id", u.id);
    if (error) setErr(error.message);
    else { setMsg(`${u.name} ${disabled ? "disabled — their access is revoked" : "re-enabled"}.`); load(); }
  };
  const [editing, setEditing] = useState(null); // {id, name, email}
  const renameEverywhere = async (oldName, newName) => {
    // keep account CSM assignments and task owners in sync with the new name
    for (const [t, key] of [["accounts", "csm"], ["tasks", "owner"]]) {
      const { data } = await sb.from(t).select("id,data");
      for (const row of data || []) {
        if (row.data && row.data[key] === oldName) {
          row.data[key] = newName;
          const { error } = await sb.from(t).upsert({ id: row.id, data: row.data });
          if (error) throw error;
        }
      }
    }
  };
  const saveRename = async u => {
    const newName = editing.name.trim();
    setErr(""); setMsg("");
    if (!newName) return setErr("Name cannot be empty.");
    if (!editing.email.trim()) return setErr("Email cannot be empty.");
    if (newName === u.name && editing.email.trim().toLowerCase() === (u.email || "").toLowerCase()) return setEditing(null);
    if (users.some(x => x.id !== u.id && x.name === newName)) return setErr("That name is already taken.");
    setBusy(true);
    const nameChanged = newName !== u.name;
    const emailChanged = editing.email.trim().toLowerCase() !== (u.email || "").toLowerCase();
    try {
      if (nameChanged) {
        const { error } = await sb.from("profiles").update({ name: newName }).eq("id", u.id);
        if (error) throw error;
        await renameEverywhere(u.name, newName);
      }
      try {
        if (emailChanged) {
          const { error } = await sb.rpc("admin_set_user_email",
            { p_id: u.id, p_email: editing.email.trim() });
          if (error) throw error;
        }
      } catch (emailEx) {
        // Name already went through (if it changed) -- don't leave the user thinking
        // nothing happened. Reload so the list reflects the applied rename, close the
        // editor, and say plainly which half failed.
        if (nameChanged) {
          setErr(`Renamed ${u.name} → ${newName}, but the email update failed: ${emailEx.message}`);
          setEditing(null); load();
        } else {
          setErr(emailEx.message);
        }
        setBusy(false);
        return;
      }
      setMsg(`Updated ${u.name}${nameChanged ? ` → ${newName}; their accounts and tasks were updated too` : ""}.`);
      setEditing(null); load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  const addUser = async e => {
    e.preventDefault(); setErr(""); setMsg("");
    if (!v.name.trim() || !v.email.trim()) return setErr("Name and email are required.");
    if (v.pass.length < 6) return setErr("Temporary password must be at least 6 characters.");
    setBusy(true);
    try {
      // The invite is what attaches the sign-up to THIS org (handle_new_user matches it
      // by email). Sign-up without it would create an org-less user who sees nothing.
      // The invite also carries the role, so no follow-up role update is needed.
      const { data: invited, error: invErr } = await sb.rpc("invite_user", { p_email: v.email.trim(), p_role: v.role });
      if (invErr) throw invErr;
      // 'attached': the address already had a login with no workspace, and invite_user put
      // it straight into this one. Signing up again would only hit "already registered".
      if (invited === "attached") setMsg("Existing login added to this workspace.");
      else {
        const { status } = await signUpUser({ email: v.email, pass: v.pass, name: v.name });
        setMsg(signUpMessage(v.name.trim(), v.role, status));
      }
      setV({ name: "", email: "", pass: "", role: "user" });
      load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  return (
    <Card title={`Users (${users.length})`}>
      {users.map(u => (
        <div key={u.id} className={`flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0 ${u.disabled ? "opacity-60" : ""}`}>
          {editing && editing.id === u.id ? (
            <span className="flex flex-1 flex-wrap items-center gap-2">
              <Input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveRename(u); } if (e.key === "Escape") setEditing(null); }} className="w-44 !py-0.5" />
              <Input type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveRename(u); } if (e.key === "Escape") setEditing(null); }} className="w-52 !py-0.5" />
              <button className="text-xs font-bold text-indigo-600 hover:underline" onClick={() => saveRename(u)}>{busy ? "…" : "save"}</button>
              <button className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(null)}>cancel</button>
            </span>
          ) : (
            <span className="flex-1">
              <div>{u.name}{u.id === me.id && <span className="text-xs text-slate-500"> (you)</span>}
                {u.disabled && <span data-user-disabled-badge className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-600">disabled</span>}
                <button title="Edit user" aria-label="Edit user" className="ml-2 text-xs text-indigo-500 hover:text-indigo-700" onClick={() => { setErr(""); setMsg(""); setEditing({ id: u.id, name: u.name, email: u.email || "" }); }}>✎</button>
              </div>
              <div className="text-xs text-slate-500">{u.email}</div>
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${u.role === "admin" ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-700"}`}>{u.role}</span>
          {u.id !== me.id && (u.role === "user"
            ? <button className="text-xs text-indigo-600 hover:underline" onClick={() => setRole(u, "admin")}>make admin</button>
            : <button className="text-xs text-rose-500 hover:underline" onClick={() => setRole(u, "user")}>demote</button>)}
          {u.id !== me.id && (u.disabled
            ? <button data-user-enable-btn className="text-xs text-emerald-600 hover:underline" onClick={() => applyDisabled(u, false)}>enable</button>
            : <button data-user-disable-btn className="text-xs text-rose-500 hover:underline" onClick={() => setConfirmDisable(u)}>disable</button>)}
        </div>
      ))}
      <form onSubmit={addUser} className="mt-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Name" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} className="w-32" />
        <Input placeholder="Email" type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} className="w-52" />
        <Input placeholder="Temp password" type="text" value={v.pass} onChange={e => setV({ ...v, pass: e.target.value })} className="w-36" />
        <Select value={v.role} onChange={e => setV({ ...v, role: e.target.value })} options={["user", "admin"]} />
        <Btn kind="primary" type="submit">{busy ? "Adding…" : "Add user"}</Btn>
      </form>
      {err && <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{err}</div>}
      {msg && <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{msg}</div>}
      <p className="mt-2 text-xs text-slate-500">Adding a user sends an invite into this workspace and creates their login; a sign-up without an invite is not attached to any workspace. At least one admin always remains (enforced by the database). Disabling a user removes their access immediately; re-enable them any time. To remove someone entirely: Supabase dashboard → Authentication → Users.</p>
      {confirmDisable && <ConfirmDialog
        title={`Disable ${confirmDisable.name}?`}
        body="They lose access to every account, task and file immediately — even if they are signed in right now — except any file link they already hold, which keeps working. You can re-enable them at any time."
        confirmLabel="Disable"
        onConfirm={async () => { await applyDisabled(confirmDisable, true); setConfirmDisable(null); }}
        onClose={() => setConfirmDisable(null)} />}
    </Card>
  );
}
const LEVEL_STYLE = {
  crash: "bg-rose-50 text-rose-700",
  write_failed: "bg-amber-50 text-amber-700",
  load_failed: "bg-amber-50 text-amber-700",
  retry: "bg-slate-100 text-slate-600",
};
function ErrorLogCard() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    sb.from("error_log").select("*").order("last_seen", { ascending: false }).limit(50)
      .then(({ data, error }) => error ? setErr(error.message) : setRows(data || []));
  }, []);
  return (
    <Card title="Error log">
      <div data-errorlog>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        {!err && !rows.length && <p className="text-xs text-slate-500">No errors recorded. Nothing has failed in the last 30 days.</p>}
        {rows.map(r => (
          <div key={r.fingerprint} data-errorlog-row className="nm-inset mb-2 p-2">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${LEVEL_STYLE[r.level] || "bg-slate-100 text-slate-700"}`}>{r.level}</span>
              <span className="flex-1 truncate text-xs text-slate-700">{r.message}</span>
              <span className="text-[11px] font-mono text-slate-500">×{r.count}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span>{new Date(r.last_seen).toLocaleString()}</span>
              {r.context && r.context.view && <span>· {r.context.view}</span>}
              {r.context && r.context.table && <span>· {r.context.table}</span>}
              {r.stack && <button className="ml-auto underline" onClick={() => setOpen(open === r.fingerprint ? null : r.fingerprint)}>
                {open === r.fingerprint ? "hide" : "stack"}</button>}
            </div>
            {open === r.fingerprint && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-500">{r.stack}</pre>}
          </div>
        ))}
      </div>
    </Card>
  );
}
