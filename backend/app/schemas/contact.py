from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.contact import ContactRole

class ContactCreate(BaseModel):
    name: str
    email: Optional[str] = None
    title: Optional[str] = None
    role: Optional[ContactRole] = None
    influence_rating: Optional[int] = None
    is_primary: bool = False

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    title: Optional[str] = None
    role: Optional[ContactRole] = None
    influence_rating: Optional[int] = None
    is_primary: Optional[bool] = None

class ContactOut(BaseModel):
    id: int
    account_id: int
    name: str
    email: Optional[str] = None
    title: Optional[str] = None
    role: Optional[ContactRole] = None
    influence_rating: Optional[int] = None
    is_primary: bool
    created_at: datetime

    model_config = {"from_attributes": True}
