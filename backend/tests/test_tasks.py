import pytest

async def _auth_headers_and_account(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    acct = await client.post("/accounts", json={"name": "Task Test Co", "tier": "smb"}, headers=headers)
    return headers, acct.json()["id"]

@pytest.mark.asyncio
async def test_create_task(client, csm_user):
    headers, account_id = await _auth_headers_and_account(client, csm_user)
    resp = await client.post("/tasks", json={
        "account_id": account_id,
        "title": "Follow up on renewal",
        "priority": "high",
    }, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Follow up on renewal"
    assert data["status"] == "open"
    assert data["source"] == "manual"

@pytest.mark.asyncio
async def test_list_tasks_by_account(client, csm_user):
    headers, account_id = await _auth_headers_and_account(client, csm_user)
    await client.post("/tasks", json={"account_id": account_id, "title": "Task A"}, headers=headers)
    resp = await client.get(f"/tasks?account_id={account_id}", headers=headers)
    assert resp.status_code == 200
    items = resp.json()
    assert any(t["title"] == "Task A" for t in items)

@pytest.mark.asyncio
async def test_update_task_status(client, csm_user):
    headers, account_id = await _auth_headers_and_account(client, csm_user)
    create = await client.post("/tasks", json={"account_id": account_id, "title": "Complete me"}, headers=headers)
    task_id = create.json()["id"]
    resp = await client.patch(f"/tasks/{task_id}", json={"status": "completed"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"

@pytest.mark.asyncio
async def test_delete_task(client, csm_user):
    headers, account_id = await _auth_headers_and_account(client, csm_user)
    create = await client.post("/tasks", json={"account_id": account_id, "title": "Delete me"}, headers=headers)
    task_id = create.json()["id"]
    resp = await client.delete(f"/tasks/{task_id}", headers=headers)
    assert resp.status_code == 204
