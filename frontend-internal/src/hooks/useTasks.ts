import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listTasks, createTask, updateTask, deleteTask, type TaskListParams } from '@/api/tasks'
import type { TaskCreate, TaskUpdate } from '@/types/api'

export const useTasks = (params: TaskListParams = {}) =>
  useQuery({
    queryKey: ['tasks', params],
    queryFn: () => listTasks(params),
    staleTime: 0,
  })

export const useCreateTask = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TaskCreate) => createTask(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', { account_id: accountId }] }),
  })
}

export const useUpdateTask = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: TaskUpdate }) => updateTask(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', { account_id: accountId }] }),
  })
}

export const useDeleteTask = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', { account_id: accountId }] }),
  })
}
