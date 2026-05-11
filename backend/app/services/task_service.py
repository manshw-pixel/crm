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
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    await db.commit()
    await db.refresh(task)
    return task

async def delete_task(db: AsyncSession, task: Task) -> None:
    await db.delete(task)
    await db.commit()
