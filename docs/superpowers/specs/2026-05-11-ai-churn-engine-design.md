# AI Churn Prediction Engine Design Spec
**Date:** 2026-05-11

---

## 1. Overview

A three-tier AI churn prediction engine that runs inside the existing FastAPI backend. Tier 1 (rule engine) runs synchronously on every account save. Tier 2 (ML model) is dormant until an admin uploads historical churn data. Tier 3 (Claude narrative) runs synchronously when triggered. All three tiers write their output to a single `HealthScoreLog` row per run.

**Primary users:**
- **CSMs** — see churn score, risk tier, and Claude narrative on the account health panel
- **Admins** — configure signal weights, upload training CSV, view model info

---

## 2. Architecture

### Module Structure

```
backend/app/ai/
├── __init__.py
├── churn_engine.py       # Orchestrator — only public interface for callers
├── rule_engine.py        # Tier 1: synchronous rule-based scoring
├── ml_model.py           # Tier 2: GradientBoostingClassifier load/predict/train
└── claude_narrator.py    # Tier 3: Claude API call, prompt caching, PII masking

backend/app/models/
└── scoring_config.py     # ScoringConfig table for admin-adjustable signal weights

backend/app/services/
└── scoring_service.py    # recalculate_health(account_id, db, force_narrative=False)

backend/app/api/
├── ai.py                 # POST /ai/narrative/{id}, POST /ai/train, GET /ai/model-info
└── scoring.py            # POST /scoring/recalculate/{id}, GET/PATCH /scoring/config

backend/ml_models/        # Versioned .joblib artifacts + model_meta.json (gitignored)
```

### Data Flow

```
CSM updates account
    → account_service.update_account()
        → scoring_service.recalculate_health(account_id, db)
            → churn_engine.run(account_id, db)
                → rule_engine.calculate(signals, weights) → rule_score
                → ml_model.predict(features) → ml_probability (if trained)
                → combine scores → final_score, churn_risk_tier
                → if |new_score - prev_score| > 10 or force:
                    → claude_narrator.generate(context) → ai_narrative
                → write HealthScoreLog row
                → update Account.health_score + Account.churn_risk_tier
```

---

## 3. New Data Model

### ScoringConfig

```
id                  int PK autoincrement
signal_name         str(100) unique — one of: days_since_activity, days_to_renewal,
                    open_high_priority_tasks, latest_nps, ticket_trend, csm_sentiment
weight              float — must sum to 1.0 across all signals
created_by          FK users.id nullable
updated_at          DateTime(timezone=True)
```

Default weights (used as fallback if table is empty):

| signal_name | weight |
|---|---|
| days_since_activity | 0.20 |
| days_to_renewal | 0.15 |
| open_high_priority_tasks | 0.15 |
| latest_nps | 0.20 |
| ticket_trend | 0.15 |
| csm_sentiment | 0.15 |

---

## 4. Tier 1 — Rule Engine (`rule_engine.py`)

Pure function — no DB access, no side effects. Receives a `SignalValues` dataclass and a weights dict, returns a `RuleResult` dataclass.

### Signal Scoring Logic

| Signal | Input | Score mapping |
|---|---|---|
| days_since_activity | int (days) | >30 → 0, 15–30 → 50, 7–15 → 75, <7 → 100 |
| days_to_renewal | int (days) | <30 → 20, 30–90 → 50, 90–180 → 70, >180 → 90 |
| open_high_priority_tasks | int (count) | 0 → 100, 1 → 70, 2 → 40, ≥3 → 20 |
| latest_nps | int (0–10) or None | 0–6 → 20, 7–8 → 60, 9–10 → 100, None → 50 |
| ticket_trend | int (1–5) manual | 1→20, 2→40, 3→60, 4→80, 5→100 |
| csm_sentiment | int (1–5) manual | 1→20, 2→40, 3→60, 4→80, 5→100 |

```
rule_score = sum(signal_score[s] × weight[s] for s in signals)  → float 0–100
```

### Risk Tier Mapping

| Score range | Tier |
|---|---|
| 70–100 | green |
| 40–69 | yellow |
| 0–39 | red |

### SignalValues dataclass (inputs to rule engine)

```python
@dataclass
class SignalValues:
    days_since_activity: int
    days_to_renewal: int
    open_high_priority_tasks: int
    latest_nps: int | None
    ticket_trend: int       # 1–5 manual entry on Account
    csm_sentiment: int      # 1–5 manual entry on Account

@dataclass
class RuleResult:
    rule_score: float
    signal_scores: dict[str, float]   # per-signal breakdown for display
    churn_risk_tier: str
```

### Account Model additions

Two new fields added to the `Account` model and migration:

```
ticket_trend    int nullable (1–5)   # manual CSM entry
csm_sentiment   int nullable (1–5)   # manual CSM entry
```

---

## 5. Tier 2 — ML Model (`ml_model.py`)

### State

- Starts dormant. `model_loaded: bool = False` at startup.
- On startup, scans `backend/ml_models/` for latest `model_v{N}.joblib`. Loads if found.
- `model_meta.json` stores: `{"version": N, "accuracy": float, "feature_importances": dict, "trained_at": ISO8601, "n_training_samples": int}`

### Training Input CSV

```
account_id, churned, days_since_activity, days_to_renewal, open_high_priority_tasks,
latest_nps, ticket_trend, csm_sentiment, account_age_days, tier_encoded,
arr_band_encoded, avg_score_30d, avg_score_60d, avg_score_90d
```

- `churned`: 0 or 1
- `tier_encoded`: smb=0, mid_market=1, enterprise=2
- `arr_band_encoded`: <50k=0, 50k–200k=1, >200k=2
- `avg_score_30d/60d/90d`: average `HealthScoreLog.score` over each window (0–100)

### Training Process (`train(csv_path)`)

1. Load CSV with pandas, validate required columns present
2. Encode categorical features, drop `account_id`
3. Train/test split (80/20)
4. Fit `GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=42)`
5. Compute accuracy on test split
6. Save artifact: `ml_models/model_v{N+1}.joblib` (joblib.dump)
7. Write `ml_models/model_meta.json`
8. Reload in-memory model

### Prediction (`predict(features: dict) -> MLResult | None`)

Returns `None` if model not loaded (caller falls back to rule score only).

```python
@dataclass
class MLResult:
    ml_probability: float           # 0.0–1.0
    top_features: list[str]         # top 3 by feature importance × feature value
```

### Score Combination (in `churn_engine.py`)

```python
if ml_result:
    final_score = rule_score * 0.4 + ml_result.ml_probability * 100 * 0.6
else:
    final_score = rule_score
```

---

## 6. Tier 3 — Claude Narrative (`claude_narrator.py`)

### Trigger Conditions

- Score delta > 10 points vs. previous `HealthScoreLog.score` for this account
- `force=True` passed by on-demand `POST /ai/narrative/{account_id}`

### PII Handling — What Gets Sent to Claude

**Sent:**
- Account tier (smb/mid-market/enterprise) — NOT account name
- ARR band (`<$50k` / `$50k–$200k` / `>$200k`) — NOT exact ARR
- Days to renewal
- Rule score breakdown (each signal's score and weight)
- ML probability + top 3 features (if trained)
- Open task count + high-priority task count
- Last 3 NPS/CSAT scores (numeric only, no free-text)
- Last 5 CSM notes (text, with emails and phone numbers masked)
- Playbook trigger count in last 30 days

**Not sent:** account name, exact ARR, contact names, free-text survey responses

### PII Masking (applied to note text before sending)

```python
import re

def mask_pii(text: str) -> str:
    text = re.sub(r'\S+@\S+\.\S+', '[EMAIL]', text)
    text = re.sub(r'[\+\d][\d\s\-\(\)\.]{6,}\d', '[PHONE]', text)
    return text
```

### Prompt Structure

```
[SYSTEM — cached with cache_control: ephemeral]
You are a Customer Success analyst. Given account health signals, write a churn risk
assessment. Respond in exactly this format:

ASSESSMENT: <3–5 sentences on churn risk level and key drivers>
ACTIONS:
1. <specific next action for the CSM>
2. <specific next action for the CSM>
3. <specific next action for the CSM>

Be specific. Reference the signals provided. Do not mention the customer by name.

[USER — not cached]
Account context:
Tier: {tier}
ARR Band: {arr_band}
Days to renewal: {days_to_renewal}
...
[all signals, scores, notes, surveys]
```

### Claude API Call

- Model: `claude-sonnet-4-6`
- Max tokens: 400
- Prompt caching: `cache_control: {"type": "ephemeral"}` on system message
- Timeout: 30 seconds
- On failure: log warning, return `None` (caller writes `HealthScoreLog` with `ai_narrative=None`)

### Output Parsing

Raw response text stored directly in `HealthScoreLog.ai_narrative`. No structured parsing — the enforced format is human-readable and sufficient for v1 display.

---

## 7. API Endpoints

### Scoring

```
POST /scoring/recalculate/{account_id}
    Auth: csm, admin
    Body: {"force_narrative": bool}  (default false)
    Response: HealthScoreOut (score, tier, rule_score, ml_probability, ai_narrative)

GET  /scoring/config
    Auth: admin
    Response: list of {signal_name, weight}

PATCH /scoring/config/{signal_name}
    Auth: admin
    Body: {"weight": float}
    Validation: after update, all weights must sum to 1.0 ± 0.01
    Response: updated config list
```

### AI

```
POST /ai/narrative/{account_id}
    Auth: csm, admin
    Response: {"ai_narrative": str, "generated_at": datetime}

POST /ai/train
    Auth: admin
    Body: multipart/form-data, file field "training_data"
    Response: {"version": int, "accuracy": float, "n_samples": int, "trained_at": datetime}

GET  /ai/model-info
    Auth: csm, admin
    Response: {"version": int | null, "accuracy": float | null, "trained_at": datetime | null,
               "top_features": list[str], "model_loaded": bool}
```

### Updated Account endpoint

`GET /accounts/{id}/health` — stub replaced with real data:
```json
{
  "account_id": int,
  "health_score": int,
  "churn_risk_tier": str,
  "rule_score": float,
  "signal_scores": {signal_name: float},
  "ml_probability": float | null,
  "ml_top_features": list[str] | null,
  "ai_narrative": str | null,
  "trend_90d": [{"date": str, "score": int}]
}
```

---

## 8. Error Handling

| Failure | Behavior |
|---|---|
| Rule engine | Never fails (pure math). Signals missing → use None defaults per signal |
| ML model not loaded | Returns None from predict(); falls back to rule_score only |
| ML training CSV invalid | Raise ValueError with column list; return 422 from API |
| Claude API timeout/error | Log warning, ai_narrative=None; HealthScoreLog still written |
| Score recalculation DB error | Roll back transaction; propagate 500 to caller |
| Weight update makes sum ≠ 1.0 | Return 422, do not write to DB |

---

## 9. Testing

| File | Scope | Notes |
|---|---|---|
| `tests/test_rule_engine.py` | Unit, no DB | Test each signal boundary, composite score, risk tier mapping, missing signal defaults |
| `tests/test_ml_model.py` | Unit, no DB | Synthetic 20-row CSV: train, assert loads, predict returns 0.0–1.0, MLResult has top_features |
| `tests/test_claude_narrator.py` | Unit, mock Anthropic client | Assert PII masking (email → [EMAIL], phone → [PHONE]), correct context assembly, None returned on API error |
| `tests/test_churn_engine.py` | Integration, crm_test DB | Create account, run engine, assert HealthScoreLog row written with correct fields |
| `tests/test_scoring_api.py` | HTTP integration, crm_test DB | recalculate endpoint, weight config get/patch (sum validation), model-info when untrained |

---

## 10. Out of Scope (v1)

- ARQ/Redis background jobs (Claude call is synchronous)
- Scheduled nightly health sweep (no ARQ yet)
- Weekly ML retraining job (only triggered by admin CSV upload)
- Support ticket system integration (ticket_trend is manual entry)
- Model A/B testing or multi-model support
