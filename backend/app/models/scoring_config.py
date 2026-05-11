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
