import enum
from sqlalchemy import String, Integer, Numeric, Date, ForeignKey, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin
from datetime import date
from decimal import Decimal

class AccountTier(str, enum.Enum):
    smb = "smb"
    mid_market = "mid_market"
    enterprise = "enterprise"

class ChurnRiskTier(str, enum.Enum):
    green = "green"
    yellow = "yellow"
    red = "red"

class Account(Base, TimestampMixin):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    tier: Mapped[AccountTier] = mapped_column(SAEnum(AccountTier), nullable=False)
    arr: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    mrr: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    contract_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    csm_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    ae_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    health_score: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    churn_risk_tier: Mapped[ChurnRiskTier] = mapped_column(
        SAEnum(ChurnRiskTier), default=ChurnRiskTier.yellow, nullable=False
    )
    industry: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employee_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
