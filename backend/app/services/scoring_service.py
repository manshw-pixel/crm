from sqlalchemy.ext.asyncio import AsyncSession
from app.ai.churn_engine import ChurnEngine

_engine = ChurnEngine()

async def recalculate_health(account_id: int, db: AsyncSession, force_narrative: bool = False) -> dict | None:
    return await _engine.run(account_id, db, force_narrative=force_narrative)
