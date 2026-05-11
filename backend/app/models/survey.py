import enum
from sqlalchemy import String, Text, ForeignKey, Integer, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base
from datetime import datetime

class SurveyType(str, enum.Enum):
    nps = "nps"
    csat = "csat"
    custom = "custom"

class Survey(Base):
    __tablename__ = "surveys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    type: Mapped[SurveyType] = mapped_column(SAEnum(SurveyType), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_by_contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
