import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/types/api'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  userId: number | null
  role: UserRole | null
  setAuth: (payload: {
    accessToken: string
    refreshToken: string
    userId: number
    role: UserRole
  }) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userId: null,
      role: null,
      setAuth: ({ accessToken, refreshToken, userId, role }) =>
        set({ accessToken, refreshToken, userId, role }),
      clearAuth: () =>
        set({ accessToken: null, refreshToken: null, userId: null, role: null }),
    }),
    { name: 'crm-auth' }
  )
)
