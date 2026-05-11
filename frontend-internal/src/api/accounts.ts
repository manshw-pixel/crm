import { client } from './client'
import type {
  AccountListResponse, AccountOut, AccountUpdate,
  HealthScoreOut, RecalculateResponse
} from '@/types/api'

export interface AccountListParams {
  page?: number
  page_size?: number
  csm_id?: number
  risk_tier?: string
}

export const listAccounts = async (params: AccountListParams = {}): Promise<AccountListResponse> => {
  const res = await client.get<AccountListResponse>('/accounts', { params })
  return res.data
}

export const getAccount = async (id: number): Promise<AccountOut> => {
  const res = await client.get<AccountOut>(`/accounts/${id}`)
  return res.data
}

export const updateAccount = async (id: number, data: AccountUpdate): Promise<AccountOut> => {
  const res = await client.patch<AccountOut>(`/accounts/${id}`, data)
  return res.data
}

export const getAccountHealth = async (id: number): Promise<HealthScoreOut> => {
  const res = await client.get<HealthScoreOut>(`/accounts/${id}/health`)
  return res.data
}

export const recalculateHealth = async (id: number, forceNarrative = false): Promise<RecalculateResponse> => {
  const res = await client.post<RecalculateResponse>(`/scoring/recalculate/${id}`, { force_narrative: forceNarrative })
  return res.data
}
