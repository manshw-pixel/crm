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
