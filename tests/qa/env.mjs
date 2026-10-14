// Loads the QA agent's credentials. These are real logins for the live site, so this
// module is the only place that reads them and nothing downstream may log them.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_PATH = fileURLToPath(new URL("../../.env.qa", import.meta.url));

const REQUIRED_ROLES = ["admin", "csm", "lead"];
const key = (r, f) => `QA_${r.toUpperCase()}_${f}`;
const KEYS = ["QA_BASE_URL", "QA_ORG_NAME", ...REQUIRED_ROLES.flatMap(r => [key(r, "EMAIL"), key(r, "PASS")])];

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function validateEnv(e) {
  const missing = KEYS.filter(k => !e[k]);
  // AM is optional, but half a login is a mistake worth naming.
  const amEmail = e.QA_AM_EMAIL, amPass = e.QA_AM_PASS;
  if (amEmail && !amPass) missing.push("QA_AM_PASS");
  if (amPass && !amEmail) missing.push("QA_AM_EMAIL");
  if (missing.length) throw new Error(`.env.qa is missing ${missing.join(", ")} -- see .env.qa.example`);
  const users = Object.fromEntries(REQUIRED_ROLES.map(r => [r, { email: e[key(r, "EMAIL")], pass: e[key(r, "PASS")] }]));
  users.am = amEmail && amPass ? { email: amEmail, pass: amPass } : null;
  return { baseUrl: e.QA_BASE_URL, orgName: e.QA_ORG_NAME, users };
}

export function loadQaEnv(path = DEFAULT_PATH) {
  if (!existsSync(path)) throw new Error(`${path} not found -- copy .env.qa.example and fill in the QA logins`);
  return validateEnv(parseEnv(readFileSync(path, "utf8")));
}
