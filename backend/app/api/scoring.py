from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.user import User, UserRole
from app.models.scoring_config import ScoringConfig, DEFAULT_WEIGHTS, SIGNAL_NAMES
from app.schemas.scoring import ScoringConfigOut, ScoringConfigUpdate, RecalculateResponse
from app.services import scoring_service

router = APIRouter(tags=["scoring"])

@router.post("/scoring/recalculate/{account_id}", response_model=RecalculateResponse)
async def recalculate(
    account_id: int,
    force_narrative: bool = Body(False, embed=True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.csm, UserRole.admin)),
):
    result = await scoring_service.recalculate_health(account_id, db, force_narrative)
    if result is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return RecalculateResponse(account_id=account_id, **result)

@router.get("/scoring/config", response_model=list[ScoringConfigOut])
async def get_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin)),
):
    rows = (await db.execute(select(ScoringConfig))).scalars().all()
    if rows:
        return rows
    # Return defaults as synthetic response objects when DB is empty
    return [
        ScoringConfigOut(signal_name=k, weight=v, updated_at=datetime.now(timezone.utc))
        for k, v in DEFAULT_WEIGHTS.items()
    ]

@router.patch("/scoring/config/{signal_name}", response_model=list[ScoringConfigOut])
async def update_config(
    signal_name: str,
    body: ScoringConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin)),
):
    if signal_name not in SIGNAL_NAMES:
        raise HTTPException(status_code=422, detail=f"Unknown signal: {signal_name}. Valid: {SIGNAL_NAMES}")

    # Ensure all signals exist in DB before updating
    existing = {r.signal_name: r for r in (await db.execute(select(ScoringConfig))).scalars().all()}
    if not existing:
        for name, weight in DEFAULT_WEIGHTS.items():
            db.add(ScoringConfig(signal_name=name, weight=weight, created_by=current_user.id))
        await db.flush()
        existing = {r.signal_name: r for r in (await db.execute(select(ScoringConfig))).scalars().all()}

    existing[signal_name].weight = body.weight

    # Validate weights sum to ~1.0
    all_weights = {name: (existing[name].weight if name != signal_name else body.weight) for name in SIGNAL_NAMES}
    total = sum(all_weights.values())
    if not (0.99 <= total <= 1.01):
        raise HTTPException(status_code=422, detail=f"Weights must sum to 1.0, got {total:.4f}")

    await db.commit()
    rows = (await db.execute(select(ScoringConfig))).scalars().all()
    return rows
