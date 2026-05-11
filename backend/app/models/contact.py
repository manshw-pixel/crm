import enum
from sqlalchemy import String, Integer, ForeignKey, DateTime, Boolean, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import datetime

class ContactRole(str, enum.Enum):
    champion = "champion"
    economic_buyer = "economic_buyer"
    influencer = "influencer"
    detractor = "detractor"
    end_user = "end_user"

class Contact(Base, TimestampMixin):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[ContactRole | None] = mapped_column(SAEnum(ContactRole), nullable=True)
    influence_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_engaged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
