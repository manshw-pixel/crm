import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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

// Security note: tokens are stored in sessionStorage (not localStorage) so they
// are not accessible across tabs and are cleared when the browser session ends.
// For full XSS protection, the refreshToken should be moved to an HttpOnly cookie
// set by the backend — this requires a backend change and is tracked as a future improvement.
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
    {
      name: 'crm-auth',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
