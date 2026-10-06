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
const AttachmentLinks = ({ items }) => !items || !items.length ? null : (
  <span className="flex flex-wrap gap-1.5">
    {items.map(at => (
      <a key={at.path || at.url} href={at.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
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

