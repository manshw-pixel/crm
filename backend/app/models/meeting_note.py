from sqlalchemy import String, Text, ForeignKey, Date
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import date

class MeetingNote(Base, TimestampMixin):
    __tablename__ = "meeting_notes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    meeting_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    attendees: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    agenda: Mapped[str | None] = mapped_column(Text, nullable=True)
    decisions: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_items: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    next_steps: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
