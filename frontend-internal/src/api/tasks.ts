import { client } from './client'
import type { TaskOut, TaskCreate, TaskUpdate } from '@/types/api'

export interface TaskListParams {
  account_id?: number
  owner_id?: number
  status?: string
}

export const listTasks = async (params: TaskListParams = {}): Promise<TaskOut[]> => {
  const res = await client.get<TaskOut[]>('/tasks', { params })
  return res.data
}

export const createTask = async (data: TaskCreate): Promise<TaskOut> => {
  const res = await client.post<TaskOut>('/tasks', data)
  return res.data
}

export const updateTask = async (id: number, data: TaskUpdate): Promise<TaskOut> => {
  const res = await client.patch<TaskOut>(`/tasks/${id}`, data)
  return res.data
}

export const deleteTask = async (id: number): Promise<void> => {
  await client.delete(`/tasks/${id}`)
}
