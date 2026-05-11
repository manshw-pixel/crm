# CRM Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FastAPI backend for the Customer Success CRM — project scaffolding, all ORM models, Alembic migrations, JWT auth, and core CRUD APIs for accounts, contacts, and tasks.

**Architecture:** Modular FastAPI monolith with SQLAlchemy 2 async ORM, PostgreSQL, and Redis. Routes are grouped by domain under `app/api/`. Business logic lives in `app/services/`. Auth uses stateless JWT with role claims. Docker Compose wires up all services locally.

**Tech Stack:** Python 3.11, FastAPI 0.111, SQLAlchemy 2.0 (async + asyncpg), Alembic, Pydantic v2, python-jose, passlib[bcrypt], ARQ, Redis, PostgreSQL 16, Docker Compose, pytest + httpx

---

## File Map

```
backend/
├── app/
│   ├── main.py                        # FastAPI app factory, router registration
│   ├── core/
│   │   ├── config.py                  # Settings via pydantic-settings
│   │   ├── database.py                # Async engine, session factory, get_db dependency
│   │   ├── security.py                # JWT encode/decode, bcrypt hash/verify
│   │   └── dependencies.py            # get_current_user, require_role helpers
│   ├── models/
│   │   ├── __init__.py                # Re-exports all models (needed by Alembic)
│   │   ├── base.py                    # DeclarativeBase, TimestampMixin
│   │   ├── user.py                    # User model
│   │   ├── account.py                 # Account model
│   │   ├── contact.py                 # Contact model
│   │   ├── task.py                    # Task model
│   │   ├── activity.py                # Activity model
│   │   ├── health_score_log.py        # HealthScoreLog model
│   │   ├── meeting_note.py            # MeetingNote model
│   │   ├── success_plan.py            # SuccessPlan + Milestone + MilestoneComment
│   │   ├── playbook.py                # PlaybookTemplate + PlaybookRun
│   │   ├── opportunity.py             # Opportunity model
│   │   └── survey.py                  # Survey model
│   ├── schemas/
│   │   ├── auth.py                    # LoginRequest, TokenResponse
│   │   ├── user.py                    # UserOut
│   │   ├── account.py                 # AccountCreate, AccountUpdate, AccountOut, AccountDetail
│   │   ├── contact.py                 # ContactCreate, ContactUpdate, ContactOut
│   │   └── task.py                    # TaskCreate, TaskUpdate, TaskOut
│   ├── api/
│   │   ├── auth.py                    # POST /auth/login, /auth/refresh, /auth/logout
│   │   ├── accounts.py                # Account CRUD + health stub + timeline stub
│   │   ├── contacts.py                # Contact CRUD
│   │   └── tasks.py                   # Task CRUD
│   └── services/
│       ├── auth_service.py            # authenticate_user, create_tokens
│       ├── account_service.py         # list_accounts, get_account, create_account, update_account
│       ├── contact_service.py         # list_contacts, create_contact, update_contact, delete_contact
│       └── task_service.py            # list_tasks, create_task, update_task, delete_task
├── migrations/
│   ├── env.py                         # Alembic async env
│   └── versions/                      # Auto-generated migration files
├── tests/
│   ├── conftest.py                    # pytest fixtures: async engine, test db, client, seed users
│   ├── test_auth.py
│   ├── test_accounts.py
│   ├── test_contacts.py
│   └── test_tasks.py
├── alembic.ini
├── requirements.txt
├── Dockerfile
└── .env.example
docker-compose.yml                     # (repo root)
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/alembic.ini`
- Create: `docker-compose.yml`
- Create: `backend/app/__init__.py` (empty)
- Create: `backend/app/core/__init__.py` (empty)
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/__init__.py` (empty)
- Create: `backend/app/api/__init__.py` (empty)
- Create: `backend/app/services/__init__.py` (empty)
- Create: `backend/Dockerfile`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
sqlalchemy==2.0.30
asyncpg==0.29.0
alembic==1.13.1
pydantic==2.7.1
pydantic-settings==2.2.1
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
httpx==0.27.0
pytest==8.2.0
pytest-asyncio==0.23.6
arq==0.25.0
redis==5.0.4
```

Save to `backend/requirements.txt`.

- [ ] **Step 2: Create .env.example**

```ini
DATABASE_URL=postgresql+asyncpg://crm:crm@localhost:5432/crm
REDIS_URL=redis://localhost:6379
SECRET_KEY=changeme-use-openssl-rand-hex-32
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
ANTHROPIC_API_KEY=sk-ant-...
```

Save to `backend/.env.example`. Copy to `backend/.env` and fill in real values.

- [ ] **Step 3: Create docker-compose.yml at repo root**

```yaml
version: "3.9"
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: crm
      POSTGRES_PASSWORD: crm
      POSTGRES_DB: crm
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    volumes:
      - ./backend:/app
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    depends_on:
      - db
      - redis

volumes:
  postgres_data:
```

- [ ] **Step 4: Create Dockerfile**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Save to `backend/Dockerfile`.

- [ ] **Step 5: Create alembic.ini**

```ini
[alembic]
script_location = migrations
sqlalchemy.url = driver://user:pass@localhost/dbname

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

Save to `backend/alembic.ini`.

- [ ] **Step 6: Create all empty `__init__.py` files**

Create these empty files:
- `backend/app/__init__.py`
- `backend/app/core/__init__.py`
- `backend/app/schemas/__init__.py`
- `backend/app/api/__init__.py`
- `backend/app/services/__init__.py`

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold backend project structure"
```

---

## Task 2: Core Config, Database, Security

**Files:**
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/database.py`
- Create: `backend/app/core/security.py`

- [ ] **Step 1: Write failing test for config**

Create `backend/tests/test_config.py`:

```python
from app.core.config import settings

def test_settings_has_required_fields():
    assert settings.DATABASE_URL
    assert settings.SECRET_KEY
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES > 0
```

Run: `cd backend && pytest tests/test_config.py -v`
Expected: ImportError (module not defined yet)

- [ ] **Step 2: Implement config.py**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ANTHROPIC_API_KEY: str = ""
    ALGORITHM: str = "HS256"

    class Config:
        env_file = ".env"

settings = Settings()
```

Save to `backend/app/core/config.py`.

- [ ] **Step 3: Run config test**

```bash
cd backend && pytest tests/test_config.py -v
```
Expected: PASS

- [ ] **Step 4: Write failing test for security**

Append to a new file `backend/tests/test_security.py`:

```python
from app.core.security import hash_password, verify_password, create_access_token, decode_token

def test_hash_and_verify_password():
    hashed = hash_password("secret")
    assert verify_password("secret", hashed)
    assert not verify_password("wrong", hashed)

def test_create_and_decode_access_token():
    token = create_access_token({"sub": "42", "role": "csm"})
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "csm"

def test_decode_token_invalid_raises():
    import pytest
    with pytest.raises(Exception):
        decode_token("not.a.valid.token")
```

Run: `cd backend && pytest tests/test_security.py -v`
Expected: ImportError

- [ ] **Step 5: Implement security.py**

```python
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    to_encode["type"] = "access"
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode["exp"] = expire
    to_encode["type"] = "refresh"
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}")
```

Save to `backend/app/core/security.py`.

- [ ] **Step 6: Run security tests**

```bash
cd backend && pytest tests/test_security.py -v
```
Expected: 3 PASS

- [ ] **Step 7: Create database.py**

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

Save to `backend/app/core/database.py`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/core/ backend/tests/test_config.py backend/tests/test_security.py
git commit -m "feat: add core config, security, and database session"
```

---

## Task 3: ORM Models — Base + User + Account

**Files:**
- Create: `backend/app/models/base.py`
- Create: `backend/app/models/user.py`
- Create: `backend/app/models/account.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create base.py**

```python
import uuid
from datetime import datetime, timezone
from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

Save to `backend/app/models/base.py`.

- [ ] **Step 2: Create user.py**

```python
import enum
from sqlalchemy import String, Boolean, Enum as SAEnum, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin
import uuid
from datetime import datetime

class UserRole(str, enum.Enum):
    admin = "admin"
    csm = "csm"
    ae = "ae"
    customer = "customer"

class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Save to `backend/app/models/user.py`.

- [ ] **Step 3: Create account.py**

```python
import enum
from sqlalchemy import String, Integer, Numeric, Date, ForeignKey, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin
from datetime import date
from decimal import Decimal

class AccountTier(str, enum.Enum):
    smb = "smb"
    mid_market = "mid_market"
    enterprise = "enterprise"

class ChurnRiskTier(str, enum.Enum):
    green = "green"
    yellow = "yellow"
    red = "red"

class Account(Base, TimestampMixin):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    tier: Mapped[AccountTier] = mapped_column(SAEnum(AccountTier), nullable=False)
    arr: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    mrr: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    contract_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    csm_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    ae_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    health_score: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    churn_risk_tier: Mapped[ChurnRiskTier] = mapped_column(
        SAEnum(ChurnRiskTier), default=ChurnRiskTier.yellow, nullable=False
    )
    industry: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employee_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Save to `backend/app/models/account.py`.

- [ ] **Step 4: Update models/__init__.py**

```python
from app.models.base import Base
from app.models.user import User, UserRole
from app.models.account import Account, AccountTier, ChurnRiskTier
```

- [ ] **Step 5: Write failing model test**

Create `backend/tests/test_models.py`:

```python
from app.models.user import User, UserRole
from app.models.account import Account, AccountTier, ChurnRiskTier

def test_user_model_tablename():
    assert User.__tablename__ == "users"

def test_account_model_tablename():
    assert Account.__tablename__ == "accounts"

def test_user_role_values():
    assert set(UserRole) == {"admin", "csm", "ae", "customer"}

def test_churn_risk_tier_values():
    assert set(ChurnRiskTier) == {"green", "yellow", "red"}
```

Run: `cd backend && pytest tests/test_models.py -v`
Expected: ImportError

- [ ] **Step 6: Run model tests**

```bash
cd backend && pytest tests/test_models.py -v
```
Expected: 4 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/ backend/tests/test_models.py
git commit -m "feat: add User and Account ORM models"
```

---

## Task 4: ORM Models — Remaining Tables

**Files:**
- Create: `backend/app/models/contact.py`
- Create: `backend/app/models/task.py`
- Create: `backend/app/models/activity.py`
- Create: `backend/app/models/health_score_log.py`
- Create: `backend/app/models/meeting_note.py`
- Create: `backend/app/models/success_plan.py`
- Create: `backend/app/models/playbook.py`
- Create: `backend/app/models/opportunity.py`
- Create: `backend/app/models/survey.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create contact.py**

```python
import enum
from sqlalchemy import String, Integer, ForeignKey, DateTime, Boolean, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import datetime

class ContactRole(str, enum.Enum):
    champion = "champion"
    economic_buyer = "economic_buyer"
    influencer = "influencer"
    detractor = "detractor"
    end_user = "end_user"

class Contact(Base, TimestampMixin):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[ContactRole | None] = mapped_column(SAEnum(ContactRole), nullable=True)
    influence_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_engaged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

Save to `backend/app/models/contact.py`.

- [ ] **Step 2: Create task.py**

```python
import enum
from sqlalchemy import String, Text, ForeignKey, Date, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import date

class TaskPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"

class TaskStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"

class TaskSource(str, enum.Enum):
    manual = "manual"
    playbook = "playbook"

class Task(Base, TimestampMixin):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[TaskPriority] = mapped_column(SAEnum(TaskPriority), default=TaskPriority.medium, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus), default=TaskStatus.open, nullable=False)
    source: Mapped[TaskSource] = mapped_column(SAEnum(TaskSource), default=TaskSource.manual, nullable=False)
    playbook_run_id: Mapped[int | None] = mapped_column(ForeignKey("playbook_runs.id"), nullable=True)
```

Save to `backend/app/models/task.py`.

- [ ] **Step 3: Create activity.py**

```python
import enum
from sqlalchemy import String, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin

class ActivityType(str, enum.Enum):
    note = "note"
    meeting = "meeting"
    task_completed = "task_completed"
    email = "email"
    playbook_triggered = "playbook_triggered"
    score_change = "score_change"
    survey = "survey"

class Activity(Base, TimestampMixin):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    type: Mapped[ActivityType] = mapped_column(SAEnum(ActivityType), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
```

Save to `backend/app/models/activity.py`.

- [ ] **Step 4: Create health_score_log.py**

```python
import enum
from sqlalchemy import Integer, Float, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base
from datetime import datetime
from sqlalchemy import DateTime, Index

class ScoreTrigger(str, enum.Enum):
    manual = "manual"
    auto = "auto"
    job = "job"

class HealthScoreLog(Base):
    __tablename__ = "health_score_logs"
    __table_args__ = (Index("ix_hsl_account_created", "account_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    rule_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ml_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ml_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[ScoreTrigger] = mapped_column(SAEnum(ScoreTrigger), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

Save to `backend/app/models/health_score_log.py`.

- [ ] **Step 5: Create meeting_note.py**

```python
from sqlalchemy import String, Text, ForeignKey, Date
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import date

class MeetingNote(Base, TimestampMixin):
    __tablename__ = "meeting_notes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    meeting_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    attendees: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    agenda: Mapped[str | None] = mapped_column(Text, nullable=True)
    decisions: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_items: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    next_steps: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
```

Save to `backend/app/models/meeting_note.py`.

- [ ] **Step 6: Create success_plan.py**

```python
import enum
from sqlalchemy import String, Text, ForeignKey, Boolean, Integer, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import date
from sqlalchemy import Date

class PlanStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    completed = "completed"

class MilestoneStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    completed = "completed"
    blocked = "blocked"

class SuccessPlan(Base, TimestampMixin):
    __tablename__ = "success_plans"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[PlanStatus] = mapped_column(SAEnum(PlanStatus), default=PlanStatus.draft, nullable=False)
    visible_to_customer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

class Milestone(Base, TimestampMixin):
    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    success_plan_id: Mapped[int] = mapped_column(ForeignKey("success_plans.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    customer_assignee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[MilestoneStatus] = mapped_column(SAEnum(MilestoneStatus), default=MilestoneStatus.not_started, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

class MilestoneComment(Base, TimestampMixin):
    __tablename__ = "milestone_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    milestone_id: Mapped[int] = mapped_column(ForeignKey("milestones.id"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    authored_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    authored_by_contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id"), nullable=True)
```

Save to `backend/app/models/success_plan.py`.

- [ ] **Step 7: Create playbook.py**

```python
import enum
from sqlalchemy import String, Text, ForeignKey, Boolean, Numeric, Integer, DateTime, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from datetime import datetime

class PlaybookTriggerType(str, enum.Enum):
    score_drop = "score_drop"
    no_activity = "no_activity"
    renewal_approaching = "renewal_approaching"
    nps_below = "nps_below"
    manual = "manual"

class PlaybookRunStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    failed = "failed"

class PlaybookTemplate(Base, TimestampMixin):
    __tablename__ = "playbook_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    trigger_type: Mapped[PlaybookTriggerType] = mapped_column(SAEnum(PlaybookTriggerType), nullable=False)
    trigger_threshold: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    trigger_window_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

class PlaybookRun(Base):
    __tablename__ = "playbook_runs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    playbook_template_id: Mapped[int] = mapped_column(ForeignKey("playbook_templates.id"), nullable=False)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    triggered_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[PlaybookRunStatus] = mapped_column(SAEnum(PlaybookRunStatus), default=PlaybookRunStatus.running, nullable=False)
    actions_taken: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Save to `backend/app/models/playbook.py`.

- [ ] **Step 8: Create opportunity.py**

```python
import enum
from sqlalchemy import String, Text, ForeignKey, Integer, Numeric, Date, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
from decimal import Decimal
from datetime import date

class OpportunityType(str, enum.Enum):
    upsell = "upsell"
    expansion = "expansion"
    renewal = "renewal"
    cross_sell = "cross_sell"

class OpportunityStage(str, enum.Enum):
    identified = "identified"
    qualified = "qualified"
    proposed = "proposed"
    negotiating = "negotiating"
    closed_won = "closed_won"
    closed_lost = "closed_lost"

class Opportunity(Base, TimestampMixin):
    __tablename__ = "opportunities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    type: Mapped[OpportunityType] = mapped_column(SAEnum(OpportunityType), nullable=False)
    stage: Mapped[OpportunityStage] = mapped_column(SAEnum(OpportunityStage), default=OpportunityStage.identified, nullable=False)
    value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    probability: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expected_close_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Save to `backend/app/models/opportunity.py`.

- [ ] **Step 9: Create survey.py**

```python
import enum
from sqlalchemy import String, Text, ForeignKey, Integer, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base
from datetime import datetime

class SurveyType(str, enum.Enum):
    nps = "nps"
    csat = "csat"
    custom = "custom"

class Survey(Base):
    __tablename__ = "surveys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    type: Mapped[SurveyType] = mapped_column(SAEnum(SurveyType), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_by_contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

Save to `backend/app/models/survey.py`.

- [ ] **Step 10: Update models/__init__.py**

```python
from app.models.base import Base
from app.models.user import User, UserRole
from app.models.account import Account, AccountTier, ChurnRiskTier
from app.models.contact import Contact, ContactRole
from app.models.task import Task, TaskPriority, TaskStatus, TaskSource
from app.models.activity import Activity, ActivityType
from app.models.health_score_log import HealthScoreLog, ScoreTrigger
from app.models.meeting_note import MeetingNote
from app.models.success_plan import SuccessPlan, Milestone, MilestoneComment, PlanStatus, MilestoneStatus
from app.models.playbook import PlaybookTemplate, PlaybookRun, PlaybookTriggerType, PlaybookRunStatus
from app.models.opportunity import Opportunity, OpportunityType, OpportunityStage
from app.models.survey import Survey, SurveyType
```

- [ ] **Step 11: Run all model import tests**

```bash
cd backend && python -c "from app.models import *; print('All models imported OK')"
```
Expected: `All models imported OK`

- [ ] **Step 12: Commit**

```bash
git add backend/app/models/
git commit -m "feat: add all ORM models (contacts, tasks, activities, health logs, success plans, playbooks, opportunities, surveys)"
```

---

## Task 5: Alembic Migrations

**Files:**
- Create: `backend/migrations/env.py`
- Create: `backend/migrations/script.py.mako`
- Create: `backend/migrations/versions/` (auto-generated)

- [ ] **Step 1: Initialize Alembic**

```bash
cd backend && alembic init migrations
```
This creates `migrations/env.py` and `migrations/script.py.mako`.

- [ ] **Step 2: Replace migrations/env.py**

Replace the full contents of `backend/migrations/env.py` with:

```python
import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context
from app.core.config import settings
from app.models import Base  # noqa: F401 — imports all models for autogenerate

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()

def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 3: Start the database**

```bash
docker compose up db -d
```

Wait ~5 seconds for Postgres to be ready.

- [ ] **Step 4: Generate the initial migration**

```bash
cd backend && alembic revision --autogenerate -m "initial schema"
```
Expected: a new file created under `migrations/versions/` with all table definitions.

- [ ] **Step 5: Apply the migration**

```bash
cd backend && alembic upgrade head
```
Expected: output showing each table being created, ending with `Running upgrade -> <revision>, initial schema`

- [ ] **Step 6: Verify tables exist**

```bash
docker exec -it $(docker compose ps -q db) psql -U crm -d crm -c "\dt"
```
Expected: list of ~12 tables (accounts, users, contacts, tasks, activities, etc.)

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/ backend/alembic.ini
git commit -m "feat: add Alembic migrations for initial schema"
```

---

## Task 6: Auth Service + Endpoints

**Files:**
- Create: `backend/app/schemas/auth.py`
- Create: `backend/app/schemas/user.py`
- Create: `backend/app/services/auth_service.py`
- Create: `backend/app/core/dependencies.py`
- Create: `backend/app/api/auth.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Create schemas/auth.py**

```python
from pydantic import BaseModel, EmailStr

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user_id: int

class RefreshRequest(BaseModel):
    refresh_token: str
```

Save to `backend/app/schemas/auth.py`.

- [ ] **Step 2: Create schemas/user.py**

```python
from pydantic import BaseModel
from app.models.user import UserRole

class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    is_active: bool

    model_config = {"from_attributes": True}
```

Save to `backend/app/schemas/user.py`.

- [ ] **Step 3: Create services/auth_service.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from datetime import datetime, timezone

async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email, User.is_active == True))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.hashed_password):
        user.last_login = datetime.now(timezone.utc)
        await db.commit()
        return user
    return None

def build_tokens(user: User) -> dict:
    payload = {"sub": str(user.id), "role": user.role.value}
    return {
        "access_token": create_access_token(payload),
        "refresh_token": create_refresh_token(payload),
        "token_type": "bearer",
        "role": user.role.value,
        "user_id": user.id,
    }
```

Save to `backend/app/services/auth_service.py`.

- [ ] **Step 4: Create core/dependencies.py**

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole

bearer = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token")
    result = await db.execute(select(User).where(User.id == int(payload["sub"]), User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

def require_roles(*roles: UserRole):
    async def check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user
    return check
```

Save to `backend/app/core/dependencies.py`.

- [ ] **Step 5: Create api/auth.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import decode_token, create_access_token, create_refresh_token
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.services.auth_service import authenticate_user, build_tokens

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return build_tokens(user)

@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")
    from sqlalchemy import select
    from app.models.user import User
    result = await db.execute(select(User).where(User.id == int(payload["sub"]), User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return build_tokens(user)

@router.post("/logout", status_code=204)
async def logout():
    # Stateless JWT: client discards token. No server-side action.
    return
```

Save to `backend/app/api/auth.py`.

- [ ] **Step 6: Create main.py**

```python
from fastapi import FastAPI
from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.contacts import router as contacts_router
from app.api.tasks import router as tasks_router

app = FastAPI(title="CRM API", version="0.1.0")

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(contacts_router)
app.include_router(tasks_router)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

Save to `backend/app/main.py`.

Note: The accounts/contacts/tasks routers are created in subsequent tasks — temporarily stub them if needed to make imports work.

- [ ] **Step 7: Create tests/conftest.py**

```python
import asyncio
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base
from app.core.database import get_db
from app.main import app
from app.models.user import User, UserRole
from app.core.security import hash_password

TEST_DB_URL = "postgresql+asyncpg://crm:crm@localhost:5432/crm_test"

engine = create_async_engine(TEST_DB_URL)
TestSession = async_sessionmaker(engine, expire_on_commit=False)

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture
async def db():
    async with TestSession() as session:
        yield session

@pytest_asyncio.fixture
async def client(db):
    async def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()

@pytest_asyncio.fixture
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

@pytest_asyncio.fixture
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
```

Add `pytest.ini` at `backend/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
```

- [ ] **Step 8: Create a test database**

```bash
docker exec -it $(docker compose ps -q db) psql -U crm -c "CREATE DATABASE crm_test;"
```

- [ ] **Step 9: Write failing auth tests**

Create `backend/tests/test_auth.py`:

```python
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
```

Run: `cd backend && pytest tests/test_auth.py -v`
Expected: FAIL (routers not all wired yet)

- [ ] **Step 10: Stub missing routers so main.py imports succeed**

Create minimal stubs (will be replaced in Tasks 7–9):

`backend/app/api/accounts.py`:
```python
from fastapi import APIRouter
router = APIRouter(prefix="/accounts", tags=["accounts"])
```

`backend/app/api/contacts.py`:
```python
from fastapi import APIRouter
router = APIRouter(prefix="/contacts", tags=["contacts"])
```

`backend/app/api/tasks.py`:
```python
from fastapi import APIRouter
router = APIRouter(prefix="/tasks", tags=["tasks"])
```

- [ ] **Step 11: Run auth tests**

```bash
cd backend && pytest tests/test_auth.py -v
```
Expected: 6 PASS

- [ ] **Step 12: Commit**

```bash
git add backend/app/ backend/tests/ backend/pytest.ini
git commit -m "feat: add auth service, JWT dependencies, login/refresh/logout endpoints"
```

---

## Task 7: Accounts API

**Files:**
- Create: `backend/app/schemas/account.py`
- Replace: `backend/app/api/accounts.py`
- Create: `backend/app/services/account_service.py`
- Create: `backend/tests/test_accounts.py`

- [ ] **Step 1: Create schemas/account.py**

```python
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal
from datetime import date, datetime
from app.models.account import AccountTier, ChurnRiskTier

class AccountCreate(BaseModel):
    name: str
    tier: AccountTier
    arr: Optional[Decimal] = None
    mrr: Optional[Decimal] = None
    contract_start: Optional[date] = None
    renewal_date: Optional[date] = None
    csm_id: Optional[int] = None
    ae_id: Optional[int] = None
    industry: Optional[str] = None
    employee_count: Optional[int] = None
    notes: Optional[str] = None

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    tier: Optional[AccountTier] = None
    arr: Optional[Decimal] = None
    mrr: Optional[Decimal] = None
    contract_start: Optional[date] = None
    renewal_date: Optional[date] = None
    csm_id: Optional[int] = None
    ae_id: Optional[int] = None
    health_score: Optional[int] = None
    churn_risk_tier: Optional[ChurnRiskTier] = None
    industry: Optional[str] = None
    employee_count: Optional[int] = None
    notes: Optional[str] = None

class AccountOut(BaseModel):
    id: int
    name: str
    tier: AccountTier
    arr: Optional[Decimal] = None
    mrr: Optional[Decimal] = None
    renewal_date: Optional[date] = None
    csm_id: Optional[int] = None
    ae_id: Optional[int] = None
    health_score: int
    churn_risk_tier: ChurnRiskTier
    industry: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class AccountListResponse(BaseModel):
    items: list[AccountOut]
    total: int
    page: int
    page_size: int
```

Save to `backend/app/schemas/account.py`.

- [ ] **Step 2: Write failing accounts tests**

Create `backend/tests/test_accounts.py`:

```python
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
async def test_unauthenticated_returns_401(client):
    resp = await client.get("/accounts")
    assert resp.status_code == 403  # HTTPBearer returns 403 when no credentials
```

Run: `cd backend && pytest tests/test_accounts.py -v`
Expected: FAIL (router is a stub)

- [ ] **Step 3: Create services/account_service.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.account import Account
from app.schemas.account import AccountCreate, AccountUpdate

async def list_accounts(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 25,
    csm_id: int | None = None,
    risk_tier: str | None = None,
) -> tuple[list[Account], int]:
    q = select(Account)
    if csm_id:
        q = q.where(Account.csm_id == csm_id)
    if risk_tier:
        q = q.where(Account.churn_risk_tier == risk_tier)
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()
    q = q.offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()
    return list(items), total

async def get_account(db: AsyncSession, account_id: int) -> Account | None:
    return await db.get(Account, account_id)

async def create_account(db: AsyncSession, data: AccountCreate) -> Account:
    account = Account(**data.model_dump(exclude_none=True))
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account

async def update_account(db: AsyncSession, account: Account, data: AccountUpdate) -> Account:
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account
```

Save to `backend/app/services/account_service.py`.

- [ ] **Step 4: Implement api/accounts.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.account import AccountCreate, AccountUpdate, AccountOut, AccountListResponse
from app.services import account_service

router = APIRouter(prefix="/accounts", tags=["accounts"])

@router.get("", response_model=AccountListResponse)
async def list_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    csm_id: int | None = Query(None),
    risk_tier: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, total = await account_service.list_accounts(db, page, page_size, csm_id, risk_tier)
    return AccountListResponse(items=items, total=total, page=page, page_size=page_size)

@router.post("", response_model=AccountOut, status_code=201)
async def create_account(
    body: AccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await account_service.create_account(db, body)

@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int,
    body: AccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return await account_service.update_account(db, account, body)

@router.get("/{account_id}/health")
async def get_account_health(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return {
        "account_id": account_id,
        "health_score": account.health_score,
        "churn_risk_tier": account.churn_risk_tier,
        "rule_score": None,
        "ml_score": None,
        "ml_confidence": None,
        "ai_narrative": None,
        "trend_90d": [],
    }

@router.get("/{account_id}/timeline")
async def get_account_timeline(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"account_id": account_id, "items": []}
```

Save to `backend/app/api/accounts.py`.

- [ ] **Step 5: Run accounts tests**

```bash
cd backend && pytest tests/test_accounts.py -v
```
Expected: 5 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/account.py backend/app/api/accounts.py backend/app/services/account_service.py backend/tests/test_accounts.py
git commit -m "feat: add accounts CRUD API with list/get/create/update + health and timeline stubs"
```

---

## Task 8: Contacts API

**Files:**
- Create: `backend/app/schemas/contact.py`
- Replace: `backend/app/api/contacts.py`
- Create: `backend/app/services/contact_service.py`
- Create: `backend/tests/test_contacts.py`

- [ ] **Step 1: Create schemas/contact.py**

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.contact import ContactRole

class ContactCreate(BaseModel):
    name: str
    email: Optional[str] = None
    title: Optional[str] = None
    role: Optional[ContactRole] = None
    influence_rating: Optional[int] = None
    is_primary: bool = False

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    title: Optional[str] = None
    role: Optional[ContactRole] = None
    influence_rating: Optional[int] = None
    is_primary: Optional[bool] = None

class ContactOut(BaseModel):
    id: int
    account_id: int
    name: str
    email: Optional[str] = None
    title: Optional[str] = None
    role: Optional[ContactRole] = None
    influence_rating: Optional[int] = None
    is_primary: bool
    created_at: datetime

    model_config = {"from_attributes": True}
```

Save to `backend/app/schemas/contact.py`.

- [ ] **Step 2: Write failing contact tests**

Create `backend/tests/test_contacts.py`:

```python
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
```

Run: `cd backend && pytest tests/test_contacts.py -v`
Expected: FAIL

- [ ] **Step 3: Create services/contact_service.py**

```python
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
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(contact, field, value)
    await db.commit()
    await db.refresh(contact)
    return contact

async def delete_contact(db: AsyncSession, contact: Contact) -> None:
    await db.delete(contact)
    await db.commit()
```

Save to `backend/app/services/contact_service.py`.

- [ ] **Step 4: Implement api/contacts.py**

```python
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
```

Save to `backend/app/api/contacts.py`.

- [ ] **Step 5: Run contacts tests**

```bash
cd backend && pytest tests/test_contacts.py -v
```
Expected: 4 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/contact.py backend/app/api/contacts.py backend/app/services/contact_service.py backend/tests/test_contacts.py
git commit -m "feat: add contacts CRUD API (nested under accounts)"
```

---

## Task 9: Tasks API

**Files:**
- Create: `backend/app/schemas/task.py`
- Replace: `backend/app/api/tasks.py`
- Create: `backend/app/services/task_service.py`
- Create: `backend/tests/test_tasks.py`

- [ ] **Step 1: Create schemas/task.py**

```python
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from app.models.task import TaskPriority, TaskStatus, TaskSource

class TaskCreate(BaseModel):
    account_id: int
    title: str
    description: Optional[str] = None
    priority: TaskPriority = TaskPriority.medium
    due_date: Optional[date] = None
    owner_id: Optional[int] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[TaskPriority] = None
    due_date: Optional[date] = None
    owner_id: Optional[int] = None
    status: Optional[TaskStatus] = None

class TaskOut(BaseModel):
    id: int
    account_id: int
    title: str
    description: Optional[str] = None
    priority: TaskPriority
    due_date: Optional[date] = None
    owner_id: Optional[int] = None
    status: TaskStatus
    source: TaskSource
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

Save to `backend/app/schemas/task.py`.

- [ ] **Step 2: Write failing task tests**

Create `backend/tests/test_tasks.py`:

```python
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
```

Run: `cd backend && pytest tests/test_tasks.py -v`
Expected: FAIL

- [ ] **Step 3: Create services/task_service.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate

async def list_tasks(
    db: AsyncSession,
    account_id: int | None = None,
    owner_id: int | None = None,
    status: str | None = None,
) -> list[Task]:
    q = select(Task)
    if account_id:
        q = q.where(Task.account_id == account_id)
    if owner_id:
        q = q.where(Task.owner_id == owner_id)
    if status:
        q = q.where(Task.status == status)
    result = await db.execute(q)
    return list(result.scalars().all())

async def get_task(db: AsyncSession, task_id: int) -> Task | None:
    return await db.get(Task, task_id)

async def create_task(db: AsyncSession, data: TaskCreate) -> Task:
    task = Task(**data.model_dump(exclude_none=True))
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task

async def update_task(db: AsyncSession, task: Task, data: TaskUpdate) -> Task:
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(task, field, value)
    await db.commit()
    await db.refresh(task)
    return task

async def delete_task(db: AsyncSession, task: Task) -> None:
    await db.delete(task)
    await db.commit()
```

Save to `backend/app/services/task_service.py`.

- [ ] **Step 4: Implement api/tasks.py**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut
from app.services import task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.get("", response_model=list[TaskOut])
async def list_tasks(
    account_id: int | None = Query(None),
    owner_id: int | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await task_service.list_tasks(db, account_id, owner_id, status)

@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    body: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await task_service.create_task(db, body)

@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: int,
    body: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return await task_service.update_task(db, task, body)

@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await task_service.delete_task(db, task)
```

Save to `backend/app/api/tasks.py`.

- [ ] **Step 5: Run tasks tests**

```bash
cd backend && pytest tests/test_tasks.py -v
```
Expected: 4 PASS

- [ ] **Step 6: Run the full test suite**

```bash
cd backend && pytest -v
```
Expected: All tests PASS (auth + accounts + contacts + tasks)

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/task.py backend/app/api/tasks.py backend/app/services/task_service.py backend/tests/test_tasks.py
git commit -m "feat: add tasks CRUD API with account/owner/status filters"
```

---

## Task 10: Smoke Test End-to-End with Docker

- [ ] **Step 1: Build and start all services**

```bash
docker compose up --build -d
```

- [ ] **Step 2: Run Alembic migrations inside container**

```bash
docker compose exec backend alembic upgrade head
```
Expected: migrations applied cleanly

- [ ] **Step 3: Verify health endpoint**

```bash
curl http://localhost:8000/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 4: Create a test user via psql**

```bash
docker compose exec db psql -U crm -d crm -c "
INSERT INTO users (name, email, role, hashed_password, is_active, created_at, updated_at)
VALUES ('Admin User', 'admin@company.com', 'admin', '\$2b\$12\$placeholder_replace_with_real_hash', true, now(), now());
"
```

To get a real bcrypt hash, run:
```bash
docker compose exec backend python -c "from app.core.security import hash_password; print(hash_password('admin123'))"
```
Then use that hash in the INSERT above.

- [ ] **Step 5: Test login via curl**

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"admin123"}'
```
Expected: JSON response with `access_token` and `role: "admin"`

- [ ] **Step 6: Create an account via the API**

```bash
TOKEN="<paste access_token here>"
curl -X POST http://localhost:8000/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","tier":"enterprise","arr":250000}'
```
Expected: 201 with account JSON

- [ ] **Step 7: View OpenAPI docs**

Open: http://localhost:8000/docs

Verify all routes appear: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/accounts`, `/contacts`, `/tasks`, `/health`.

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "chore: backend foundation complete — auth, accounts, contacts, tasks APIs, Docker Compose verified"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] FastAPI project setup → Task 1
- [x] PostgreSQL + Docker Compose → Tasks 1, 5
- [x] All ORM models (User, Account, Contact, Task, Activity, HealthScoreLog, MeetingNote, SuccessPlan, Milestone, MilestoneComment, PlaybookTemplate, PlaybookRun, Opportunity, Survey) → Tasks 3–4
- [x] Alembic migrations → Task 5
- [x] JWT auth (login / refresh / logout) → Task 6
- [x] Role-based access (admin / csm / ae / customer) → Task 6 (`require_roles`)
- [x] bcrypt password hashing → Task 2
- [x] Accounts API (list, create, get, patch, health stub, timeline stub) → Task 7
- [x] Contacts API (list, create, update, delete nested under accounts) → Task 8
- [x] Tasks API (list with filters, create, update, delete) → Task 9
- [x] Health endpoint stub returns structured placeholder → Task 7
- [x] Redis in Docker Compose → Task 1 (ARQ jobs deferred to AI engine phase)
- [x] End-to-end Docker smoke test → Task 10

**Out of scope (per spec v1 — not in this plan):**
- AI churn engine (rule engine, ML, Claude narrative) — separate plan
- Playbook CRUD/trigger endpoints — separate plan
- Opportunities, surveys, success plans APIs — separate plan
- Background jobs (ARQ) — separate plan
- Customer portal endpoints — separate plan
- Frontend — separate plan
