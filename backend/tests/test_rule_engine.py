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
