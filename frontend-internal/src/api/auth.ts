import { client } from './client'
import type { LoginRequest, TokenResponse } from '@/types/api'

export const login = async (data: LoginRequest): Promise<TokenResponse> => {
  const res = await client.post<TokenResponse>('/auth/login', data)
  return res.data
}

export const logout = async (refreshToken: string): Promise<void> => {
  await client.post('/auth/logout', { refresh_token: refreshToken })
}

export const refresh = async (refreshToken: string): Promise<TokenResponse> => {
  const res = await client.post<TokenResponse>('/auth/refresh', { refresh_token: refreshToken })
  return res.data
}
