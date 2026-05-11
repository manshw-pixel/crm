import pytest

@pytest.mark.asyncio
async def test_create_account(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/accounts", json={
        "name": "Acme Corp",
        "tier": "enterprise",
        "arr": "120000.00",
        "industry": "SaaS",
    }, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Acme Corp"
    assert data["tier"] == "enterprise"
    assert data["health_score"] == 50

@pytest.mark.asyncio
async def test_list_accounts(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/accounts", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data

@pytest.mark.asyncio
async def test_get_account(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post("/accounts", json={"name": "Beta Ltd", "tier": "smb"}, headers=headers)
    account_id = create.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == account_id

@pytest.mark.asyncio
async def test_update_account(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post("/accounts", json={"name": "Gamma Inc", "tier": "mid_market"}, headers=headers)
    account_id = create.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"notes": "Updated notes"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == account_id

@pytest.mark.asyncio
async def test_unauthenticated_returns_403(client):
    resp = await client.get("/accounts")
    assert resp.status_code in (401, 403)  # HTTPBearer may return 401 or 403 when Authorization header is missing
