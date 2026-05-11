import { Menu, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { logout } from '@/api/auth'

interface Props { onMenuClick: () => void }

export default function Topbar({ onMenuClick }: Props) {
  const navigate = useNavigate()
  const { role, refreshToken, clearAuth } = useAuthStore()

  const handleLogout = async () => {
    try { if (refreshToken) await logout(refreshToken) } catch { /* ignore */ }
    clearAuth()
    navigate('/login')
  }

  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-4 sticky top-0 z-10">
      <button
        onClick={onMenuClick}
        className="md:hidden p-2 rounded hover:bg-gray-100"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500 capitalize">{role}</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-red-600 p-2 rounded hover:bg-gray-100"
          title="Logout"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
