import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, CheckSquare, X } from 'lucide-react'

interface Props { open: boolean; onClose: () => void }

const navItems = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, exact: true },
  { to: '/accounts', label: 'Accounts', Icon: Users, exact: false },
  { to: '/tasks', label: 'Tasks', Icon: CheckSquare, exact: false },
]

export default function Sidebar({ open, onClose }: Props) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`
          fixed top-0 left-0 h-full w-60 bg-white border-r z-30 flex flex-col
          transform transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:static md:z-auto
        `}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b">
          <span className="font-bold text-lg text-primary">CS CRM</span>
          <button onClick={onClose} className="md:hidden p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}
