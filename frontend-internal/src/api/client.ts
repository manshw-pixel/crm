import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/store/authStore'

export const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15000,
})

let isRefreshing = false

type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void }
let refreshQueue: QueueEntry[] = []

function drainQueue(token: string | null, error?: unknown) {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (token) resolve(token)
    else reject(error)
  })
  refreshQueue = []
}

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
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: (token) => {
            original!.headers!.Authorization = `Bearer ${token}`
            resolve(client(original!))
          },
          reject,
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
      drainQueue(access_token)
      original!.headers!.Authorization = `Bearer ${access_token}`
      return client(original!)
    } catch (refreshError) {
      drainQueue(null, refreshError)
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  }
)
