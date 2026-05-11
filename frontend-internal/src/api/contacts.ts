import { client } from './client'
import type { ContactOut, ContactCreate, ContactUpdate } from '@/types/api'

export const listContacts = async (accountId: number): Promise<ContactOut[]> => {
  const res = await client.get<ContactOut[]>(`/accounts/${accountId}/contacts`)
  return res.data
}

export const createContact = async (accountId: number, data: ContactCreate): Promise<ContactOut> => {
  const res = await client.post<ContactOut>(`/accounts/${accountId}/contacts`, data)
  return res.data
}

export const updateContact = async (contactId: number, data: ContactUpdate): Promise<ContactOut> => {
  const res = await client.patch<ContactOut>(`/contacts/${contactId}`, data)
  return res.data
}

export const deleteContact = async (contactId: number): Promise<void> => {
  await client.delete(`/contacts/${contactId}`)
}
