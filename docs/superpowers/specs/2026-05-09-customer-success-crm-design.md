# Customer Success & Account Management CRM with AI Churn Prediction
**Design Spec** | Date: 2026-05-09

---

## 1. Overview

An internal Customer Success CRM built for our own CS team, with a collaborative external customer portal. The platform combines account management, playbook automation, QBR/success plan tooling, and a three-tier AI churn prediction engine that uses rule-based scoring, an ML model trained on historical data, and Claude AI for qualitative narrative reasoning.

**Primary users:**
- **Customer Success Managers (CSMs)** — primary power users; manage accounts, health scores, tasks, playbooks, success plans
- **Account Executives (AEs)** — view account health, track expansion opportunities, hand off to CSMs post-sale
- **Admins** — manage users, configure playbook rules, retrain ML model, view org-wide dashboards
- **Customers** — access the external portal to co-edit success plans, assign action items, submit surveys, view health summaries

---

## 2. Architecture

### Approach
Modular monorepo with a shared FastAPI backend and two separate React frontends (internal CRM app + customer portal). The AI churn engine runs as a module within the backend, callable via internal service functions and exposed via API endpoints.

### Stack
| Layer | Technology | Reason |
|---|---|---|
| Backend API | FastAPI (Python) | Python-native for ML integration; async support; clean OpenAPI docs |
| Database | PostgreSQL | Relational data fits account/contact/task model; JSONB for flexible fields |
| Cache / Queue | Redis + ARQ (async job queue) | Background churn recalculation, playbook triggers, notifications |
| ML Engine | Scikit-learn (GradientBoostingClassifier) | Proven for tabular churn prediction; fast retraining on small datasets |
| AI Narrative | Claude API (claude-sonnet-4-6) | Qualitative churn reasoning from CSM notes + score signals |
| Internal Frontend | React + Tailwind CSS + Shadcn/ui | Component library consistency; CSM-focused dashboard |
| Customer Portal | React + Tailwind CSS + Shadcn/ui | Separate app, same design system, portal-scoped API access |
| Auth | JWT (role-based: admin / csm / ae / customer) | Simple, stateless, portal-safe |
| Deployment | Docker Compose (v1) | Single VPS; easy to migrate to cloud later |

### Monorepo Structure
```
/
├── backend/
│   ├── app/
│   │   ├── api/           # Route handlers grouped by domain
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # Business logic (account, health, playbook, ai)
│   │   ├── ai/            # Churn engine: rules, ml_model, claude_narrator
│   │   ├── jobs/          # ARQ background jobs
│   │   └── core/          # Config, auth, db session, middleware
│   ├── migrations/        # Alembic migrations
│   ├── tests/
│   └── Dockerfile
├── frontend-internal/     # CSM / AE / Admin app
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── api/           # Typed API client
│   └── Dockerfile
├── frontend-portal/       # Customer-facing portal
│   ├── src/
│   └── Dockerfile
├── docker-compose.yml
└── docs/
```

### Data Flow
```
CSM enters / updates account data
    → Rule engine recalculates score instantly (sync)
    → If score changes > 10 points: enqueue background job
        → ML model reruns prediction
        → Claude AI generates new narrative
        → Playbook engine checks triggers
            → Creates tasks / sends alerts as needed
    → Customer sees updated portal view (filtered, read-safe)
```

---

## 3. Data Model

### Account
```
id, name, tier (SMB/mid-market/enterprise), arr, mrr,
contract_start, renewal_date, csm_id (FK User), ae_id (FK User),
health_score (0–100), churn_risk_tier (green/yellow/red),
industry, employee_count, notes, created_at, updated_at
```

### Contact
```
id, account_id, name, email, title, role (champion/economic_buyer/influencer/detractor/end_user),
influence_rating (1–5), last_engaged_at, is_primary, created_at
```

### HealthScoreLog
```
id, account_id, score (0–100), rule_score, ml_score, ml_confidence,
ai_narrative (text), triggered_by (manual/auto/job), created_at
```
*Indexed on account_id + created_at for efficient 90-day trend queries.*

### Activity
```
id, account_id, type (note/meeting/task_completed/email/playbook_triggered/score_change/survey),
title, content (text), metadata (JSONB), created_by (FK User), created_at
```

### Task
```
id, account_id, title, description, priority (low/medium/high/urgent),
due_date, owner_id (FK User), status (open/in_progress/completed/cancelled),
source (manual/playbook), playbook_run_id, created_at, updated_at
```

### MeetingNote
```
id, account_id, title, meeting_date, attendees (JSONB),
agenda, decisions, action_items (JSONB), next_steps,
created_by, created_at
```

### SuccessPlan
```
id, account_id, title, status (draft/active/completed),
visible_to_customer (bool), created_by, updated_at
```

### Milestone
```
id, success_plan_id, title, description, owner_id (FK User),
customer_assignee_name, due_date, status (not_started/in_progress/completed/blocked),
sort_order, created_at, updated_at
```

### MilestoneComment
```
id, milestone_id, content, authored_by_user_id, authored_by_contact_id,
created_at
```
*Either user or contact is set, not both — supports internal + customer comments.*

### PlaybookTemplate
```
id, name, description, trigger_type (score_drop/no_activity/renewal_approaching/nps_below/manual),
trigger_threshold (numeric), trigger_window_days,
actions (JSONB array of {type, params}), is_active, created_by, created_at
```

### PlaybookRun
```
id, account_id, playbook_template_id, triggered_at, triggered_by,
status (running/completed/failed), actions_taken (JSONB), completed_at
```

### Opportunity
```
id, account_id, type (upsell/expansion/renewal/cross_sell),
stage (identified/qualified/proposed/negotiating/closed_won/closed_lost),
value, probability (0–100), owner_id, expected_close_date,
notes, created_at, updated_at
```

### Survey
```
id, account_id, type (NPS/CSAT/custom), score,
response_text, submitted_by_contact_id, submitted_at
```

### User
```
id, name, email, role (admin/csm/ae/customer),
account_id (null for internal users; set for customer portal users),
hashed_password, is_active, last_login, created_at
```

---

## 4. AI Churn Prediction Engine

### Three-Tier Architecture

**Tier 1 — Rule Engine (real-time)**
Runs synchronously on every account data save. Configurable signal weights (admin-adjustable):

| Signal | Default Weight | Scoring Logic |
|---|---|---|
| Days since last CSM activity | 20% | >30 days = 0, <7 days = 100 |
| Days to renewal | 15% | <30 days = 20, >180 days = 90 |
| Open high-priority tasks | 15% | 0 tasks = 100, 3+ tasks = 20 |
| NPS score (latest) | 20% | 0–6 = 20, 7–8 = 60, 9–10 = 100 |
| Support ticket trend | 15% | Rising 30d trend = 20, flat/falling = 80 |
| CSM sentiment rating | 15% | 1–5 scale entered manually by CSM |

Composite score = weighted sum → 0–100 → mapped to Green (70–100) / Yellow (40–69) / Red (0–39).

**Tier 2 — ML Model (nightly + on-demand)**
- Algorithm: GradientBoostingClassifier (scikit-learn)
- Features: all rule signals + account age, tier, ARR, historical score trend (30/60/90 day avg), playbook trigger count, portal engagement
- Training: Admin uploads historical churn CSV (account_id, churned: bool, feature snapshot). Model trains on upload + scheduled weekly retraining.
- Output: churn probability (0.0–1.0) + top 3 contributing features
- Model artifacts stored in `/backend/ml_models/` with versioning

**Tier 3 — Claude AI Narrative (on-demand + on significant score change)**
- Triggered when: score changes >10 points, CSM requests fresh analysis, or nightly job runs
- Input context sent to Claude: account name/tier/ARR, current rule score breakdown, ML probability + top features, last 5 CSM notes, last 3 survey responses, open tasks count, days to renewal, recent playbook triggers
- Output: 3–5 sentence plain-English churn risk assessment + 3 specific recommended next actions
- Stored in HealthScoreLog.ai_narrative; displayed in account health panel
- Claude model: `claude-sonnet-4-6` with prompt caching on static system prompt

### Churn Score Combination
```
final_score = (rule_score × 0.4) + (ml_score × 100 × 0.6)
```
*ML gets higher weight once trained. Before first training upload, rule score = 100% weight.*

---

## 5. API Design

### Auth
```
POST /auth/login              → {access_token, role, user_id}
POST /auth/refresh            → {access_token}
POST /auth/logout
```

### Accounts
```
GET    /accounts              → paginated list, filter: csm_id, risk_tier, renewal_window
POST   /accounts              → create account
GET    /accounts/{id}         → full account detail
PATCH  /accounts/{id}         → update fields
GET    /accounts/{id}/health  → score breakdown, ML output, AI narrative, 90-day trend
GET    /accounts/{id}/timeline → paginated activity feed
POST   /accounts/{id}/notes   → log note/meeting/activity
```

### Contacts
```
GET    /accounts/{id}/contacts
POST   /accounts/{id}/contacts
PATCH  /contacts/{id}
DELETE /contacts/{id}
```

### Tasks
```
GET    /tasks                 → filter: owner, account, status, due_date
POST   /tasks
PATCH  /tasks/{id}
DELETE /tasks/{id}
```

### Success Plans
```
GET    /accounts/{id}/success-plans
POST   /accounts/{id}/success-plans
GET    /success-plans/{id}
PATCH  /success-plans/{id}
POST   /success-plans/{id}/milestones
PATCH  /milestones/{id}
POST   /milestones/{id}/comments
```

### Playbooks
```
GET    /playbooks             → list templates
POST   /playbooks             → create template (admin)
PATCH  /playbooks/{id}        → update template
POST   /playbooks/{id}/trigger → manual trigger on account
GET    /accounts/{id}/playbook-runs → run history
```

### Opportunities
```
GET    /accounts/{id}/opportunities
POST   /accounts/{id}/opportunities
PATCH  /opportunities/{id}
```

### AI & Scoring
```
POST   /ai/narrative/{account_id}   → on-demand Claude AI analysis
POST   /ai/train                    → upload CSV, trigger ML retraining (admin)
GET    /ai/model-info               → current model version, accuracy, last trained
POST   /scoring/recalculate/{account_id} → force full score recalculation
```

### Dashboards
```
GET    /dashboard/csm               → my accounts: health dist, tasks, at-risk, renewals
GET    /dashboard/manager           → team heatmap, NRR trend, churn forecast
GET    /dashboard/churn-report      → all accounts ranked by risk score + AI summaries
```

### Surveys
```
POST   /surveys                     → log NPS/CSAT
GET    /accounts/{id}/surveys       → survey history
```

### Customer Portal (portal-scoped JWT)
```
GET    /portal/me                   → customer's account summary + health score
GET    /portal/success-plan         → their active success plan
PATCH  /portal/milestones/{id}      → update milestone status/assignee
POST   /portal/milestones/{id}/comments → add comment
GET    /portal/tasks                → tasks visible to customer
POST   /portal/requests             → submit a new request
POST   /portal/surveys              → submit NPS/CSAT
```

---

## 6. Frontend — Internal CRM

### Pages & Views
| Page | Key Components |
|---|---|
| Dashboard | Health distribution donut, at-risk account list, tasks due today, renewal calendar, churn trend sparklines |
| Account List | Filterable table: name, tier, ARR, CSM, health score badge, renewal date, last activity |
| Account Detail | Tabs: Overview / Health / Timeline / Tasks / Contacts / Success Plan / Opportunities / Playbooks |
| Health Tab | Score gauge, rule breakdown sliders, ML confidence bar, Claude AI narrative card, 90-day trend chart |
| Timeline Tab | Chronological activity feed with type filters |
| Success Plan | Milestone kanban / list view, co-edit indicator, PDF export |
| QBR Builder | Template form auto-populated from account data, editable sections, PDF export |
| Playbooks | Template library, run history per account, manual trigger button |
| Manager Dashboard | Team table, churn heatmap, NRR waterfall chart, playbook adoption stats |
| Churn Report | Ranked account list with risk scores, AI narrative previews, bulk export |
| Settings (Admin) | User management, rule weight configurator, playbook templates, ML model management |

---

## 7. Frontend — Customer Portal

### Pages & Views
| Page | Key Components |
|---|---|
| Home | Health score summary card, open milestones count, upcoming tasks, CSM contact info |
| Success Plan | Milestone list with status toggles, assignee field, comment threads |
| Roadmap | Shared roadmap items added by CSM |
| Requests | Submit new request form, view status of past requests |
| Surveys | Active NPS/CSAT survey prompt |
| Meetings | Embedded calendar link to schedule with CSM |

---

## 8. Background Jobs (ARQ / Redis)

| Job | Trigger | Action |
|---|---|---|
| `recalculate_health` | Score change >10 pts or manual | Runs ML model + Claude narrative |
| `nightly_health_sweep` | Cron: 2am daily | Recalculates all accounts; flags stale ones |
| `playbook_evaluator` | After every health recalculation | Checks trigger conditions; fires actions |
| `renewal_reminder` | Cron: daily | Creates tasks for accounts renewing in 30/60/90 days |
| `ml_retraining` | Weekly or on admin upload | Retrains GradientBoostingClassifier, saves versioned artifact |
| `notification_dispatcher` | Event-driven | Sends email alerts for at-risk escalations, task due reminders |

---

## 9. Security & Access Control

| Role | Access |
|---|---|
| Admin | Full access: all accounts, all users, settings, ML training, playbook templates |
| CSM | Own assigned accounts + read access to all accounts; cannot access settings |
| AE | Read access to accounts they own; can create opportunities; no health score edit |
| Customer | Portal only: own account data, success plan, milestones, surveys; no internal data |

- All API routes validate JWT + role scope
- Customer JWT includes `account_id` claim; all portal routes filter by this claim server-side
- Passwords: bcrypt hashed
- Claude AI calls: account data is sent to Claude API — no PII beyond company name, scores, and CSM notes (no customer personal data)
- HTTPS enforced in production

---

## 10. Out of Scope (v1)

- Email/calendar sync (manual logging only at launch)
- Native mobile app
- Real-time collaborative editing (portal edits are saved on submit, not live)
- Multi-tenant / white-label support
- Billing / payment integration
- Slack / Teams notifications (email only at launch)
- In-app chat between CSM and customer

---

## 11. Success Criteria

- CSM can log an account note and see an updated churn score + Claude narrative within 60 seconds
- ML model retrains on historical CSV upload without manual intervention
- Customer portal loads a success plan and allows milestone updates without seeing internal CRM data
- Playbook auto-creates a task within 5 minutes of a score threshold breach
- Churn report ranks all accounts by risk score and can be exported to CSV
