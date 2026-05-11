export type UserRole = 'admin' | 'csm' | 'ae' | 'customer'
export type AccountTier = 'smb' | 'mid_market' | 'enterprise'
export type ChurnRiskTier = 'green' | 'yellow' | 'red'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type ContactRole = 'champion' | 'economic_buyer' | 'influencer' | 'detractor' | 'end_user'

export interface LoginRequest { email: string; password: string }
export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  role: UserRole
  user_id: number
}

export interface AccountOut {
  id: number
  name: string
  tier: AccountTier
  arr: number | null
  mrr: number | null
  renewal_date: string | null
  csm_id: number | null
  ae_id: number | null
  health_score: number
  churn_risk_tier: ChurnRiskTier
  industry: string | null
  employee_count: number | null
  ticket_trend: number | null
  csm_sentiment: number | null
  created_at: string
  updated_at: string
}

export interface AccountListResponse {
  items: AccountOut[]
  total: number
  page: number
  page_size: number
}

export interface AccountUpdate {
  name?: string
  tier?: AccountTier
  arr?: number | null
  mrr?: number | null
  renewal_date?: string | null
  csm_id?: number | null
  ae_id?: number | null
  industry?: string | null
  employee_count?: number | null
  notes?: string | null
  ticket_trend?: number | null
  csm_sentiment?: number | null
}

export interface HealthScoreOut {
  account_id: number
  health_score: number
  churn_risk_tier: ChurnRiskTier
  rule_score: number | null
  signal_scores: Record<string, number> | null
  ml_probability: number | null
  ml_top_features: string[] | null
  ai_narrative: string | null
  trend_90d: { date: string; score: number }[]
}

export interface RecalculateResponse {
  account_id: number
  final_score: number
  rule_score: number
  churn_risk_tier: ChurnRiskTier
  ml_probability: number | null
  ai_narrative: string | null
}

export interface TaskOut {
  id: number
  account_id: number
  title: string
  description: string | null
  priority: TaskPriority
  due_date: string | null
  owner_id: number | null
  status: TaskStatus
  source: string
  created_at: string
  updated_at: string
}

export interface TaskCreate {
  account_id: number
  title: string
  description?: string
  priority?: TaskPriority
  due_date?: string
  owner_id?: number
}

export interface TaskUpdate {
  title?: string
  description?: string
  priority?: TaskPriority
  due_date?: string | null
  owner_id?: number | null
  status?: TaskStatus
}

export interface ContactOut {
  id: number
  account_id: number
  name: string
  email: string | null
  title: string | null
  role: ContactRole | null
  influence_rating: number | null
  is_primary: boolean
  created_at: string
}

export interface ContactCreate {
  name: string
  email?: string
  title?: string
  role?: ContactRole
  influence_rating?: number
  is_primary?: boolean
}

export interface ContactUpdate {
  name?: string
  email?: string | null
  title?: string | null
  role?: ContactRole | null
  influence_rating?: number | null
  is_primary?: boolean
}
