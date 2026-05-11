import pytest

async def _get_token_and_account(client, csm_user):
    login = await client.post("/auth/login", json={"email": "csm@test.com", "password": "password123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    acct = await client.post("/accounts", json={"name": "Contact Test Co", "tier": "smb"}, headers=headers)
    return headers, acct.json()["id"]

@pytest.mark.asyncio
async def test_create_contact(client, csm_user):
    headers, account_id = await _get_token_and_account(client, csm_user)
    resp = await client.post(f"/accounts/{account_id}/contacts", json={
        "name": "Jane Doe", "email": "jane@acme.com", "role": "champion", "is_primary": True
    }, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "Jane Doe"
    assert resp.json()["account_id"] == account_id

@pytest.mark.asyncio
async def test_list_contacts(client, csm_user):
    headers, account_id = await _get_token_and_account(client, csm_user)
    await client.post(f"/accounts/{account_id}/contacts", json={"name": "Bob"}, headers=headers)
    resp = await client.get(f"/accounts/{account_id}/contacts", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

@pytest.mark.asyncio
async def test_update_contact(client, csm_user):
    headers, account_id = await _get_token_and_account(client, csm_user)
    create = await client.post(f"/accounts/{account_id}/contacts", json={"name": "Charlie"}, headers=headers)
    contact_id = create.json()["id"]
    resp = await client.patch(f"/contacts/{contact_id}", json={"title": "VP Sales"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["title"] == "VP Sales"

@pytest.mark.asyncio
async def test_delete_contact(client, csm_user):
    headers, account_id = await _get_token_and_account(client, csm_user)
    create = await client.post(f"/accounts/{account_id}/contacts", json={"name": "Delete Me"}, headers=headers)
    contact_id = create.json()["id"]
    resp = await client.delete(f"/contacts/{contact_id}", headers=headers)
    assert resp.status_code == 204
    resp2 = await client.get(f"/contacts/{contact_id}", headers=headers)
    assert resp2.status_code == 404
