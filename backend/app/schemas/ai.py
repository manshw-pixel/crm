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
