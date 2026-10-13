// Only absolute http(s) URLs may become an href. React 18 does not block `javascript:`
// hrefs, and stored links come from account JSON that any member can write, so a crafted
// document or attachment link would otherwise run script in a teammate's session.
// The URL parser strips the tabs/newlines browsers ignore ("java\nscript:").
export const safeUrl = u => {
  if (typeof u !== "string" || !u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? u : undefined;
  } catch { return undefined; }
};

// The storage path of an uploaded attachment, so it can be opened through a signed URL once
// the bucket is private. Newer items carry `path`; older ones only have the public URL, whose
// tail after /object/public/attachments/ is the path. Anything else (no upload) gives null.
const PUBLIC_ATTACHMENT = "/storage/v1/object/public/attachments/";
export const attachmentPath = at => {
  if (!at) return null;
  if (typeof at.path === "string" && at.path) return at.path;
  if (typeof at.url !== "string") return null;
  const i = at.url.indexOf(PUBLIC_ATTACHMENT);
  if (i < 0) return null;
  const rest = at.url.slice(i + PUBLIC_ATTACHMENT.length).split(/[?#]/)[0];
  try { return decodeURIComponent(rest) || null; } catch { return null; }
};
