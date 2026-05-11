import pytest
import pytest_asyncio
from unittest.mock import patch
from sqlalchemy import select
from app.ai.churn_engine import ChurnEngine
from app.models.account import Account, AccountTier, ChurnRiskTier
from app.models.health_score_log import HealthScoreLog
from app.models.user import User, UserRole
from app.core.security import hash_password

@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def account_with_csm(db):
    user = User(name="CSM Engine", email="csm2@engine.test", role=UserRole.csm,
                hashed_password=hash_password("pw"), is_active=True)
    db.add(user)
    await db.flush()
    acct = Account(name="Engine Test Co", tier=AccountTier.enterprise,
                   arr=150000, csm_id=user.id, csm_sentiment=4, ticket_trend=3)
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    return acct

@pytest.mark.asyncio
async def test_run_writes_health_score_log(db, account_with_csm):
    engine = ChurnEngine()
    with patch("app.ai.churn_engine.claude_narrator.generate", return_value=None):
        result = await engine.run(account_with_csm.id, db, force_narrative=False)
    assert result is not None
    assert 0 <= result["final_score"] <= 100
    assert result["churn_risk_tier"] in ("green", "yellow", "red")
    logs = (await db.execute(
        select(HealthScoreLog).where(HealthScoreLog.account_id == account_with_csm.id)
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].score == int(result["final_score"])

@pytest.mark.asyncio
async def test_run_updates_account_health_score(db, account_with_csm):
    engine = ChurnEngine()
    with patch("app.ai.churn_engine.claude_narrator.generate", return_value=None):
        result = await engine.run(account_with_csm.id, db, force_narrative=False)
    await db.refresh(account_with_csm)
    assert account_with_csm.health_score == int(result["final_score"])

@pytest.mark.asyncio
async def test_run_calls_narrator_when_forced(db, account_with_csm):
    engine = ChurnEngine()
    with patch("app.ai.churn_engine.claude_narrator.generate", return_value="ASSESSMENT: ok") as mock_gen:
        await engine.run(account_with_csm.id, db, force_narrative=True)
    mock_gen.assert_called_once()

@pytest.mark.asyncio
async def test_run_returns_none_for_missing_account(db):
    engine = ChurnEngine()
    result = await engine.run(99999, db, force_narrative=False)
    assert result is None
