import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from app.models import Base
from app.core.database import get_db
from app.main import app
from app.models.user import User, UserRole
from app.core.security import hash_password

TEST_DB_URL = "postgresql+asyncpg://crm:crm@localhost:5432/crm_test"

engine = create_async_engine(TEST_DB_URL)
TestSession = async_sessionmaker(engine, expire_on_commit=False)

@pytest_asyncio.fixture(loop_scope="session", scope="session", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        # Drop with CASCADE to handle circular FKs between users and accounts
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))

@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def db():
    async with TestSession() as session:
        yield session

@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def client(db):
    async def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()

@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def csm_user(db):
    user = User(
        name="Test CSM",
        email="csm@test.com",
        role=UserRole.csm,
        hashed_password=hash_password("password123"),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def admin_user(db):
    user = User(
        name="Test Admin",
        email="admin@test.com",
        role=UserRole.admin,
        hashed_password=hash_password("adminpass"),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
