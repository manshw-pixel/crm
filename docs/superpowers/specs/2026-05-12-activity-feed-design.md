# Activity Feed — Slice 2 Design Spec

**Date:** 2026-05-12
**Status:** Approved

## Overview

Add an Activity tab to the AccountDetail page. CSMs can view a full chronological log of all account activity (manual and system-generated) and log new notes, meetings, and emails inline.

## Backend

### New routes (added to `backend/app/api/accounts.py` or a new `activities.py` router)

```
GET  /accounts/{id}/activities?page=1&page_size=20
POST /accounts/{id}/activities
```

**GET response:**
```json
{ "items": [...], "total": 100, "page": 1, "page_size": 20 }
```

**POST body:**
```json
{
  "type": "note | meeting | email",
  "title": "string",
  "content": "string (optional)",
  "metadata_": {
    "date": "2026-05-12 (meeting only)",
    "attendees": ["Alice", "Bob"] (meeting only)
  }
}
```

**ActivityOut schema fields:** `id`, `account_id`, `type`, `title`, `content`, `metadata_`, `created_by`, `created_at`.

### Data storage

All manual activities write a single `Activity` row. The `MeetingNote` table is not used for manual entries — meeting metadata (date, attendees) lives in `Activity.metadata_` (JSONB). This avoids dual-write complexity while keeping the full meeting context accessible.

System-generated activity types (`task_completed`, `score_change`, `playbook_triggered`, `survey`) are written by existing backend services; no new write paths needed.

### Auth

Uses existing `get_current_user` dependency. `created_by` is set to the authenticated user's ID on POST.

## Frontend

### New files

- `src/api/activities.ts` — `getActivities(accountId, page)` and `createActivity(accountId, payload)`
- `src/hooks/useActivities.ts` — `useActivities(accountId, page)` (useQuery) and `useCreateActivity(accountId)` (useMutation)
- Types added to `src/types/api.ts`: `ActivityType`, `ActivityOut`, `ActivityCreate`, `ActivityListResponse`

### AccountDetailPage changes

- Add `'activity'` to the `Tab` union type
- Add Activity tab button (5th tab, after Contacts)
- Render `<ActivityTab accountId={accountId} />` when active

### ActivityTab component (in AccountDetailPage.tsx)

**Feed:** Paginated list, newest-first, 20 per page.

Each row displays:
- Color-coded icon by type: note=blue, meeting=purple, email=green, task_completed=gray, score_change=amber, survey=teal, playbook_triggered=gray
- Title
- Content preview (2-line clamp)
- Relative timestamp ("3 days ago")
- Author name when `created_by` is present
- Meeting rows: attendees from `metadata_.attendees`
- Score change rows: old→new score from `metadata_`

**Log Activity form:** Inline at top of feed (not a modal). "Log Activity" button toggles it open. Type selector (Note / Meeting / Email) controls which fields render:

| Type | Fields |
|------|--------|
| Note | title, content textarea |
| Meeting | title, date, attendees (comma-separated), content textarea |
| Email | title, content textarea |

On submit: invalidate query, reset to page 1, close form.

**Pagination:** Prev / Next buttons, "Page X of Y" label.

**Empty state:** "No activity yet. Log the first note." when `total === 0`.

## Error handling

- Load error: `<ErrorMessage>` with retry (consistent with Tasks/Contacts tabs)
- Submit error: inline red message below form; form stays open to preserve input
- Pagination + new entry: reset to page 1 after successful submit

## Out of scope (Slice 2)

- Editing or deleting activity entries
- Filtering the feed by activity type
- Full `MeetingNote` structured fields (agenda, decisions, next steps)
- Email sending integration (log only, not send)
- Activity feed on Dashboard or Account List
