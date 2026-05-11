import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useAccount, useUpdateAccount } from '@/hooks/useAccounts'
import { useAccountHealth, useRecalculateHealth } from '@/hooks/useAccountHealth'
import { useTasks, useCreateTask, useUpdateTask } from '@/hooks/useTasks'
import { useContacts, useCreateContact, useDeleteContact } from '@/hooks/useContacts'
import HealthBadge from '@/components/shared/HealthBadge'
import ScoreGauge from '@/components/shared/ScoreGauge'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ErrorMessage from '@/components/shared/ErrorMessage'
import type { AccountUpdate, TaskCreate, ContactCreate, ChurnRiskTier } from '@/types/api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

type Tab = 'overview' | 'health' | 'tasks' | 'contacts'

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const accountId = Number(id)
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  const { data: account, isLoading, error } = useAccount(accountId)

  if (isLoading) return <LoadingSpinner />
  if (error || !account) return (
    <ErrorMessage
      message="Account not found."
      onRetry={() => navigate('/accounts')}
    />
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'health', label: 'Health' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'contacts', label: 'Contacts' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/accounts')}
            className="text-sm text-gray-500 hover:text-primary mb-1"
          >
            ← Accounts
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-500 capitalize">{account.tier.replace('_', '-')}</span>
            <HealthBadge tier={account.churn_risk_tier as ChurnRiskTier} />
          </div>
        </div>
      </div>

      {/* Tabs — dropdown on mobile, tabs on desktop */}
      <div>
        <div className="md:hidden">
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as Tab)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="hidden md:flex border-b">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab accountId={accountId} />}
        {activeTab === 'health' && <HealthTab accountId={accountId} />}
        {activeTab === 'tasks' && <TasksTab accountId={accountId} />}
        {activeTab === 'contacts' && <ContactsTab accountId={accountId} />}
      </div>
    </div>
  )
}

/* ── Overview Tab ─────────────────────────────────────────── */

function OverviewTab({ accountId }: { accountId: number }) {
  const { data: account, refetch } = useAccount(accountId)
  const updateAccount = useUpdateAccount(accountId)
  const [editing, setEditing] = useState(false)
  const { register, handleSubmit, reset } = useForm<AccountUpdate>()

  if (!account) return null

  const onSubmit = async (data: AccountUpdate) => {
    const cleaned: AccountUpdate = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== '' && v !== null && v !== undefined) (cleaned as Record<string, unknown>)[k] = v
    }
    await updateAccount.mutateAsync(cleaned)
    setEditing(false)
    refetch()
  }

  const onCancel = () => { reset(); setEditing(false) }

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Account Details</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-primary hover:underline"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={onCancel} className="text-sm text-gray-500 hover:underline">Cancel</button>
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={updateAccount.isPending}
              className="text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {updateAccount.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      <form>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: 'Name', name: 'name' as keyof AccountUpdate, value: account.name },
            { label: 'Industry', name: 'industry' as keyof AccountUpdate, value: account.industry },
            { label: 'ARR', name: 'arr' as keyof AccountUpdate, value: account.arr, type: 'number' },
            { label: 'MRR', name: 'mrr' as keyof AccountUpdate, value: account.mrr, type: 'number' },
            { label: 'Renewal Date', name: 'renewal_date' as keyof AccountUpdate, value: account.renewal_date, type: 'date' },
            { label: 'Employee Count', name: 'employee_count' as keyof AccountUpdate, value: account.employee_count, type: 'number' },
            { label: 'CSM Sentiment (1–5)', name: 'csm_sentiment' as keyof AccountUpdate, value: account.csm_sentiment, type: 'number' },
            { label: 'Ticket Trend (1–5)', name: 'ticket_trend' as keyof AccountUpdate, value: account.ticket_trend, type: 'number' },
          ].map(({ label, name, value, type = 'text' }) => (
            <div key={name}>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
              <dd className="mt-1">
                {editing ? (
                  <input
                    type={type}
                    defaultValue={String(value ?? '')}
                    className="w-full border rounded px-2 py-1 text-sm"
                    {...register(name)}
                  />
                ) : (
                  <span className="text-sm text-gray-900">{String(value ?? '—')}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4">
          <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</dt>
          <dd className="mt-1">
            {editing ? (
              <textarea
                defaultValue={account.notes ?? ''}
                className="w-full border rounded px-2 py-1 text-sm h-24"
                {...register('notes')}
              />
            ) : (
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{account.notes || '—'}</p>
            )}
          </dd>
        </div>
      </form>
    </div>
  )
}

/* ── Health Tab ───────────────────────────────────────────── */

function HealthTab({ accountId }: { accountId: number }) {
  const { data, isLoading, error, refetch } = useAccountHealth(accountId)
  const recalculate = useRecalculateHealth(accountId)

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage onRetry={() => refetch()} />
  if (!data) return null

  const signalLabels: Record<string, string> = {
    days_since_activity: 'Days Since Activity',
    days_to_renewal: 'Days to Renewal',
    open_high_priority_tasks: 'Open High-Priority Tasks',
    latest_nps: 'Latest NPS',
    ticket_trend: 'Ticket Trend',
    csm_sentiment: 'CSM Sentiment',
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border p-6 flex flex-col sm:flex-row items-center gap-6">
        <ScoreGauge score={data.health_score} />
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Risk Tier</span>
            <HealthBadge tier={data.churn_risk_tier as ChurnRiskTier} />
          </div>
          {data.rule_score !== null && (
            <p className="text-sm text-gray-500">Rule Score: {data.rule_score.toFixed(1)}</p>
          )}
          {data.ml_probability !== null && (
            <p className="text-sm text-gray-500">
              ML Churn Probability: {(data.ml_probability * 100).toFixed(1)}%
            </p>
          )}
          <button
            onClick={() => recalculate.mutate(true)}
            disabled={recalculate.isPending}
            className="mt-2 text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
          >
            {recalculate.isPending ? 'Recalculating…' : 'Refresh Narrative'}
          </button>
        </div>
      </div>

      {data.signal_scores && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Signal Breakdown</h3>
          <div className="space-y-3">
            {Object.entries(data.signal_scores).map(([key, score]) => (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{signalLabels[key] ?? key}</span>
                  <span className="font-medium">{score.toFixed(0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.ai_narrative && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-gray-800 mb-2">AI Analysis</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.ai_narrative}</p>
        </div>
      )}

      {data.trend_90d.length > 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-gray-800 mb-4">90-Day Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.trend_90d}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/* ── Tasks Tab ────────────────────────────────────────────── */

function TasksTab({ accountId }: { accountId: number }) {
  const { data: tasks, isLoading, error, refetch } = useTasks({ account_id: accountId })
  const createTask = useCreateTask(accountId)
  const updateTask = useUpdateTask(accountId)
  const [showForm, setShowForm] = useState(false)
  const { register, handleSubmit, reset } = useForm<{ title: string; priority: string; due_date: string }>()

  const onSubmit = async (data: { title: string; priority: string; due_date: string }) => {
    const payload: TaskCreate = {
      account_id: accountId,
      title: data.title,
      priority: (data.priority || 'medium') as TaskCreate['priority'],
      due_date: data.due_date || undefined,
    }
    await createTask.mutateAsync(payload)
    reset()
    setShowForm(false)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage onRetry={() => refetch()} />

  const open = (tasks ?? []).filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  const done = (tasks ?? []).filter((t) => t.status === 'completed')

  const priorityColors: Record<string, string> = {
    urgent: 'text-red-600', high: 'text-orange-500',
    medium: 'text-gray-600', low: 'text-gray-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-800">Tasks ({open.length} open)</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm bg-primary text-white px-3 py-1 rounded"
        >
          + Add Task
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="text-sm font-medium">New Task</h3>
          <input
            placeholder="Task title"
            className="w-full border rounded px-3 py-2 text-sm"
            {...register('title', { required: true })}
          />
          <div className="flex gap-2">
            <select className="border rounded px-2 py-1 text-sm" {...register('priority')}>
              {['low', 'medium', 'high', 'urgent'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input type="date" className="border rounded px-2 py-1 text-sm" {...register('due_date')} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={createTask.isPending}
              className="text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {createTask.isPending ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border divide-y">
        {open.length === 0 && <p className="p-4 text-sm text-gray-400">No open tasks.</p>}
        {open.map((t) => (
          <div key={t.id} className="p-4 flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5"
              onChange={() => updateTask.mutate({ id: t.id, data: { status: 'completed' } })}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{t.title}</p>
              <p className={`text-xs mt-0.5 ${priorityColors[t.priority]}`}>
                {t.priority} priority{t.due_date ? ` · due ${t.due_date}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <details className="bg-white rounded-lg border">
          <summary className="p-4 text-sm text-gray-500 cursor-pointer">
            {done.length} completed task{done.length !== 1 ? 's' : ''}
          </summary>
          <div className="divide-y border-t">
            {done.map((t) => (
              <div key={t.id} className="p-4 flex items-center gap-3">
                <input type="checkbox" checked readOnly className="opacity-50" />
                <p className="text-sm text-gray-400 line-through">{t.title}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/* ── Contacts Tab ─────────────────────────────────────────── */

function ContactsTab({ accountId }: { accountId: number }) {
  const { data: contacts, isLoading, error, refetch } = useContacts(accountId)
  const createContact = useCreateContact(accountId)
  const deleteContact = useDeleteContact(accountId)
  const [showForm, setShowForm] = useState(false)
  const { register, handleSubmit, reset } = useForm<ContactCreate>()

  const onSubmit = async (data: ContactCreate) => {
    await createContact.mutateAsync(data)
    reset()
    setShowForm(false)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage onRetry={() => refetch()} />

  const roleBadgeColors: Record<string, string> = {
    champion: 'bg-green-100 text-green-800',
    economic_buyer: 'bg-blue-100 text-blue-800',
    influencer: 'bg-purple-100 text-purple-800',
    detractor: 'bg-red-100 text-red-800',
    end_user: 'bg-gray-100 text-gray-700',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-800">Contacts ({contacts?.length ?? 0})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm bg-primary text-white px-3 py-1 rounded"
        >
          + Add Contact
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="text-sm font-medium">New Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Name *" className="border rounded px-3 py-2 text-sm" {...register('name', { required: true })} />
            <input placeholder="Email" type="email" className="border rounded px-3 py-2 text-sm" {...register('email')} />
            <input placeholder="Title" className="border rounded px-3 py-2 text-sm" {...register('title')} />
            <select className="border rounded px-2 py-2 text-sm" {...register('role')}>
              <option value="">Role (optional)</option>
              {['champion', 'economic_buyer', 'influencer', 'detractor', 'end_user'].map((r) => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_primary" {...register('is_primary')} />
            <label htmlFor="is_primary" className="text-sm text-gray-600">Primary contact</label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={createContact.isPending}
              className="text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {createContact.isPending ? 'Adding…' : 'Add Contact'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {contacts?.length === 0 && (
          <p className="text-sm text-gray-400 col-span-full">No contacts yet.</p>
        )}
        {contacts?.map((c) => (
          <div key={c.id} className="bg-white rounded-lg border p-4 space-y-2 relative">
            <button
              onClick={() => {
                if (window.confirm(`Delete ${c.name}?`)) deleteContact.mutate(c.id)
              }}
              className="absolute top-3 right-3 text-gray-300 hover:text-red-500 text-xs"
            >
              ✕
            </button>
            <div>
              <p className="font-medium text-gray-900 text-sm">{c.name}</p>
              {c.is_primary && <span className="text-xs text-primary">★ Primary</span>}
            </div>
            {c.title && <p className="text-xs text-gray-500">{c.title}</p>}
            {c.email && <p className="text-xs text-gray-500">{c.email}</p>}
            {c.role && (
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${roleBadgeColors[c.role] ?? 'bg-gray-100'}`}>
                {c.role.replace('_', ' ')}
              </span>
            )}
            {c.influence_rating && (
              <p className="text-xs text-gray-400">Influence: {c.influence_rating}/5</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
