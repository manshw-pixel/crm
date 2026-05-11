import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/store/authStore'

export const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15000,
})

let isRefreshing = false
let refreshQueue: ((token: string) => void)[] = []

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean }
    if (error.response?.status !== 401 || original?._retry) {
      return Promise.reject(error)
    }
    original._retry = true

    const { refreshToken, setAuth, clearAuth } = useAuthStore.getState()
    if (!refreshToken) {
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        refreshQueue.push((token) => {
          original!.headers!.Authorization = `Bearer ${token}`
          resolve(client(original!))
        })
      })
    }

    isRefreshing = true
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_URL}/auth/refresh`,
        { refresh_token: refreshToken }
      )
      const { access_token, refresh_token, role, user_id } = res.data
      setAuth({ accessToken: access_token, refreshToken: refresh_token, role, userId: user_id })
      refreshQueue.forEach((cb) => cb(access_token))
      refreshQueue = []
      original!.headers!.Authorization = `Bearer ${access_token}`
      return client(original!)
    } catch {
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  }
)
