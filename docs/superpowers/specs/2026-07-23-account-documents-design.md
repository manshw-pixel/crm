# Account Documents — Design Spec

**Date:** 2026-07-23
**File:** `crm.html` (single-file React + Supabase, deploys to GitHub Pages on master push)
**Rule:** All changes strictly additive — existing features preserved.

## Goal

Give each account a place to upload and organize business documents, categorized as
**Purchase Order**, **Contract Agreement**, or **Advisory**, with metadata (title, amount,
effective/expiry dates). Contract Agreements nearing or past their expiry are visually flagged.

## Context / reuse

The app already has attachment plumbing used by tasks and activities:
- `uploadFiles(fileList, accountId)` (crm.html ~L566) uploads to the Supabase `attachments`
  bucket (10 MB cap) and returns `{ name, url, path }`.
- `KeptAttachments` component for staged/removable files.
- Accounts already carry an `audit` array (ARR/renewal/CSM change history) surfaced in a
  "Change history" card, updated via `EDIT_ACCOUNT`.

This feature reuses all of the above. **No new Supabase infrastructure** (bucket already exists).

## Data model

New additive `documents` array on each account. Each document:

```
{
  id,            // uid()
  category,      // "Purchase Order" | "Contract Agreement" | "Advisory"
  title,         // optional free text
  name,          // original filename (from uploadFiles)
  url,           // public URL (from uploadFiles)
  path,          // storage path (from uploadFiles) — used for delete
  amount,        // optional number (e.g. PO value); null if blank
  effectiveDate, // optional ISO yyyy-mm-dd
  expiryDate,    // optional ISO yyyy-mm-dd
  uploadedBy,    // user?.name
  uploadedAt     // iso(Date.now())
}
```

Required to save: a file **and** a category. All other fields optional.

## Reducer (additive)

Two new action types, both persisting the account through the existing
`up("accounts", a)` Supabase path (same as other account mutations):

- `ADD_DOCUMENT { id: accountId, doc }` → append `doc` to `account.documents`; push an
  `audit` entry `{ field: "document", action: "added", detail: "<category>: <title|name>", by, at, source }`.
- `DELETE_DOCUMENT { id: accountId, docId }` → remove the document from `account.documents`;
  push an `audit` entry `{ field: "document", action: "removed", detail: "<category>: <title|name>", by, at, source }`.

Both mirror the shape of the existing `EDIT_ACCOUNT`/audit logic. Persistence effect must map
these two actions the same way `EDIT_ACCOUNT` maps (find account, `up("accounts", a)`).

### Storage deletion

`DELETE_DOCUMENT` handling in the UI (before/with dispatch) calls
`sb.storage.from("attachments").remove([path])` so the underlying file is hard-deleted — no
orphaned files. If the storage remove fails, surface the error and do not remove the record.

## UI

### Documents card (in `AccountDetail`)

A new `Card title="Documents (<n>)"` placed among the existing account cards. Contents grouped
under three sub-headings in fixed order: **Purchase Orders**, **Contract Agreements**,
**Advisories**. Empty groups render nothing; if there are zero documents total, show
"No documents yet."

Each document row shows:
- 📎 title (falls back to filename) as a download link (`href=url`, new tab)
- amount (formatted as currency) when present
- effective → expiry dates when present
- an **expiry badge** for Contract Agreements (see below)
- a ✕ delete button (confirm before deleting)

A **＋ Add document** button opens `DocumentForm` inline (same pattern as other account forms
via the `form` state in `AccountDetail`).

### Expiry flagging (Contract Agreements only)

Given `expiryDate`:
- past today → red **"Expired"** badge
- within **60 days** of today → amber **"Expires in Nd"** badge
- otherwise → no badge

Date comparison is string/textual on ISO `yyyy-mm-dd` (or via the app's existing `daysUntil`
helper) to avoid the UTC-vs-local pitfalls noted in prior work. Threshold `EXPIRY_WARN_DAYS = 60`
defined as a constant for easy tuning.

### DocumentForm

Fields:
- File input (single file; reuse `uploadFiles`)
- Category `Select` (the three categories)
- Title `Input` (optional)
- Amount `Input type=number` (optional)
- Effective date `Input type=date` (optional)
- Expiry date `Input type=date` (optional)
- Save / Cancel buttons; Save disabled while uploading; validates file + category present.

On save: `const [uploaded] = await uploadFiles(files, acct.id)`, build the `doc` object, dispatch
`ADD_DOCUMENT`, close form.

## Out of scope (YAGNI)

- Editing an existing document's metadata (delete + re-add instead).
- Multi-file-per-record (one file per document).
- Dashboard-level expiring-contracts rollup (only per-account badge for now).
- Versioning / history of a single document.

## Verification

Extend the existing Playwright E2E harness pattern (copy crm.html, in-memory Supabase mock incl.
`storage.from().upload/getPublicUrl/remove` stubs, `channel`/`removeChannel` stubs, seed via
`window.__seed`). Cases:
1. Add a document (each category) → appears under the correct group with metadata.
2. Contract with expiry <60d shows amber badge; past expiry shows red "Expired".
3. Delete a document → removed from list, `storage.remove` called with its path, audit entry added.
4. Existing task/activity attachments and all prior account features still render unchanged.
