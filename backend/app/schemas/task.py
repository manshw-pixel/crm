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
