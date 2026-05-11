from pydantic import BaseModel
from typing import Optional
from decimal import Decimal
from datetime import date, datetime
from app.models.account import AccountTier, ChurnRiskTier

class AccountCreate(BaseModel):
    name: str
    tier: AccountTier
    arr: Optional[Decimal] = None
    mrr: Optional[Decimal] = None
    contract_start: Optional[date] = None
    renewal_date: Optional[date] = None
    csm_id: Optional[int] = None
    ae_id: Optional[int] = None
    industry: Optional[str] = None
    employee_count: Optional[int] = None
    notes: Optional[str] = None

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    tier: Optional[AccountTier] = None
    arr: Optional[Decimal] = None
    mrr: Optional[Decimal] = None
    contract_start: Optional[date] = None
    renewal_date: Optional[date] = None
    csm_id: Optional[int] = None
    ae_id: Optional[int] = None
    health_score: Optional[int] = None
    churn_risk_tier: Optional[ChurnRiskTier] = None
    industry: Optional[str] = None
    employee_count: Optional[int] = None
    notes: Optional[str] = None

class AccountOut(BaseModel):
    id: int
    name: str
    tier: AccountTier
    arr: Optional[Decimal] = None
    mrr: Optional[Decimal] = None
    renewal_date: Optional[date] = None
    csm_id: Optional[int] = None
    ae_id: Optional[int] = None
    health_score: int
    churn_risk_tier: ChurnRiskTier
    industry: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class AccountListResponse(BaseModel):
    items: list[AccountOut]
    total: int
    page: int
    page_size: int
