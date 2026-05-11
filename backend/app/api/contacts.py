from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.contact import ContactCreate, ContactUpdate, ContactOut
from app.services import contact_service, account_service

router = APIRouter(tags=["contacts"])

@router.get("/accounts/{account_id}/contacts", response_model=list[ContactOut])
async def list_contacts(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return await contact_service.list_contacts(db, account_id)

@router.post("/accounts/{account_id}/contacts", response_model=ContactOut, status_code=201)
async def create_contact(
    account_id: int,
    body: ContactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return await contact_service.create_contact(db, account_id, body)

@router.get("/contacts/{contact_id}", response_model=ContactOut)
async def get_contact(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = await contact_service.get_contact(db, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact

@router.patch("/contacts/{contact_id}", response_model=ContactOut)
async def update_contact(
    contact_id: int,
    body: ContactUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = await contact_service.get_contact(db, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return await contact_service.update_contact(db, contact, body)

@router.delete("/contacts/{contact_id}", status_code=204)
async def delete_contact(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = await contact_service.get_contact(db, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    await contact_service.delete_contact(db, contact)
