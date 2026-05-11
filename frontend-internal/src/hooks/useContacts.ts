import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listContacts, createContact, updateContact, deleteContact } from '@/api/contacts'
import type { ContactCreate, ContactUpdate } from '@/types/api'

export const useContacts = (accountId: number) =>
  useQuery({
    queryKey: ['contacts', accountId],
    queryFn: () => listContacts(accountId),
    enabled: !!accountId,
  })

export const useCreateContact = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ContactCreate) => createContact(accountId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', accountId] }),
  })
}

export const useUpdateContact = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ContactUpdate }) => updateContact(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', accountId] }),
  })
}

export const useDeleteContact = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', accountId] }),
  })
}
