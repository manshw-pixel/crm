# AI Churn Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-tier AI churn prediction engine (rule-based scoring, ML model, Claude narrative) that runs inside the existing FastAPI backend and writes results to `HealthScoreLog`.

**Architecture:** A single `app/ai/` module with a clean orchestrator interface (`churn_engine.py`) that calls three isolated tiers in sequence. The orchestrator is called by `scoring_service.py` which is invoked from the account API on every save. All output is persisted in `HealthScoreLog` and reflected on `Account.health_score`.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, scikit-learn (GradientBoostingClassifier), joblib, Anthropic SDK (`anthropic`), pandas, pytest

---

## File Map

```
backend/app/ai/
├── __init__.py                          # empty
├── churn_engine.py                      # Orchestrator — public interface
├── rule_engine.py                       # Tier 1: pure scoring functions
├── ml_model.py                          # Tier 2: load/predict/train
└── claude_narrator.py                   # Tier 3: Claude API, PII masking

backend/app/models/
└── scoring_config.py                    # ScoringConfig ORM model

backend/app/schemas/
├── scoring.py                           # ScoringConfigOut, RecalculateResponse, HealthScoreOut
└── ai.py                                # TrainResponse, ModelInfoResponse, NarrativeResponse

backend/app/services/
└── scoring_service.py                   # recalculate_health()

backend/app/api/
├── scoring.py                           # POST /scoring/recalculate, GET/PATCH /scoring/config
└── ai.py                                # POST /ai/narrative, POST /ai/train, GET /ai/model-info

backend/tests/
├── test_rule_engine.py
├── test_ml_model.py
├── test_claude_narrator.py
├── test_churn_engine.py
└── test_scoring_api.py

backend/ml_models/                       # gitignored, holds .joblib + model_meta.json
```

**Existing files modified:**
- `backend/app/models/account.py` — add `ticket_trend` and `csm_sentiment` int fields
- `backend/app/models/__init__.py` — add ScoringConfig import
- `backend/app/schemas/account.py` — add `ticket_trend`, `csm_sentiment` to AccountCreate/AccountUpdate/AccountOut
- `backend/app/api/accounts.py` — replace health endpoint stub with real data
- `backend/app/services/account_service.py` — call scoring_service after update
- `backend/app/main.py` — register scoring and ai routers
- `backend/requirements.txt` — add scikit-learn, pandas, joblib, anthropic
- `backend/migrations/` — new migration for ScoringConfig table + Account columns

---

## Task 1: Dependencies + Account Model Additions + ScoringConfig Model

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/models/account.py`
- Create: `backend/app/models/scoring_config.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/ml_models/.gitkeep`
- Run: Alembic migration

- [ ] **Step 1: Add new dependencies to requirements.txt**

Append to `backend/requirements.txt`:
```
scikit-learn==1.4.2
pandas==2.2.2
joblib==1.4.0
anthropic==0.28.0
```

Install: `cd backend && pip install scikit-learn==1.4.2 pandas==2.2.2 joblib==1.4.0 anthropic==0.28.0`

- [ ] **Step 2: Add ticket_trend and csm_sentiment to Account model**

In `backend/app/models/account.py`, add these two fields to the `Account` class after `employee_count`:

```python
    ticket_trend: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1–5 manual entry
    csm_sentiment: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1–5 manual entry
```

- [ ] **Step 3: Create scoring_config.py**

```python
from datetime import datetime
from sqlalchemy import String, Float, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

SIGNAL_NAMES = [
    "days_since_activity",
    "days_to_renewal",
    "open_high_priority_tasks",
    "latest_nps",
    "ticket_trend",
    "csm_sentiment",
]

DEFAULT_WEIGHTS: dict[str, float] = {
    "days_since_activity": 0.20,
    "days_to_renewal": 0.15,
    "open_high_priority_tasks": 0.15,
    "latest_nps": 0.20,
    "ticket_trend": 0.15,
    "csm_sentiment": 0.15,
}

class ScoringConfig(Base):
    __tablename__ = "scoring_config"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    signal_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

Save to `backend/app/models/scoring_config.py`.

- [ ] **Step 4: Update models/__init__.py**

Add to `backend/app/models/__init__.py`:
```python
from app.models.scoring_config import ScoringConfig, DEFAULT_WEIGHTS, SIGNAL_NAMES
```

- [ ] **Step 5: Create ml_models directory**

Create `backend/ml_models/.gitkeep` (empty file so directory is tracked but not gitignored contents).

Add to `.gitignore`:
```
backend/ml_models/*.joblib
backend/ml_models/model_meta.json
```

- [ ] **Step 6: Generate and apply Alembic migration**

```bash
cd backend && alembic revision --autogenerate -m "add scoring_config table and account sentiment fields"
alembic upgrade head
```

Expected: new migration file under `migrations/versions/`, tables `scoring_config` created, columns `ticket_trend` and `csm_sentiment` added to `accounts`.

Verify:
```bash
python -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings
async def check():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.connect() as conn:
        result = await conn.execute(__import__('sqlalchemy').text('SELECT column_name FROM information_schema.columns WHERE table_name=\'accounts\' AND column_name IN (\'ticket_trend\', \'csm_sentiment\')'))
        print([r[0] for r in result])
asyncio.run(check())
"
```
Expected: `['ticket_trend', 'csm_sentiment']` (order may vary)

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/app/models/ backend/migrations/ backend/ml_models/.gitkeep .gitignore
git commit -m "feat: add ScoringConfig model, account sentiment fields, new dependencies"
```

---

## Task 2: Rule Engine

**Files:**
- Create: `backend/app/ai/__init__.py`
- Create: `backend/app/ai/rule_engine.py`
- Create: `backend/tests/test_rule_engine.py`

- [ ] **Step 1: Create app/ai/__init__.py**

Create empty file at `backend/app/ai/__init__.py`.

- [ ] **Step 2: Write failing tests**

Create `backend/tests/test_rule_engine.py`:

```python
import pytest
from app.ai.rule_engine import SignalValues, RuleResult, calculate, score_signal, derive_risk_tier

def make_signals(**kwargs):
    defaults = dict(
        days_since_activity=5,
        days_to_renewal=200,
        open_high_priority_tasks=0,
        latest_nps=9,
        ticket_trend=5,
        csm_sentiment=5,
    )
    defaults.update(kwargs)
    return SignalValues(**defaults)

def test_perfect_signals_score_100():
    signals = make_signals()
    result = calculate(signals, None)
    assert result.rule_score == pytest.approx(100.0, abs=1.0)
    assert result.churn_risk_tier == "green"

def test_all_bad_signals_score_low():
    signals = make_signals(
        days_since_activity=40,
        days_to_renewal=10,
        open_high_priority_tasks=3,
        latest_nps=3,
        ticket_trend=1,
        csm_sentiment=1,
    )
    result = calculate(signals, None)
    assert result.rule_score < 40
    assert result.churn_risk_tier == "red"

def test_missing_nps_uses_midpoint():
    signals = make_signals(latest_nps=None)
    result = calculate(signals, None)
    nps_score = result.signal_scores["latest_nps"]
    assert nps_score == 50.0

def test_risk_tier_boundaries():
    assert derive_risk_tier(70) == "green"
    assert derive_risk_tier(69) == "yellow"
    assert derive_risk_tier(40) == "yellow"
    assert derive_risk_tier(39) == "red"

def test_signal_scores_dict_has_all_keys():
    signals = make_signals()
    result = calculate(signals, None)
    expected_keys = {"days_since_activity", "days_to_renewal", "open_high_priority_tasks",
                     "latest_nps", "ticket_trend", "csm_sentiment"}
    assert set(result.signal_scores.keys()) == expected_keys

def test_custom_weights_applied():
    signals = make_signals(latest_nps=3, days_since_activity=5)
    # Give all weight to NPS — bad NPS should dominate
    weights = {
        "days_since_activity": 0.0,
        "days_to_renewal": 0.0,
        "open_high_priority_tasks": 0.0,
        "latest_nps": 1.0,
        "ticket_trend": 0.0,
        "csm_sentiment": 0.0,
    }
    result = calculate(signals, weights)
    assert result.rule_score == pytest.approx(20.0, abs=1.0)

def test_high_priority_tasks_scoring():
    assert score_signal("open_high_priority_tasks", 0) == 100
    assert score_signal("open_high_priority_tasks", 1) == 70
    assert score_signal("open_high_priority_tasks", 2) == 40
    assert score_signal("open_high_priority_tasks", 3) == 20
    assert score_signal("open_high_priority_tasks", 5) == 20
```

Run: `cd backend && pytest tests/test_rule_engine.py -v`
Expected: FAIL (ImportError — module not created yet)

- [ ] **Step 3: Implement rule_engine.py**

```python
from dataclasses import dataclass
from app.models.scoring_config import DEFAULT_WEIGHTS

@dataclass
class SignalValues:
    days_since_activity: int
    days_to_renewal: int
    open_high_priority_tasks: int
    latest_nps: int | None
    ticket_trend: int | None
    csm_sentiment: int | None

@dataclass
class RuleResult:
    rule_score: float
    signal_scores: dict[str, float]
    churn_risk_tier: str

def score_signal(signal_name: str, value) -> float:
    if signal_name == "days_since_activity":
        v = value or 0
        if v > 30: return 0.0
        if v > 15: return 50.0
        if v > 7: return 75.0
        return 100.0
    if signal_name == "days_to_renewal":
        v = value or 0
        if v < 30: return 20.0
        if v < 90: return 50.0
        if v < 180: return 70.0
        return 90.0
    if signal_name == "open_high_priority_tasks":
        v = value or 0
        if v == 0: return 100.0
        if v == 1: return 70.0
        if v == 2: return 40.0
        return 20.0
    if signal_name == "latest_nps":
        if value is None: return 50.0
        if value <= 6: return 20.0
        if value <= 8: return 60.0
        return 100.0
    if signal_name in ("ticket_trend", "csm_sentiment"):
        v = value or 3
        return {1: 20.0, 2: 40.0, 3: 60.0, 4: 80.0, 5: 100.0}.get(v, 60.0)
    return 50.0

def derive_risk_tier(score: float) -> str:
    if score >= 70: return "green"
    if score >= 40: return "yellow"
    return "red"

def calculate(signals: SignalValues, weights: dict[str, float] | None) -> RuleResult:
    w = weights if weights is not None else DEFAULT_WEIGHTS
    signal_scores = {
        name: score_signal(name, getattr(signals, name))
        for name in DEFAULT_WEIGHTS
    }
    rule_score = sum(signal_scores[name] * w.get(name, 0.0) for name in signal_scores)
    return RuleResult(
        rule_score=round(rule_score, 2),
        signal_scores=signal_scores,
        churn_risk_tier=derive_risk_tier(rule_score),
    )
```

Save to `backend/app/ai/rule_engine.py`.

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_rule_engine.py -v
```
Expected: 7 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai/ backend/tests/test_rule_engine.py
git commit -m "feat: add rule engine (Tier 1) with signal scoring and risk tier mapping"
```

---

## Task 3: ML Model

**Files:**
- Create: `backend/app/ai/ml_model.py`
- Create: `backend/tests/test_ml_model.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_ml_model.py`:

```python
import pytest
import os
import tempfile
import pandas as pd
from app.ai.ml_model import MLModel, MLResult

@pytest.fixture
def synthetic_csv(tmp_path):
    """20-row CSV with mix of churned/retained accounts."""
    rows = []
    for i in range(20):
        churned = 1 if i < 10 else 0
        rows.append({
            "account_id": i,
            "churned": churned,
            "days_since_activity": 40 if churned else 5,
            "days_to_renewal": 15 if churned else 200,
            "open_high_priority_tasks": 3 if churned else 0,
            "latest_nps": 3 if churned else 9,
            "ticket_trend": 1 if churned else 5,
            "csm_sentiment": 1 if churned else 5,
            "account_age_days": 365,
            "tier_encoded": 0,
            "arr_band_encoded": 1,
            "avg_score_30d": 30 if churned else 80,
            "avg_score_60d": 35 if churned else 78,
            "avg_score_90d": 40 if churned else 75,
        })
    p = tmp_path / "train.csv"
    pd.DataFrame(rows).to_csv(p, index=False)
    return str(p)

def test_model_starts_unloaded():
    model = MLModel(models_dir=tempfile.mkdtemp())
    assert model.model_loaded is False
    assert model.predict({}) is None

def test_train_and_predict(synthetic_csv, tmp_path):
    model = MLModel(models_dir=str(tmp_path))
    result = model.train(synthetic_csv)
    assert result["version"] == 1
    assert 0.0 <= result["accuracy"] <= 1.0
    assert result["n_samples"] == 20
    assert model.model_loaded is True

    features = {
        "days_since_activity": 40, "days_to_renewal": 15,
        "open_high_priority_tasks": 3, "latest_nps": 3,
        "ticket_trend": 1, "csm_sentiment": 1,
        "account_age_days": 365, "tier_encoded": 0,
        "arr_band_encoded": 1, "avg_score_30d": 30,
        "avg_score_60d": 35, "avg_score_90d": 40,
    }
    prediction = model.predict(features)
    assert prediction is not None
    assert isinstance(prediction, MLResult)
    assert 0.0 <= prediction.ml_probability <= 1.0
    assert len(prediction.top_features) <= 3

def test_train_increments_version(synthetic_csv, tmp_path):
    model = MLModel(models_dir=str(tmp_path))
    r1 = model.train(synthetic_csv)
    r2 = model.train(synthetic_csv)
    assert r2["version"] == 2

def test_train_invalid_csv_raises(tmp_path):
    model = MLModel(models_dir=str(tmp_path))
    bad_csv = tmp_path / "bad.csv"
    bad_csv.write_text("col1,col2\n1,2\n")
    with pytest.raises(ValueError, match="Missing required columns"):
        model.train(str(bad_csv))
```

Run: `cd backend && pytest tests/test_ml_model.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 2: Implement ml_model.py**

```python
import json
import os
from dataclasses import dataclass
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split

REQUIRED_COLUMNS = [
    "churned", "days_since_activity", "days_to_renewal", "open_high_priority_tasks",
    "latest_nps", "ticket_trend", "csm_sentiment", "account_age_days",
    "tier_encoded", "arr_band_encoded", "avg_score_30d", "avg_score_60d", "avg_score_90d",
]
FEATURE_COLUMNS = [c for c in REQUIRED_COLUMNS if c != "churned"]

@dataclass
class MLResult:
    ml_probability: float
    top_features: list[str]

class MLModel:
    def __init__(self, models_dir: str):
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self._classifier = None
        self._meta: dict = {}
        self._load_latest()

    @property
    def model_loaded(self) -> bool:
        return self._classifier is not None

    def _meta_path(self) -> Path:
        return self.models_dir / "model_meta.json"

    def _model_path(self, version: int) -> Path:
        return self.models_dir / f"model_v{version}.joblib"

    def _load_latest(self) -> None:
        if not self._meta_path().exists():
            return
        with open(self._meta_path()) as f:
            meta = json.load(f)
        path = self._model_path(meta["version"])
        if path.exists():
            self._classifier = joblib.load(path)
            self._meta = meta

    def train(self, csv_path: str) -> dict:
        df = pd.read_csv(csv_path)
        missing = set(REQUIRED_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"Missing required columns: {sorted(missing)}")
        df = df[REQUIRED_COLUMNS].dropna(subset=["churned"])
        X = df[FEATURE_COLUMNS].fillna(0)
        y = df["churned"].astype(int)
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        clf = GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=42)
        clf.fit(X_train, y_train)
        accuracy = float(clf.score(X_test, y_test)) if len(X_test) > 0 else 0.0
        importances = dict(zip(FEATURE_COLUMNS, clf.feature_importances_.tolist()))
        version = self._meta.get("version", 0) + 1
        joblib.dump(clf, self._model_path(version))
        meta = {
            "version": version,
            "accuracy": round(accuracy, 4),
            "feature_importances": importances,
            "trained_at": pd.Timestamp.now(tz="UTC").isoformat(),
            "n_training_samples": len(df),
        }
        with open(self._meta_path(), "w") as f:
            json.dump(meta, f, indent=2)
        self._classifier = clf
        self._meta = meta
        return {"version": version, "accuracy": accuracy, "n_samples": len(df), "trained_at": meta["trained_at"]}

    def predict(self, features: dict) -> MLResult | None:
        if not self.model_loaded:
            return None
        row = pd.DataFrame([{col: features.get(col, 0) for col in FEATURE_COLUMNS}])
        prob = float(self._classifier.predict_proba(row)[0][1])
        importances = self._meta.get("feature_importances", {})
        top = sorted(importances, key=lambda k: importances[k] * abs(features.get(k, 0)), reverse=True)[:3]
        return MLResult(ml_probability=round(prob, 4), top_features=top)

    def model_info(self) -> dict:
        if not self.model_loaded:
            return {"model_loaded": False, "version": None, "accuracy": None, "trained_at": None, "top_features": []}
        top = sorted(self._meta.get("feature_importances", {}), key=lambda k: self._meta["feature_importances"][k], reverse=True)[:3]
        return {
            "model_loaded": True,
            "version": self._meta["version"],
            "accuracy": self._meta["accuracy"],
            "trained_at": self._meta["trained_at"],
            "top_features": top,
        }
```

Save to `backend/app/ai/ml_model.py`.

- [ ] **Step 3: Run tests**

```bash
cd backend && pytest tests/test_ml_model.py -v
```
Expected: 4 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/ai/ml_model.py backend/tests/test_ml_model.py
git commit -m "feat: add ML model module (Tier 2) with train/predict/model-info"
```

---

## Task 4: Claude Narrator

**Files:**
- Create: `backend/app/ai/claude_narrator.py`
- Create: `backend/tests/test_claude_narrator.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_claude_narrator.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from app.ai.claude_narrator import mask_pii, arr_band, build_context, generate

def test_mask_pii_email():
    assert mask_pii("Contact john.doe@acme.com for details") == "Contact [EMAIL] for details"

def test_mask_pii_phone():
    assert mask_pii("Call +1 (555) 867-5309 today") == "Call [PHONE] today"

def test_mask_pii_multiple():
    text = "Email test@example.com or call 555-1234567"
    result = mask_pii(text)
    assert "[EMAIL]" in result
    assert "[PHONE]" in result
    assert "test@example.com" not in result

def test_mask_pii_no_pii():
    text = "Customer health is declining this quarter"
    assert mask_pii(text) == text

def test_arr_band():
    assert arr_band(None) == "unknown"
    assert arr_band(49999) == "<$50k"
    assert arr_band(50000) == "$50k–$200k"
    assert arr_band(199999) == "$50k–$200k"
    assert arr_band(200000) == ">$200k"

def test_build_context_masks_notes():
    ctx = build_context(
        tier="enterprise",
        arr=150000,
        days_to_renewal=45,
        signal_scores={"latest_nps": 20.0, "days_since_activity": 0.0},
        weights={"latest_nps": 0.20, "days_since_activity": 0.20},
        ml_result=None,
        open_tasks=2,
        high_priority_tasks=1,
        nps_scores=[7, 8],
        notes=["Called client@example.com about renewal", "Good meeting"],
        playbook_trigger_count=1,
    )
    assert "client@example.com" not in ctx
    assert "[EMAIL]" in ctx
    assert "enterprise" in ctx
    assert "$50k–$200k" in ctx

def test_generate_returns_none_on_api_error():
    with patch("app.ai.claude_narrator._get_client") as mock_client:
        mock_client.return_value.messages.create.side_effect = Exception("API error")
        result = generate(
            tier="smb", arr=30000, days_to_renewal=60,
            signal_scores={}, weights={}, ml_result=None,
            open_tasks=0, high_priority_tasks=0,
            nps_scores=[], notes=[], playbook_trigger_count=0,
        )
        assert result is None

def test_generate_returns_narrative_on_success():
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="ASSESSMENT: Risk is low.\nACTIONS:\n1. Do A\n2. Do B\n3. Do C")]
    with patch("app.ai.claude_narrator._get_client") as mock_client:
        mock_client.return_value.messages.create.return_value = mock_response
        result = generate(
            tier="enterprise", arr=250000, days_to_renewal=90,
            signal_scores={"latest_nps": 60.0}, weights={"latest_nps": 0.20},
            ml_result=None, open_tasks=1, high_priority_tasks=0,
            nps_scores=[8], notes=["Good progress"], playbook_trigger_count=0,
        )
        assert result is not None
        assert "ASSESSMENT" in result
```

Run: `cd backend && pytest tests/test_claude_narrator.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 2: Implement claude_narrator.py**

```python
import re
import logging
from functools import lru_cache
import anthropic
from app.core.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a Customer Success analyst reviewing account health signals.
Write a churn risk assessment based on the data provided. Respond in exactly this format:

ASSESSMENT: <3-5 sentences on churn risk level and key drivers>
ACTIONS:
1. <specific next action for the CSM>
2. <specific next action for the CSM>
3. <specific next action for the CSM>

Be specific. Reference the signals provided. Do not mention the customer by name."""

def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

def mask_pii(text: str) -> str:
    text = re.sub(r'\S+@\S+\.\S+', '[EMAIL]', text)
    text = re.sub(r'[\+\d][\d\s\-\(\)\.]{6,}\d', '[PHONE]', text)
    return text

def arr_band(arr: float | None) -> str:
    if arr is None:
        return "unknown"
    if arr < 50_000:
        return "<$50k"
    if arr < 200_000:
        return "$50k–$200k"
    return ">$200k"

def build_context(
    tier: str,
    arr: float | None,
    days_to_renewal: int,
    signal_scores: dict[str, float],
    weights: dict[str, float],
    ml_result,
    open_tasks: int,
    high_priority_tasks: int,
    nps_scores: list[int],
    notes: list[str],
    playbook_trigger_count: int,
) -> str:
    lines = [
        f"Account tier: {tier}",
        f"ARR band: {arr_band(arr)}",
        f"Days to renewal: {days_to_renewal}",
        "",
        "Signal scores (0-100, higher = healthier):",
    ]
    for signal, score in signal_scores.items():
        w = weights.get(signal, 0)
        lines.append(f"  {signal}: {score:.0f} (weight {w:.0%})")
    if ml_result:
        lines += [
            "",
            f"ML churn probability: {ml_result.ml_probability:.0%}",
            f"Top risk factors: {', '.join(ml_result.top_features)}",
        ]
    lines += [
        "",
        f"Open tasks: {open_tasks} ({high_priority_tasks} high-priority)",
        f"NPS scores (recent): {nps_scores if nps_scores else 'none'}",
        f"Playbook triggers (last 30d): {playbook_trigger_count}",
    ]
    if notes:
        lines += ["", "Recent CSM notes:"]
        for note in notes:
            lines.append(f"  - {mask_pii(note)}")
    return "\n".join(lines)

def generate(
    tier: str,
    arr: float | None,
    days_to_renewal: int,
    signal_scores: dict[str, float],
    weights: dict[str, float],
    ml_result,
    open_tasks: int,
    high_priority_tasks: int,
    nps_scores: list[int],
    notes: list[str],
    playbook_trigger_count: int,
) -> str | None:
    context = build_context(
        tier=tier, arr=arr, days_to_renewal=days_to_renewal,
        signal_scores=signal_scores, weights=weights, ml_result=ml_result,
        open_tasks=open_tasks, high_priority_tasks=high_priority_tasks,
        nps_scores=nps_scores, notes=notes,
        playbook_trigger_count=playbook_trigger_count,
    )
    try:
        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": context}],
        )
        return response.content[0].text
    except Exception as e:
        logger.warning(f"Claude narrator failed: {e}")
        return None
```

Save to `backend/app/ai/claude_narrator.py`.

- [ ] **Step 3: Run tests**

```bash
cd backend && pytest tests/test_claude_narrator.py -v
```
Expected: 7 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/ai/claude_narrator.py backend/tests/test_claude_narrator.py
git commit -m "feat: add Claude narrator (Tier 3) with PII masking and prompt caching"
```

---

## Task 5: Churn Engine Orchestrator

**Files:**
- Create: `backend/app/ai/churn_engine.py`
- Create: `backend/tests/test_churn_engine.py`

- [ ] **Step 1: Write failing integration test**

Create `backend/tests/test_churn_engine.py`:

```python
import pytest
from unittest.mock import patch
from sqlalchemy import select
from app.ai.churn_engine import ChurnEngine
from app.models.account import Account, AccountTier, ChurnRiskTier
from app.models.health_score_log import HealthScoreLog
from app.models.user import User, UserRole
from app.core.security import hash_password

@pytest.fixture
async def account_with_csm(db):
    user = User(name="CSM", email="csm2@engine.test", role=UserRole.csm,
                hashed_password=hash_password("pw"), is_active=True)
    db.add(user)
    await db.flush()
    acct = Account(name="Engine Test Co", tier=AccountTier.enterprise,
                   arr=150000, csm_id=user.id, csm_sentiment=4, ticket_trend=3)
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    return acct

@pytest.mark.asyncio
async def test_run_writes_health_score_log(db, account_with_csm):
    engine = ChurnEngine()
    with patch("app.ai.churn_engine.claude_narrator.generate", return_value=None):
        result = await engine.run(account_with_csm.id, db, force_narrative=False)
    assert result is not None
    assert 0 <= result["final_score"] <= 100
    assert result["churn_risk_tier"] in ("green", "yellow", "red")
    logs = (await db.execute(
        select(HealthScoreLog).where(HealthScoreLog.account_id == account_with_csm.id)
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].score == int(result["final_score"])

@pytest.mark.asyncio
async def test_run_updates_account_health_score(db, account_with_csm):
    engine = ChurnEngine()
    with patch("app.ai.churn_engine.claude_narrator.generate", return_value=None):
        result = await engine.run(account_with_csm.id, db, force_narrative=False)
    await db.refresh(account_with_csm)
    assert account_with_csm.health_score == int(result["final_score"])

@pytest.mark.asyncio
async def test_run_calls_narrator_when_forced(db, account_with_csm):
    engine = ChurnEngine()
    with patch("app.ai.churn_engine.claude_narrator.generate", return_value="ASSESSMENT: ok") as mock_gen:
        await engine.run(account_with_csm.id, db, force_narrative=True)
    mock_gen.assert_called_once()

@pytest.mark.asyncio
async def test_run_returns_none_for_missing_account(db):
    engine = ChurnEngine()
    result = await engine.run(99999, db, force_narrative=False)
    assert result is None
```

Run: `cd backend && pytest tests/test_churn_engine.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 2: Implement churn_engine.py**

```python
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.ai import rule_engine, claude_narrator
from app.ai.rule_engine import SignalValues
from app.models.account import Account, ChurnRiskTier
from app.models.health_score_log import HealthScoreLog, ScoreTrigger
from app.models.activity import Activity, ActivityType
from app.models.survey import Survey, SurveyType
from app.models.scoring_config import ScoringConfig, DEFAULT_WEIGHTS

logger = logging.getLogger(__name__)

# Module-level ML model instance (loaded once at startup)
try:
    from app.ai.ml_model import MLModel
    import os
    _ml_model = MLModel(models_dir=os.path.join(os.path.dirname(__file__), "../../ml_models"))
except Exception as e:
    logger.warning(f"Could not initialize ML model: {e}")
    _ml_model = None


class ChurnEngine:
    async def run(self, account_id: int, db: AsyncSession, force_narrative: bool = False) -> dict | None:
        account = await db.get(Account, account_id)
        if not account:
            return None

        weights = await self._load_weights(db)
        signals = await self._build_signals(account, db)
        rule_result = rule_engine.calculate(signals, weights)

        ml_result = None
        if _ml_model:
            features = self._build_ml_features(account, signals, db)
            ml_result = _ml_model.predict(features)

        if ml_result:
            final_score = rule_result.rule_score * 0.4 + ml_result.ml_probability * 100 * 0.6
        else:
            final_score = rule_result.rule_score
        final_score = round(final_score, 2)

        prev_score = account.health_score or 50
        score_delta = abs(final_score - prev_score)
        should_narrate = force_narrative or score_delta > 10

        ai_narrative = None
        if should_narrate:
            notes, nps_scores, playbook_count = await self._gather_narrative_context(account_id, db)
            days_to_renewal = self._days_to_renewal(account)
            ai_narrative = claude_narrator.generate(
                tier=account.tier.value,
                arr=float(account.arr) if account.arr else None,
                days_to_renewal=days_to_renewal,
                signal_scores=rule_result.signal_scores,
                weights=weights,
                ml_result=ml_result,
                open_tasks=signals.open_high_priority_tasks,
                high_priority_tasks=signals.open_high_priority_tasks,
                nps_scores=nps_scores,
                notes=notes,
                playbook_trigger_count=playbook_count,
            )

        churn_risk_tier = ChurnRiskTier(rule_result.churn_risk_tier)
        log = HealthScoreLog(
            account_id=account_id,
            score=int(final_score),
            rule_score=int(rule_result.rule_score),
            ml_score=ml_result.ml_probability if ml_result else None,
            ml_confidence=None,
            ai_narrative=ai_narrative,
            triggered_by=ScoreTrigger.auto,
            created_at=datetime.now(timezone.utc),
        )
        db.add(log)
        account.health_score = int(final_score)
        account.churn_risk_tier = churn_risk_tier
        await db.commit()

        return {
            "final_score": final_score,
            "rule_score": rule_result.rule_score,
            "signal_scores": rule_result.signal_scores,
            "churn_risk_tier": churn_risk_tier.value,
            "ml_probability": ml_result.ml_probability if ml_result else None,
            "ml_top_features": ml_result.top_features if ml_result else None,
            "ai_narrative": ai_narrative,
        }

    async def _load_weights(self, db: AsyncSession) -> dict[str, float]:
        result = await db.execute(select(ScoringConfig))
        rows = result.scalars().all()
        if not rows:
            return DEFAULT_WEIGHTS.copy()
        return {row.signal_name: row.weight for row in rows}

    def _days_to_renewal(self, account: Account) -> int:
        if not account.renewal_date:
            return 365
        from datetime import date
        delta = account.renewal_date - date.today()
        return max(delta.days, 0)

    async def _build_signals(self, account: Account, db: AsyncSession) -> SignalValues:
        # Days since last CSM activity
        last_activity = await db.execute(
            select(func.max(Activity.created_at))
            .where(Activity.account_id == account.id, Activity.type == ActivityType.note)
        )
        last_dt = last_activity.scalar_one_or_none()
        if last_dt:
            days_since = (datetime.now(timezone.utc) - last_dt.replace(tzinfo=timezone.utc)).days
        else:
            days_since = 999

        # Latest NPS
        latest_nps_row = await db.execute(
            select(Survey.score)
            .where(Survey.account_id == account.id, Survey.type == SurveyType.nps)
            .order_by(Survey.submitted_at.desc())
            .limit(1)
        )
        latest_nps = latest_nps_row.scalar_one_or_none()

        # Open high-priority tasks
        from app.models.task import Task, TaskStatus, TaskPriority
        task_count = await db.execute(
            select(func.count()).where(
                Task.account_id == account.id,
                Task.status == TaskStatus.open,
                Task.priority == TaskPriority.high,
            )
        )
        open_high = task_count.scalar_one()

        return SignalValues(
            days_since_activity=days_since,
            days_to_renewal=self._days_to_renewal(account),
            open_high_priority_tasks=open_high,
            latest_nps=latest_nps,
            ticket_trend=account.ticket_trend or 3,
            csm_sentiment=account.csm_sentiment or 3,
        )

    def _build_ml_features(self, account: Account, signals: SignalValues, db) -> dict:
        tier_map = {"smb": 0, "mid_market": 1, "enterprise": 2}
        arr = float(account.arr) if account.arr else 0
        arr_band = 0 if arr < 50_000 else (1 if arr < 200_000 else 2)
        return {
            "days_since_activity": signals.days_since_activity,
            "days_to_renewal": signals.days_to_renewal,
            "open_high_priority_tasks": signals.open_high_priority_tasks,
            "latest_nps": signals.latest_nps or 5,
            "ticket_trend": signals.ticket_trend,
            "csm_sentiment": signals.csm_sentiment,
            "account_age_days": 365,
            "tier_encoded": tier_map.get(account.tier.value, 0),
            "arr_band_encoded": arr_band,
            "avg_score_30d": account.health_score or 50,
            "avg_score_60d": account.health_score or 50,
            "avg_score_90d": account.health_score or 50,
        }

    async def _gather_narrative_context(self, account_id: int, db: AsyncSession):
        notes_result = await db.execute(
            select(Activity.content)
            .where(Activity.account_id == account_id, Activity.type == ActivityType.note,
                   Activity.content.isnot(None))
            .order_by(Activity.created_at.desc())
            .limit(5)
        )
        notes = [r[0] for r in notes_result.all()]

        nps_result = await db.execute(
            select(Survey.score)
            .where(Survey.account_id == account_id, Survey.type == SurveyType.nps,
                   Survey.score.isnot(None))
            .order_by(Survey.submitted_at.desc())
            .limit(3)
        )
        nps_scores = [r[0] for r in nps_result.all()]

        from app.models.playbook import PlaybookRun, PlaybookRunStatus
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        pb_result = await db.execute(
            select(func.count()).where(
                PlaybookRun.account_id == account_id,
                PlaybookRun.triggered_at >= cutoff,
            )
        )
        playbook_count = pb_result.scalar_one()

        return notes, nps_scores, playbook_count
```

Save to `backend/app/ai/churn_engine.py`.

- [ ] **Step 3: Run integration tests**

```bash
cd backend && pytest tests/test_churn_engine.py -v
```
Expected: 4 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/ai/churn_engine.py backend/tests/test_churn_engine.py
git commit -m "feat: add churn engine orchestrator wiring all three tiers"
```

---

## Task 6: Scoring Service + Schemas

**Files:**
- Create: `backend/app/services/scoring_service.py`
- Create: `backend/app/schemas/scoring.py`
- Create: `backend/app/schemas/ai.py`

- [ ] **Step 1: Create schemas/scoring.py**

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ScoringConfigOut(BaseModel):
    signal_name: str
    weight: float
    updated_at: datetime

    model_config = {"from_attributes": True}

class ScoringConfigUpdate(BaseModel):
    weight: float

class HealthScoreOut(BaseModel):
    account_id: int
    health_score: int
    churn_risk_tier: str
    rule_score: Optional[float] = None
    signal_scores: Optional[dict[str, float]] = None
    ml_probability: Optional[float] = None
    ml_top_features: Optional[list[str]] = None
    ai_narrative: Optional[str] = None
    trend_90d: list[dict] = []

class RecalculateResponse(BaseModel):
    account_id: int
    final_score: float
    rule_score: float
    churn_risk_tier: str
    ml_probability: Optional[float] = None
    ai_narrative: Optional[str] = None
```

Save to `backend/app/schemas/scoring.py`.

- [ ] **Step 2: Create schemas/ai.py**

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class TrainResponse(BaseModel):
    version: int
    accuracy: float
    n_samples: int
    trained_at: str

class ModelInfoResponse(BaseModel):
    model_loaded: bool
    version: Optional[int] = None
    accuracy: Optional[float] = None
    trained_at: Optional[str] = None
    top_features: list[str] = []

class NarrativeResponse(BaseModel):
    account_id: int
    ai_narrative: Optional[str]
    generated_at: datetime
```

Save to `backend/app/schemas/ai.py`.

- [ ] **Step 3: Create scoring_service.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.ai.churn_engine import ChurnEngine

_engine = ChurnEngine()

async def recalculate_health(account_id: int, db: AsyncSession, force_narrative: bool = False) -> dict | None:
    return await _engine.run(account_id, db, force_narrative=force_narrative)
```

Save to `backend/app/services/scoring_service.py`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/scoring.py backend/app/schemas/ai.py backend/app/services/scoring_service.py
git commit -m "feat: add scoring service and response schemas"
```

---

## Task 7: Scoring API

**Files:**
- Create: `backend/app/api/scoring.py`
- Create: `backend/tests/test_scoring_api.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_scoring_api.py`:

```python
import pytest
from unittest.mock import patch
from app.models.account import Account, AccountTier
from app.models.user import User, UserRole
from app.core.security import hash_password

@pytest.fixture
async def admin_headers(client, db):
    user = User(name="Admin2", email="admin2@score.test", role=UserRole.admin,
                hashed_password=hash_password("adminpw"), is_active=True)
    db.add(user)
    await db.commit()
    resp = await client.post("/auth/login", json={"email": "admin2@score.test", "password": "adminpw"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
async def csm_headers(client, db):
    user = User(name="CSM3", email="csm3@score.test", role=UserRole.csm,
                hashed_password=hash_password("csmpw"), is_active=True)
    db.add(user)
    await db.commit()
    resp = await client.post("/auth/login", json={"email": "csm3@score.test", "password": "csmpw"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
async def test_account(db):
    acct = Account(name="Score Test Co", tier=AccountTier.smb, csm_sentiment=3, ticket_trend=3)
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    return acct

@pytest.mark.asyncio
async def test_recalculate_returns_score(client, test_account, csm_headers):
    with patch("app.services.scoring_service._engine.run") as mock_run:
        mock_run.return_value = {
            "final_score": 72.5, "rule_score": 72.5, "signal_scores": {},
            "churn_risk_tier": "green", "ml_probability": None,
            "ml_top_features": None, "ai_narrative": None,
        }
        resp = await client.post(
            f"/scoring/recalculate/{test_account.id}",
            json={"force_narrative": False},
            headers=csm_headers,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["final_score"] == 72.5
    assert data["churn_risk_tier"] == "green"

@pytest.mark.asyncio
async def test_recalculate_404_for_missing_account(client, csm_headers):
    with patch("app.services.scoring_service._engine.run", return_value=None):
        resp = await client.post("/scoring/recalculate/99999", json={}, headers=csm_headers)
    assert resp.status_code == 404

@pytest.mark.asyncio
async def test_get_scoring_config_returns_defaults(client, admin_headers):
    resp = await client.get("/scoring/config", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Either from DB or defaults — both are valid
    assert len(data) == 6

@pytest.mark.asyncio
async def test_patch_scoring_config_requires_admin(client, csm_headers):
    resp = await client.patch("/scoring/config/latest_nps", json={"weight": 0.20}, headers=csm_headers)
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_patch_scoring_config_invalid_signal(client, admin_headers):
    resp = await client.patch("/scoring/config/nonexistent_signal", json={"weight": 0.20}, headers=admin_headers)
    assert resp.status_code == 422
```

Run: `cd backend && pytest tests/test_scoring_api.py -v`
Expected: FAIL (router not registered)

- [ ] **Step 2: Implement api/scoring.py**

```python
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.user import User, UserRole
from app.models.scoring_config import ScoringConfig, DEFAULT_WEIGHTS, SIGNAL_NAMES
from app.schemas.scoring import ScoringConfigOut, ScoringConfigUpdate, RecalculateResponse
from app.services import scoring_service

router = APIRouter(tags=["scoring"])

@router.post("/scoring/recalculate/{account_id}", response_model=RecalculateResponse)
async def recalculate(
    account_id: int,
    force_narrative: bool = Body(False, embed=True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.csm, UserRole.admin)),
):
    result = await scoring_service.recalculate_health(account_id, db, force_narrative)
    if result is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return RecalculateResponse(account_id=account_id, **result)

@router.get("/scoring/config", response_model=list[ScoringConfigOut])
async def get_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin)),
):
    rows = (await db.execute(select(ScoringConfig))).scalars().all()
    if rows:
        return rows
    # Return defaults as synthetic response objects
    from datetime import datetime, timezone
    return [
        ScoringConfigOut(signal_name=k, weight=v, updated_at=datetime.now(timezone.utc))
        for k, v in DEFAULT_WEIGHTS.items()
    ]

@router.patch("/scoring/config/{signal_name}", response_model=list[ScoringConfigOut])
async def update_config(
    signal_name: str,
    body: ScoringConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin)),
):
    if signal_name not in SIGNAL_NAMES:
        raise HTTPException(status_code=422, detail=f"Unknown signal: {signal_name}. Valid: {SIGNAL_NAMES}")

    # Ensure all signals exist in DB before updating
    existing = {r.signal_name: r for r in (await db.execute(select(ScoringConfig))).scalars().all()}
    if not existing:
        for name, weight in DEFAULT_WEIGHTS.items():
            db.add(ScoringConfig(signal_name=name, weight=weight, created_by=current_user.id))
        await db.flush()
        existing = {r.signal_name: r for r in (await db.execute(select(ScoringConfig))).scalars().all()}

    existing[signal_name].weight = body.weight

    # Validate weights sum to ~1.0
    all_weights = {name: (existing[name].weight if name != signal_name else body.weight) for name in SIGNAL_NAMES}
    total = sum(all_weights.values())
    if not (0.99 <= total <= 1.01):
        raise HTTPException(status_code=422, detail=f"Weights must sum to 1.0, got {total:.4f}")

    await db.commit()
    rows = (await db.execute(select(ScoringConfig))).scalars().all()
    return rows
```

Save to `backend/app/api/scoring.py`.

- [ ] **Step 3: Register router in main.py**

In `backend/app/main.py`, add:
```python
from app.api.scoring import router as scoring_router
from app.api.ai import router as ai_router
```

And in the `app.include_router` section add:
```python
app.include_router(scoring_router)
app.include_router(ai_router)
```

The full `main.py`:
```python
from fastapi import FastAPI
from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.contacts import router as contacts_router
from app.api.tasks import router as tasks_router
from app.api.scoring import router as scoring_router
from app.api.ai import router as ai_router

app = FastAPI(title="CRM API", version="0.1.0")

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(contacts_router)
app.include_router(tasks_router)
app.include_router(scoring_router)
app.include_router(ai_router)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

Note: `app/api/ai.py` is a stub until Task 8. Create it now:

`backend/app/api/ai.py`:
```python
from fastapi import APIRouter
router = APIRouter(tags=["ai"])
```

- [ ] **Step 4: Run scoring API tests**

```bash
cd backend && pytest tests/test_scoring_api.py -v
```
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/scoring.py backend/app/api/ai.py backend/app/main.py backend/tests/test_scoring_api.py
git commit -m "feat: add scoring API endpoints (recalculate, config get/patch)"
```

---

## Task 8: AI API

**Files:**
- Replace: `backend/app/api/ai.py` (replace the stub)

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_scoring_api.py` (append to the file):

```python
@pytest.mark.asyncio
async def test_model_info_when_untrained(client, csm_headers):
    resp = await client.get("/ai/model-info", headers=csm_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["model_loaded"] in (True, False)  # depends on whether artifacts exist
    assert "version" in data

@pytest.mark.asyncio
async def test_narrative_endpoint(client, test_account, csm_headers):
    with patch("app.api.ai.ChurnEngine") as MockEngine:
        instance = MockEngine.return_value
        instance.run.return_value = {
            "final_score": 55.0, "rule_score": 55.0, "signal_scores": {},
            "churn_risk_tier": "yellow", "ml_probability": None,
            "ml_top_features": None, "ai_narrative": "ASSESSMENT: moderate risk.",
        }
        resp = await client.post(f"/ai/narrative/{test_account.id}", headers=csm_headers)
    assert resp.status_code == 200
    assert "ai_narrative" in resp.json()

@pytest.mark.asyncio
async def test_train_requires_admin(client, csm_headers, tmp_path):
    csv = tmp_path / "t.csv"
    csv.write_text("col1\n1\n")
    with open(csv, "rb") as f:
        resp = await client.post("/ai/train", files={"training_data": f}, headers=csm_headers)
    assert resp.status_code == 403
```

Run: `cd backend && pytest tests/test_scoring_api.py -v`
Expected: 3 new FAIL (ai stub has no routes)

- [ ] **Step 2: Implement api/ai.py**

```python
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import require_roles
from app.models.user import UserRole
from app.schemas.ai import TrainResponse, ModelInfoResponse, NarrativeResponse
from app.ai.churn_engine import ChurnEngine
from app.ai.ml_model import MLModel

router = APIRouter(prefix="/ai", tags=["ai"])

_MODELS_DIR = os.path.join(os.path.dirname(__file__), "../../ml_models")
_ml_model = MLModel(models_dir=_MODELS_DIR)
_engine = ChurnEngine()

@router.post("/narrative/{account_id}", response_model=NarrativeResponse)
async def get_narrative(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles(UserRole.csm, UserRole.admin)),
):
    result = await _engine.run(account_id, db, force_narrative=True)
    if result is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return NarrativeResponse(
        account_id=account_id,
        ai_narrative=result.get("ai_narrative"),
        generated_at=datetime.now(timezone.utc),
    )

@router.post("/train", response_model=TrainResponse)
async def train_model(
    training_data: UploadFile = File(...),
    current_user=Depends(require_roles(UserRole.admin)),
):
    import tempfile, shutil
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        shutil.copyfileobj(training_data.file, tmp)
        tmp_path = tmp.name
    try:
        result = _ml_model.train(tmp_path)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        os.unlink(tmp_path)
    return TrainResponse(**result)

@router.get("/model-info", response_model=ModelInfoResponse)
async def model_info(
    current_user=Depends(require_roles(UserRole.csm, UserRole.admin)),
):
    return ModelInfoResponse(**_ml_model.model_info())
```

Save to `backend/app/api/ai.py`.

- [ ] **Step 3: Run all AI/scoring tests**

```bash
cd backend && pytest tests/test_scoring_api.py -v
```
Expected: 8 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/ai.py backend/tests/test_scoring_api.py
git commit -m "feat: add AI API endpoints (narrative, train, model-info)"
```

---

## Task 9: Wire Up Account Service + Real Health Endpoint

**Files:**
- Modify: `backend/app/services/account_service.py`
- Modify: `backend/app/schemas/account.py`
- Modify: `backend/app/api/accounts.py`

- [ ] **Step 1: Add ticket_trend and csm_sentiment to account schemas**

In `backend/app/schemas/account.py`, add `ticket_trend` and `csm_sentiment` to all three schema classes:

`AccountCreate` — add after `notes`:
```python
    ticket_trend: Optional[int] = None  # 1–5
    csm_sentiment: Optional[int] = None  # 1–5
```

`AccountUpdate` — add after `notes`:
```python
    ticket_trend: Optional[int] = None
    csm_sentiment: Optional[int] = None
```

`AccountOut` — add after `industry`:
```python
    ticket_trend: Optional[int] = None
    csm_sentiment: Optional[int] = None
```

- [ ] **Step 2: Trigger scoring on account update**

In `backend/app/services/account_service.py`, update `update_account` to trigger recalculation:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.account import Account
from app.schemas.account import AccountCreate, AccountUpdate
import logging

logger = logging.getLogger(__name__)

async def list_accounts(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 25,
    csm_id: int | None = None,
    risk_tier: str | None = None,
) -> tuple[list[Account], int]:
    q = select(Account)
    if csm_id:
        q = q.where(Account.csm_id == csm_id)
    if risk_tier:
        q = q.where(Account.churn_risk_tier == risk_tier)
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()
    q = q.offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()
    return list(items), total

async def get_account(db: AsyncSession, account_id: int) -> Account | None:
    return await db.get(Account, account_id)

async def create_account(db: AsyncSession, data: AccountCreate) -> Account:
    account = Account(**data.model_dump(exclude_none=True))
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account

async def update_account(db: AsyncSession, account: Account, data: AccountUpdate) -> Account:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    # Trigger async health recalculation (best-effort — don't fail update if scoring fails)
    try:
        from app.services.scoring_service import recalculate_health
        await recalculate_health(account.id, db, force_narrative=False)
        await db.refresh(account)
    except Exception as e:
        logger.warning(f"Health recalculation failed for account {account.id}: {e}")
    return account
```

- [ ] **Step 3: Replace health endpoint stub in api/accounts.py**

In `backend/app/api/accounts.py`, replace the `get_account_health` endpoint:

```python
@router.get("/{account_id}/health", response_model=HealthScoreOut)
async def get_account_health(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.health_score_log import HealthScoreLog
    from sqlalchemy import select
    from app.schemas.scoring import HealthScoreOut
    import json

    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Latest log
    latest = (await db.execute(
        select(HealthScoreLog)
        .where(HealthScoreLog.account_id == account_id)
        .order_by(HealthScoreLog.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    # 90-day trend
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    trend_rows = (await db.execute(
        select(HealthScoreLog.created_at, HealthScoreLog.score)
        .where(HealthScoreLog.account_id == account_id, HealthScoreLog.created_at >= cutoff)
        .order_by(HealthScoreLog.created_at.asc())
    )).all()
    trend_90d = [{"date": r[0].date().isoformat(), "score": r[1]} for r in trend_rows]

    return HealthScoreOut(
        account_id=account_id,
        health_score=account.health_score,
        churn_risk_tier=account.churn_risk_tier.value,
        rule_score=latest.rule_score if latest else None,
        signal_scores=None,
        ml_probability=latest.ml_score if latest else None,
        ml_top_features=None,
        ai_narrative=latest.ai_narrative if latest else None,
        trend_90d=trend_90d,
    )
```

Also add the import at the top of `accounts.py`:
```python
from app.schemas.scoring import HealthScoreOut
```

- [ ] **Step 4: Run full test suite**

```bash
cd backend && pytest -v
```
Expected: all tests PASS (27 existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/account_service.py backend/app/schemas/account.py backend/app/api/accounts.py
git commit -m "feat: wire scoring into account update, replace health endpoint stub with real data"
```

---

## Task 10: End-to-End Smoke Test

- [ ] **Step 1: Run the full test suite**

```bash
cd backend && pytest -v
```
Expected: all tests PASS

- [ ] **Step 2: Start the server**

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 3: Login and get token**

```bash
curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"admin123"}' | python -m json.tool
```

Copy the `access_token`.

- [ ] **Step 4: Check model-info (untrained state)**

```bash
TOKEN="<paste token>"
curl -s http://localhost:8000/ai/model-info \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```
Expected: `{"model_loaded": false, "version": null, ...}`

- [ ] **Step 5: Create an account and trigger scoring**

```bash
# Create account
ACCT=$(curl -s -X POST http://localhost:8000/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test Co","tier":"enterprise","arr":180000,"csm_sentiment":2,"ticket_trend":2}' | python -m json.tool)
echo $ACCT

# Get ID from output, then recalculate
ACCT_ID=<id from above>
curl -s -X POST http://localhost:8000/scoring/recalculate/$ACCT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force_narrative": false}' | python -m json.tool
```
Expected: `{"account_id": ..., "final_score": ..., "churn_risk_tier": "red" or "yellow", ...}`

- [ ] **Step 6: Check health endpoint**

```bash
curl -s http://localhost:8000/accounts/$ACCT_ID/health \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```
Expected: full health object with `rule_score`, `trend_90d` array (may be empty first run), `ai_narrative: null`

- [ ] **Step 7: Check scoring config**

```bash
curl -s http://localhost:8000/scoring/config \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```
Expected: list of 6 signals with weights

- [ ] **Step 8: Check OpenAPI docs**

Open http://localhost:8000/docs — verify `/scoring/recalculate/{account_id}`, `/scoring/config`, `/ai/narrative/{account_id}`, `/ai/train`, `/ai/model-info` all appear.

- [ ] **Step 9: Final commit**

```bash
git add .
git commit -m "chore: AI churn engine complete — rule engine, ML model, Claude narrator, scoring API"
```

---

## Self-Review

**Spec coverage:**
- [x] Tier 1 rule engine with 6 signals (days_since_activity, days_to_renewal, open_high_priority_tasks, latest_nps, ticket_trend, csm_sentiment) → Task 2
- [x] Signal weights loaded from DB (ScoringConfig), fallback to defaults → Tasks 1, 5, 7
- [x] Admin-adjustable weights with sum-to-1 validation → Task 7
- [x] Tier 2 ML model dormant until CSV upload → Task 3
- [x] GradientBoostingClassifier, versioned artifacts, model_meta.json → Task 3
- [x] Training CSV validation, accuracy reporting → Task 3
- [x] Score combination: rule × 0.4 + ml × 0.6, falls back to rule only → Task 5
- [x] Tier 3 Claude narrative, synchronous call → Task 4
- [x] PII masking: email → [EMAIL], phone → [PHONE] → Task 4
- [x] ARR band instead of exact value → Task 4
- [x] Account tier only (not name) → Task 4
- [x] Prompt caching on system message → Task 4
- [x] Claude failure returns None, HealthScoreLog still written → Tasks 4, 5
- [x] Narrative triggered on >10 point delta or force_narrative → Task 5
- [x] HealthScoreLog written per run → Task 5
- [x] Account.health_score and churn_risk_tier updated → Task 5
- [x] POST /scoring/recalculate/{id} → Task 7
- [x] GET/PATCH /scoring/config → Task 7
- [x] POST /ai/narrative/{id} (force narrative) → Task 8
- [x] POST /ai/train (admin, CSV upload) → Task 8
- [x] GET /ai/model-info → Task 8
- [x] GET /accounts/{id}/health returns real data → Task 9
- [x] account_service.update_account triggers recalculation → Task 9
- [x] ticket_trend and csm_sentiment added to Account model → Task 1
- [x] Unit tests: rule_engine, ml_model, claude_narrator → Tasks 2, 3, 4
- [x] Integration tests: churn_engine (DB), scoring_api (HTTP) → Tasks 5, 7, 8
