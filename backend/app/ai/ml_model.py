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
