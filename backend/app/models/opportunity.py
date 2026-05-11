import enum
from sqlalchemy import String, Text, ForeignKey, Integer, Numeric, Date, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from decimal import Decimal
from datetime import date

class OpportunityType(str, enum.Enum):
    upsell = "upsell"
    expansion = "expansion"
    renewal = "renewal"
    cross_sell = "cross_sell"

class OpportunityStage(str, enum.Enum):
    identified = "identified"
    qualified = "qualified"
    proposed = "proposed"
    negotiating = "negotiating"
    closed_won = "closed_won"
    closed_lost = "closed_lost"

class Opportunity(Base, TimestampMixin):
    __tablename__ = "opportunities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    type: Mapped[OpportunityType] = mapped_column(SAEnum(OpportunityType), nullable=False)
    stage: Mapped[OpportunityStage] = mapped_column(SAEnum(OpportunityStage), default=OpportunityStage.identified, nullable=False)
    value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    probability: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expected_close_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
