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
