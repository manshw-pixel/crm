/* ------------------------- attachments ------------------------- */
const MAX_FILE_MB = 10;
async function uploadFiles(fileList, accountId) {
  const out = [];
  // Storage policies only accept paths under the caller's org. Legacy un-prefixed links
  // stay readable, so existing documents are never rewritten.
  if (!CURRENT_ORG) throw new Error("No workspace: cannot upload");
  for (const f of Array.from(fileList || [])) {
    if (f.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${f.name} is over ${MAX_FILE_MB} MB`);
    const path = `${CURRENT_ORG}/${accountId}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await sb.storage.from("attachments").upload(path, f);
    if (error) throw new Error(`${f.name}: ${error.message}`);
    const { data } = sb.storage.from("attachments").getPublicUrl(path);
    out.push({ name: f.name, url: data.publicUrl, path });
  }
  return out;
}
// The attachments bucket is private: an upload's stored URL no longer opens on its own, so
// every click asks for a short-lived signed URL. The tab is opened synchronously (inside the
// click) and pointed at the signed URL afterwards, so popup blockers don't eat it.
async function openAttachment(at) {
  const path = attachmentPath(at);
  if (!path || !sb) { const u = safeUrl(at && at.url); if (u) window.open(u, "_blank", "noopener"); return; }
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("attachments").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    if (w) w.close();
    window.__toast?.({ text: `Could not open ${at.name || "file"}: ${error?.message || "no link returned"}`, tone: "error" });
    return;
  }
  if (w) { w.opener = null; w.location.href = data.signedUrl; } else window.open(data.signedUrl, "_blank", "noopener");
}
const attachmentClick = at => e => { e.preventDefault(); e.stopPropagation(); openAttachment(at); };
const AttachmentLinks = ({ items }) => !items || !items.length ? null : (
  <span className="flex flex-wrap gap-1.5">
    {items.map(at => (
      <a key={at.path || at.url} data-attachment href={safeUrl(at.url)} target="_blank" rel="noreferrer" onClick={attachmentClick(at)}
        className="nm-inset inline-flex items-center gap-1 !rounded-full px-2 py-0.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-800">📎 {at.name}</a>
    ))}
  </span>
);

/* ---------------------------- quick actions ---------------------------- */
const KeptAttachments = ({ kept, setKept }) => kept.length === 0 ? null : (
  <div className="flex flex-wrap items-center gap-1.5">
    {kept.map(at => (
      <span key={at.path || at.url} className="nm-inset inline-flex items-center gap-1 !rounded-full px-2 py-0.5 text-[11px] font-bold text-indigo-600">
        📎 {at.name}
        <button type="button" title="Remove attachment" aria-label="Remove attachment" className="text-rose-500 hover:text-rose-700"
          onClick={() => setKept(kept.filter(k => k !== at))}>✕</button>
      </span>
    ))}
  </div>
);

