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
