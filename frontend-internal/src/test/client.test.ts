import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      userId: null,
      role: null,
    })
  })

  it('starts with null auth state', () => {
    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.role).toBeNull()
  })

  it('setAuth updates all fields', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'tok-access',
      refreshToken: 'tok-refresh',
      userId: 42,
      role: 'csm',
    })
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('tok-access')
    expect(state.userId).toBe(42)
    expect(state.role).toBe('csm')
  })

  it('clearAuth resets all fields', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'tok', refreshToken: 'ref', userId: 1, role: 'admin',
    })
    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(useAuthStore.getState().role).toBeNull()
  })
})
