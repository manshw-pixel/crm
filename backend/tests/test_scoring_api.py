import pytest
from unittest.mock import patch
from app.models.account import Account, AccountTier
from app.models.user import User, UserRole
from app.core.security import hash_password

@pytest.fixture(scope="session")
async def admin_headers(client, db):
    user = User(name="Admin2", email="admin2@score.test", role=UserRole.admin,
                hashed_password=hash_password("adminpw"), is_active=True)
    db.add(user)
    await db.commit()
    resp = await client.post("/auth/login", json={"email": "admin2@score.test", "password": "adminpw"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="session")
async def csm_headers(client, db):
    user = User(name="CSM3", email="csm3@score.test", role=UserRole.csm,
                hashed_password=hash_password("csmpw"), is_active=True)
    db.add(user)
    await db.commit()
    resp = await client.post("/auth/login", json={"email": "csm3@score.test", "password": "csmpw"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="session")
async def test_account(db):
    acct = Account(name="Score Test Co", tier=AccountTier.smb, csm_sentiment=3, ticket_trend=3)
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    return acct

@pytest.mark.asyncio
async def test_recalculate_returns_score(client, test_account, csm_headers):
    with patch("app.services.scoring_service._engine.run") as mock_run:
        mock_run.return_value = {
            "final_score": 72.5, "rule_score": 72.5, "signal_scores": {},
            "churn_risk_tier": "green", "ml_probability": None,
            "ml_top_features": None, "ai_narrative": None,
        }
        resp = await client.post(
            f"/scoring/recalculate/{test_account.id}",
            json={"force_narrative": False},
            headers=csm_headers,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["final_score"] == 72.5
    assert data["churn_risk_tier"] == "green"

@pytest.mark.asyncio
async def test_recalculate_404_for_missing_account(client, csm_headers):
    with patch("app.services.scoring_service._engine.run", return_value=None):
        resp = await client.post("/scoring/recalculate/99999", json={}, headers=csm_headers)
    assert resp.status_code == 404

@pytest.mark.asyncio
async def test_get_scoring_config_returns_defaults(client, admin_headers):
    resp = await client.get("/scoring/config", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 6

@pytest.mark.asyncio
async def test_patch_scoring_config_requires_admin(client, csm_headers):
    resp = await client.patch("/scoring/config/latest_nps", json={"weight": 0.20}, headers=csm_headers)
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_patch_scoring_config_invalid_signal(client, admin_headers):
    resp = await client.patch("/scoring/config/nonexistent_signal", json={"weight": 0.20}, headers=admin_headers)
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_model_info_when_no_model(client, csm_headers):
    resp = await client.get("/ai/model-info", headers=csm_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "model_loaded" in data
    assert "version" in data

@pytest.mark.asyncio
async def test_narrative_endpoint_force_run(client, test_account, csm_headers):
    with patch("app.api.ai._engine.run") as mock_run:
        mock_run.return_value = {
            "final_score": 55.0, "rule_score": 55.0, "signal_scores": {},
            "churn_risk_tier": "yellow", "ml_probability": None,
            "ml_top_features": None, "ai_narrative": "ASSESSMENT: moderate risk.",
        }
        resp = await client.post(f"/ai/narrative/{test_account.id}", headers=csm_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "ai_narrative" in data
    assert "generated_at" in data

@pytest.mark.asyncio
async def test_train_requires_admin(client, csm_headers, tmp_path):
    csv = tmp_path / "t.csv"
    csv.write_text("col1\n1\n")
    with open(csv, "rb") as f:
        resp = await client.post("/ai/train", files={"training_data": f}, headers=csm_headers)
    assert resp.status_code == 403
