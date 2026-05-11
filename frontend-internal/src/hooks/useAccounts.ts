import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listAccounts, getAccount, updateAccount, type AccountListParams } from '@/api/accounts'
import type { AccountUpdate } from '@/types/api'

export const useAccounts = (params: AccountListParams = {}) =>
  useQuery({
    queryKey: ['accounts', params],
    queryFn: () => listAccounts(params),
  })

export const useAccount = (id: number) =>
  useQuery({
    queryKey: ['accounts', id],
    queryFn: () => getAccount(id),
    enabled: !!id,
  })

export const useUpdateAccount = (id: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountUpdate) => updateAccount(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['accounts', id] })
    },
  })
}
