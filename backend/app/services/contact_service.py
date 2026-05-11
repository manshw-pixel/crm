from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.contact import Contact
from app.schemas.contact import ContactCreate, ContactUpdate

async def list_contacts(db: AsyncSession, account_id: int) -> list[Contact]:
    result = await db.execute(select(Contact).where(Contact.account_id == account_id))
    return list(result.scalars().all())

async def get_contact(db: AsyncSession, contact_id: int) -> Contact | None:
    return await db.get(Contact, contact_id)

async def create_contact(db: AsyncSession, account_id: int, data: ContactCreate) -> Contact:
    contact = Contact(account_id=account_id, **data.model_dump(exclude_none=True))
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact

async def update_contact(db: AsyncSession, contact: Contact, data: ContactUpdate) -> Contact:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    await db.commit()
    await db.refresh(contact)
    return contact

async def delete_contact(db: AsyncSession, contact: Contact) -> None:
    await db.delete(contact)
    await db.commit()
