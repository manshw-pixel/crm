import enum
from sqlalchemy import String, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin

class ActivityType(str, enum.Enum):
    note = "note"
    meeting = "meeting"
    task_completed = "task_completed"
    email = "email"
    playbook_triggered = "playbook_triggered"
    score_change = "score_change"
    survey = "survey"

class Activity(Base, TimestampMixin):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    type: Mapped[ActivityType] = mapped_column(SAEnum(ActivityType), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
