// Email touchpoint ingest against a REAL Postgres. Helpers are called by superuser SQL
// (they are revoked from every API role); ingest_touchpoint is called as `anon`, exactly
// the way the provider shim will call it.
import { test, assert } from "../health/framework.mjs";
import { sql } from "./fixtures.mjs";

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
