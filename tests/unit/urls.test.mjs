// safeUrl guards every user-data href. React 18 renders `javascript:` hrefs as-is, and
// account JSON is writable by any member through merge_row (and by JSON import), so a
// planted document link would run script in whichever teammate clicked it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeUrl } from "../../src/lib/urls.js";

test("safeUrl keeps http(s) links unchanged", () => {
  const u = "https://abc.supabase.co/storage/v1/object/public/attachments/o/a/f.pdf";
  assert.equal(safeUrl(u), u);
  assert.equal(safeUrl("http://example.com/x"), "http://example.com/x");
});

test("safeUrl blocks script-capable and non-web schemes", () => {
  for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd"])
    assert.equal(safeUrl(bad), undefined, bad);
});

test("safeUrl rejects non-strings and relative junk", () => {
  for (const bad of [undefined, null, 42, {}, "", "not a url", "//evil.com/x"])
    assert.equal(safeUrl(bad), undefined, String(bad));
});
