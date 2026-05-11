from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.account import Account
from app.schemas.account import AccountCreate, AccountUpdate
import logging

logger = logging.getLogger(__name__)

async def list_accounts(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 25,
    csm_id: int | None = None,
    risk_tier: str | None = None,
) -> tuple[list[Account], int]:
    q = select(Account)
    if csm_id:
        q = q.where(Account.csm_id == csm_id)
    if risk_tier:
        q = q.where(Account.churn_risk_tier == risk_tier)
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()
    q = q.offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()
    return list(items), total

async def get_account(db: AsyncSession, account_id: int) -> Account | None:
    return await db.get(Account, account_id)

async def create_account(db: AsyncSession, data: AccountCreate) -> Account:
    account = Account(**data.model_dump(exclude_none=True))
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account

async def update_account(db: AsyncSession, account: Account, data: AccountUpdate) -> Account:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    # Trigger health recalculation after update (best-effort)
    try:
        from app.services.scoring_service import recalculate_health
        await recalculate_health(account.id, db, force_narrative=False)
        await db.refresh(account)
    except Exception as e:
        logger.warning(f"Health recalculation failed for account {account.id}: {e}")
    return account
