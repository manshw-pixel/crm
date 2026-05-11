import enum
from sqlalchemy import Integer, Float, Text, ForeignKey, Enum as SAEnum, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base
from datetime import datetime

class ScoreTrigger(str, enum.Enum):
    manual = "manual"
    auto = "auto"
    job = "job"

class HealthScoreLog(Base):
    __tablename__ = "health_score_logs"
    __table_args__ = (Index("ix_hsl_account_created", "account_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    rule_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ml_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ml_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[ScoreTrigger] = mapped_column(SAEnum(ScoreTrigger), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
