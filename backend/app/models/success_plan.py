import enum
from sqlalchemy import String, Text, ForeignKey, Boolean, Integer, Enum as SAEnum, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import date

class PlanStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    completed = "completed"

class MilestoneStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    completed = "completed"
    blocked = "blocked"

class SuccessPlan(Base, TimestampMixin):
    __tablename__ = "success_plans"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[PlanStatus] = mapped_column(SAEnum(PlanStatus), default=PlanStatus.draft, nullable=False)
    visible_to_customer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

class Milestone(Base, TimestampMixin):
    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    success_plan_id: Mapped[int] = mapped_column(ForeignKey("success_plans.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    customer_assignee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[MilestoneStatus] = mapped_column(SAEnum(MilestoneStatus), default=MilestoneStatus.not_started, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

class MilestoneComment(Base, TimestampMixin):
    __tablename__ = "milestone_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    milestone_id: Mapped[int] = mapped_column(ForeignKey("milestones.id"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    authored_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    authored_by_contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id"), nullable=True)
