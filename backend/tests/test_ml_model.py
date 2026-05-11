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
