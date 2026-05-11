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
        return 100.0
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
