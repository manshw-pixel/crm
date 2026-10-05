// Email touchpoint ingest against a REAL Postgres. Helpers are called by superuser SQL
// (they are revoked from every API role); ingest_touchpoint is called as `anon`, exactly
// the way the provider shim will call it.
import { test, assert } from "../health/framework.mjs";
import { sql, seedAccount, seedContact, ORG_A, ORG_B } from "./fixtures.mjs";

const one = async (q, params = []) => Object.values((await sql(q, params))[0])[0];

test("tp_addr reduces display-name and case variants to the bare address", async () => {
  assert(await one(`select tp_addr('"Plain User" <USER@TEST.LOCAL>')`) === "user@test.local",
    "display-name form was not reduced");
  assert(await one(`select tp_addr('  Jane@Acme.COM ')`) === "jane@acme.com", "case/whitespace not normalised");
  assert(await one(`select tp_addr('not an address')`) === null, "a string without @ produced an address");
  assert(await one(`select tp_domain('Bob <bob@Sub.Acme.com>')`) === "sub.acme.com", "tp_domain wrong");
});

test("tp_generic flags the blocklist and nothing else", async () => {
  assert(await one(`select tp_generic('gmail.com')`) === true, "gmail.com not generic");
  assert(await one(`select tp_generic('protonmail.com')`) === true, "protonmail.com not generic");
  assert(await one(`select tp_generic('prohance.ai')`) === false, "control: a company domain was flagged generic");
});

test("tp_body_addrs finds addresses but not bare domains or trailing punctuation", async () => {
  const got = await one(`select tp_body_addrs('Ping jane@acme.com. Also see prohance.ai and BOB@Acme.com')`);
  assert(JSON.stringify([...got].sort()) === JSON.stringify(["bob@acme.com", "jane@acme.com"]),
    `got ${JSON.stringify(got)}`);
  const none = await one(`select tp_body_addrs('just prohance.ai mentioned')`);
  assert(none.length === 0, `a bare domain produced ${JSON.stringify(none)}`);
});

test("tp_strip_quotes cuts at reply markers and keeps forwarded content", async () => {
  const gmail = await one(`select tp_strip_quotes($1)`,
    ["Thanks, sending the quote.\r\n\r\nOn Mon, 5 Oct 2026 at 09:00, Jane <jane@acme.com> wrote:\r\n> earlier text"]);
  assert(gmail === "Thanks, sending the quote.", `gmail style: ${JSON.stringify(gmail)}`);
  const outlook = await one(`select tp_strip_quotes($1)`, ["Top line\n-----Original Message-----\nFrom: x"]);
  assert(outlook === "Top line", `outlook style: ${JSON.stringify(outlook)}`);
  const angle = await one(`select tp_strip_quotes($1)`, ["Reply\n> quoted"]);
  assert(angle === "Reply", `> style: ${JSON.stringify(angle)}`);
  // Control: a forward's content IS the customer thread and must survive.
  const fwd = await one(`select tp_strip_quotes($1)`,
    ["FYI\n---------- Forwarded message ---------\nFrom: Jane <jane@acme.com>\nRenewal is fine"]);
  assert(/Renewal is fine/.test(fwd), `forwarded content was stripped: ${JSON.stringify(fwd)}`);
});

// ---------- matching ----------
const match = (org, addrs, exclude = ["test.local"]) =>
  one(`select tp_match($1, $2, $3)`, [org, addrs, exclude]);

test("tp_match finds the account by contact domain, scoped to the org", async () => {
  await seedAccount("tpm-a1", { name: "Match One", contractStatus: "Active" });
  await seedContact("tpm-c1", { name: "Jane", email: "jane@match-one.example", accountId: "tpm-a1" });
  await seedAccount("tpm-b1", { name: "B Only", contractStatus: "Active" }, ORG_B);
  await seedContact("tpm-cb1", { name: "Bea", email: "bea@b-only.example", accountId: "tpm-b1" }, ORG_B);

  const hit = await match(ORG_A, ["someone@match-one.example"]);
  assert(JSON.stringify(hit) === '["tpm-a1"]', `expected tpm-a1, got ${JSON.stringify(hit)}`);
  // Org isolation, with the same call shape as the control above.
  const cross = await match(ORG_A, ["bea@b-only.example"]);
  assert(cross.length === 0, `org A matched org B's account: ${JSON.stringify(cross)}`);
  const own = await match(ORG_B, ["bea@b-only.example"]);
  assert(JSON.stringify(own) === '["tpm-b1"]', `control: org B did not match its own account: ${JSON.stringify(own)}`);
});

test("tp_match ignores generic domains, excluded domains and churned accounts", async () => {
  await seedAccount("tpm-g1", { name: "Gmail Holder", contractStatus: "Active" });
  await seedContact("tpm-cg1", { name: "Gee", email: "gee@gmail.com", accountId: "tpm-g1" });
  assert((await match(ORG_A, ["other@gmail.com"])).length === 0, "a gmail contact claimed a gmail thread");

  await seedAccount("tpm-x1", { name: "Excluded", contractStatus: "Active" });
  await seedContact("tpm-cx1", { name: "Ex", email: "ex@excluded.example", accountId: "tpm-x1" });
  assert((await match(ORG_A, ["ex@excluded.example"], ["excluded.example"])).length === 0,
    "an excluded domain still matched");
  assert((await match(ORG_A, ["ex@excluded.example"], [])).length === 1, "control: the unexcluded domain did not match");

  await seedAccount("tpm-ch1", { name: "Gone", contractStatus: "Churned" });
  await seedContact("tpm-cch1", { name: "Old", email: "old@gone.example", accountId: "tpm-ch1" });
  assert((await match(ORG_A, ["old@gone.example"])).length === 0, "a churned account matched");
});

test("tp_match narrows a shared domain by exact address, else reports both", async () => {
  await seedAccount("tpm-p1", { name: "Acme Parent", contractStatus: "Active" });
  await seedAccount("tpm-p2", { name: "Acme EMEA", contractStatus: "Active" });
  await seedContact("tpm-cp1", { name: "Pat", email: "pat@acme-shared.example", accountId: "tpm-p1" });
  await seedContact("tpm-cp2", { name: "Emma", email: "emma@acme-shared.example", accountId: "tpm-p2" });

  const narrowed = await match(ORG_A, ["emma@acme-shared.example"]);
  assert(JSON.stringify(narrowed) === '["tpm-p2"]', `exact address did not narrow: ${JSON.stringify(narrowed)}`);
  const both = await match(ORG_A, ["newperson@acme-shared.example"]);
  assert(JSON.stringify(both) === '["tpm-p1","tpm-p2"]', `expected both, got ${JSON.stringify(both)}`);
});

test("tp_match tolerates messy stored contact emails but not subdomains", async () => {
  await seedAccount("tpm-m1", { name: "Messy", contractStatus: "Active" });
  await seedContact("tpm-cm1", { name: "Mo", email: "  Mo@Messy-Co.EXAMPLE ", accountId: "tpm-m1" });
  assert(JSON.stringify(await match(ORG_A, ["x@messy-co.example"])) === '["tpm-m1"]',
    "a contact email with case/whitespace did not match");
  // Pinned on purpose: exact domain only. The bounce tells the CSM to add the contact.
  assert((await match(ORG_A, ["x@mail.messy-co.example"])).length === 0, "a subdomain matched");
  await seedContact("tpm-cm2", { name: "No Mail", accountId: "tpm-m1" });   // contact with no email: harmless
  assert(JSON.stringify(await match(ORG_A, ["x@messy-co.example"])) === '["tpm-m1"]',
    "a contact without an email broke matching");
});
