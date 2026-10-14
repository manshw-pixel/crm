// The only thing standing between the QA agent and real client data. Fail closed:
// anything other than an exact, loaded org name is a GuardError, which stops the run.
import { GuardError } from "./core.mjs";

export function parseOrgName(text) {
  const i = text.lastIndexOf("· ");
  if (i < 0) return null;
  const name = text.slice(i + 2).trim();
  return !name || name === "…" ? null : name;
}

export function assertQaOrg(actual, expected) {
  if (actual !== expected) throw new GuardError(`org guard: signed in to "${actual ?? "(not loaded)"}", expected "${expected}". Run aborted before any change.`);
}

export const parseLiveVersion = html => html.match(/const APP_VERSION = "([0-9a-f]{7,40})"/)?.[1] ?? null;

export const checkVersion = (live, master) => live === master
  ? { ok: true, message: `live build ${live} matches master` }
  : { ok: false, message: `live is ${live ?? "unknown"}, master is ${master}: wait for the Pages deploy to finish, then re-run` };
