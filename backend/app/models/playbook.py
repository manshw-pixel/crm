import enum
from sqlalchemy import String, Text, ForeignKey, Boolean, Numeric, Integer, DateTime, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import datetime

class PlaybookTriggerType(str, enum.Enum):
    score_drop = "score_drop"
    no_activity = "no_activity"
    renewal_approaching = "renewal_approaching"
    nps_below = "nps_below"
    manual = "manual"

class PlaybookRunStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    failed = "failed"

class PlaybookTemplate(Base, TimestampMixin):
    __tablename__ = "playbook_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    trigger_type: Mapped[PlaybookTriggerType] = mapped_column(SAEnum(PlaybookTriggerType), nullable=False)
    trigger_threshold: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    trigger_window_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

class PlaybookRun(Base):
    __tablename__ = "playbook_runs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    playbook_template_id: Mapped[int] = mapped_column(ForeignKey("playbook_templates.id"), nullable=False)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    triggered_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[PlaybookRunStatus] = mapped_column(SAEnum(PlaybookRunStatus), default=PlaybookRunStatus.running, nullable=False)
    actions_taken: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
