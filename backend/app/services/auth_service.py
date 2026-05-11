from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User
from app.core.security import verify_password, create_access_token, create_refresh_token, hash_password
from datetime import datetime, timezone

_DUMMY_HASH = hash_password("dummy-constant-to-prevent-timing-attacks")

async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email, User.is_active == True))
    user = result.scalar_one_or_none()
    candidate_hash = user.hashed_password if user else _DUMMY_HASH
    if not verify_password(password, candidate_hash) or not user:
        return None
    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    return user

def build_tokens(user: User) -> dict:
    payload = {"sub": str(user.id), "role": user.role.value}
    return {
        "access_token": create_access_token(payload),
        "refresh_token": create_refresh_token(payload),
        "token_type": "bearer",
        "role": user.role.value,
        "user_id": user.id,
    }
