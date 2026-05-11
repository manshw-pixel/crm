import pytest

@pytest.mark.asyncio
async def test_login_success(client, csm_user):
    resp = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["role"] == "csm"
    assert data["user_id"] == csm_user.id

@pytest.mark.asyncio
async def test_login_wrong_password(client, csm_user):
    resp = await client.post("/auth/login", json={"email": "csm@test.com", "password": "wrong"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_login_unknown_email(client):
    resp = await client.post("/auth/login", json={"email": "nobody@test.com", "password": "x"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_refresh_token(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    refresh_token = login.json()["refresh_token"]
    resp = await client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()

@pytest.mark.asyncio
async def test_refresh_with_access_token_fails(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    access_token = login.json()["access_token"]
    resp = await client.post("/auth/refresh", json={"refresh_token": access_token})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_logout(client):
    resp = await client.post("/auth/logout")
    assert resp.status_code == 204
