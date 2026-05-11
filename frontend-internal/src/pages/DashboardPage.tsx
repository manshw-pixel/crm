import { useAuthStore } from '@/store/authStore'
import { useAccounts } from '@/hooks/useAccounts'
import { useTasks } from '@/hooks/useTasks'
import HealthBadge from '@/components/shared/HealthBadge'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ErrorMessage from '@/components/shared/ErrorMessage'
import type { ChurnRiskTier } from '@/types/api'

const riskColors: Record<ChurnRiskTier, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export default function DashboardPage() {
  const userId = useAuthStore((s) => s.userId)

  const atRisk = useAccounts({ page: 1, page_size: 5, risk_tier: 'red' })
  const allAccounts = useAccounts({ page: 1, page_size: 100 })
  const myTasks = useTasks({ owner_id: userId ?? undefined })

  const todayTasks = (myTasks.data ?? []).filter(
    (t) => t.due_date === today() && t.status !== 'completed'
  )

  const counts = {
    green: allAccounts.data?.items.filter((a) => a.churn_risk_tier === 'green').length ?? 0,
    yellow: allAccounts.data?.items.filter((a) => a.churn_risk_tier === 'yellow').length ?? 0,
    red: allAccounts.data?.items.filter((a) => a.churn_risk_tier === 'red').length ?? 0,
  }

  const renewalBuckets = {
    '30 days': (allAccounts.data?.items ?? []).filter((a) => {
      if (!a.renewal_date) return false
      const days = Math.floor((new Date(a.renewal_date).getTime() - Date.now()) / 86400000)
      return days >= 0 && days <= 30
    }),
    '31–60 days': (allAccounts.data?.items ?? []).filter((a) => {
      if (!a.renewal_date) return false
      const days = Math.floor((new Date(a.renewal_date).getTime() - Date.now()) / 86400000)
      return days > 30 && days <= 60
    }),
    '61–90 days': (allAccounts.data?.items ?? []).filter((a) => {
      if (!a.renewal_date) return false
      const days = Math.floor((new Date(a.renewal_date).getTime() - Date.now()) / 86400000)
      return days > 60 && days <= 90
    }),
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Health summary */}
      <div className="grid grid-cols-3 gap-4">
        {(['green', 'yellow', 'red'] as ChurnRiskTier[]).map((tier) => (
          <div key={tier} className="bg-white rounded-lg border p-4 flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${riskColors[tier]}`} />
            <div>
              <div className="text-2xl font-bold">{counts[tier]}</div>
              <div className="text-xs text-gray-500 capitalize">{tier}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* At-risk accounts */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold text-gray-800 mb-3">At-Risk Accounts</h2>
          {atRisk.isLoading && <LoadingSpinner />}
          {atRisk.error && <ErrorMessage onRetry={() => atRisk.refetch()} />}
          {atRisk.data?.items.length === 0 && (
            <p className="text-sm text-gray-400">No at-risk accounts. 🎉</p>
          )}
          <ul className="space-y-2">
            {atRisk.data?.items.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <a href={`/accounts/${a.id}`} className="text-primary hover:underline font-medium">
                  {a.name}
                </a>
                <div className="flex items-center gap-2">
                  <HealthBadge tier={a.churn_risk_tier as ChurnRiskTier} />
                  {a.renewal_date && (
                    <span className="text-gray-400 text-xs">
                      renews {a.renewal_date}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Tasks due today */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold text-gray-800 mb-3">My Tasks Due Today</h2>
          {myTasks.isLoading && <LoadingSpinner />}
          {myTasks.error && <ErrorMessage onRetry={() => myTasks.refetch()} />}
          {todayTasks.length === 0 && !myTasks.isLoading && (
            <p className="text-sm text-gray-400">No tasks due today.</p>
          )}
          <ul className="space-y-2">
            {todayTasks.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  t.priority === 'urgent' || t.priority === 'high' ? 'bg-red-400' : 'bg-gray-300'
                }`} />
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Renewal calendar */}
      <div className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold text-gray-800 mb-3">Upcoming Renewals</h2>
        {allAccounts.isLoading && <LoadingSpinner />}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(renewalBuckets).map(([label, accounts]) => (
            <div key={label}>
              <div className="text-xs font-medium text-gray-500 mb-2">Within {label}</div>
              {accounts.length === 0 && <p className="text-xs text-gray-400">None</p>}
              <ul className="space-y-1">
                {accounts.map((a) => (
                  <li key={a.id} className="text-sm flex justify-between">
                    <a href={`/accounts/${a.id}`} className="text-primary hover:underline truncate">
                      {a.name}
                    </a>
                    <span className="text-gray-400 text-xs ml-2">{a.renewal_date}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
