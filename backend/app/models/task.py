import enum
from sqlalchemy import String, Text, ForeignKey, Date, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import date

class TaskPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"

class TaskStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"

class TaskSource(str, enum.Enum):
    manual = "manual"
    playbook = "playbook"

class Task(Base, TimestampMixin):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[TaskPriority] = mapped_column(SAEnum(TaskPriority), default=TaskPriority.medium, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus), default=TaskStatus.open, nullable=False)
    source: Mapped[TaskSource] = mapped_column(SAEnum(TaskSource), default=TaskSource.manual, nullable=False)
    playbook_run_id: Mapped[int | None] = mapped_column(ForeignKey("playbook_runs.id"), nullable=True)
