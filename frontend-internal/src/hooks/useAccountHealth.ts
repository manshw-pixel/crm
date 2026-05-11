import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccountHealth, recalculateHealth } from '@/api/accounts'

export const useAccountHealth = (id: number) =>
  useQuery({
    queryKey: ['accounts', id, 'health'],
    queryFn: () => getAccountHealth(id),
    enabled: !!id,
    staleTime: 30_000,
  })

export const useRecalculateHealth = (id: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (forceNarrative: boolean) => recalculateHealth(id, forceNarrative),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts', id, 'health'] })
      qc.invalidateQueries({ queryKey: ['accounts', id] })
    },
  })
}
