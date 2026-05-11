from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.account import AccountCreate, AccountUpdate, AccountOut, AccountListResponse
from app.services import account_service

router = APIRouter(prefix="/accounts", tags=["accounts"])

@router.get("", response_model=AccountListResponse)
async def list_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    csm_id: int | None = Query(None),
    risk_tier: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, total = await account_service.list_accounts(db, page, page_size, csm_id, risk_tier)
    return AccountListResponse(items=items, total=total, page=page, page_size=page_size)

@router.post("", response_model=AccountOut, status_code=201)
async def create_account(
    body: AccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await account_service.create_account(db, body)

@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int,
    body: AccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return await account_service.update_account(db, account, body)

@router.get("/{account_id}/health")
async def get_account_health(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.health_score_log import HealthScoreLog
    from app.schemas.scoring import HealthScoreOut
    from datetime import datetime, timezone, timedelta

    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Latest health score log
    latest = (await db.execute(
        select(HealthScoreLog)
        .where(HealthScoreLog.account_id == account_id)
        .order_by(HealthScoreLog.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    # 90-day trend
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    trend_rows = (await db.execute(
        select(HealthScoreLog.created_at, HealthScoreLog.score)
        .where(HealthScoreLog.account_id == account_id, HealthScoreLog.created_at >= cutoff)
        .order_by(HealthScoreLog.created_at.asc())
    )).all()
    trend_90d = [{"date": r[0].date().isoformat(), "score": r[1]} for r in trend_rows]

    return HealthScoreOut(
        account_id=account_id,
        health_score=account.health_score,
        churn_risk_tier=account.churn_risk_tier.value,
        rule_score=latest.rule_score if latest else None,
        signal_scores=None,
        ml_probability=latest.ml_score if latest else None,
        ml_top_features=None,
        ai_narrative=latest.ai_narrative if latest else None,
        trend_90d=trend_90d,
    )

@router.get("/{account_id}/timeline")
async def get_account_timeline(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"account_id": account_id, "items": []}
