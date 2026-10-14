// The only thing standing between the QA agent and real client data. Fail closed:
// anything other than an exact, loaded org name is a GuardError, which stops the run.
import { GuardError } from "./core.mjs";

// rows = result of select("name") on orgs as the signed-in user. RLS returns only the user's own
// org for non-platform users, so exactly one row is the only trustworthy answer; zero, several
// (a platform admin sees every org) or an error all fail closed.
export function orgNameFromRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const n = rows[0]?.name;
  return typeof n === "string" && n ? n : null;
}

export function assertQaOrg(actual, expected) {
  if (typeof expected !== "string" || !expected) throw new GuardError("org guard: no expected org name configured (QA_ORG_NAME). Run aborted before any change.");
  if (actual !== expected) throw new GuardError(`org guard: signed in to "${actual ?? "(not loaded)"}", expected "${expected}". Run aborted before any change.`);
}

export const parseLiveVersion = html => html.match(/const APP_VERSION = "([0-9a-f]{7,40})"/)?.[1] ?? null;

export const checkVersion = (live, master) => live && live === master
  ? { ok: true, message: `live build ${live} matches master` }
  : { ok: false, message: `live is ${live ?? "unknown"}, master is ${master}: wait for the Pages deploy to finish, then re-run` };
