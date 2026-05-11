import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:8000'

export const handlers = [
  http.post(`${BASE}/auth/login`, () =>
    HttpResponse.json({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      role: 'csm',
      user_id: 1,
    })
  ),

  http.get(`${BASE}/accounts`, () =>
    HttpResponse.json({
      items: [
        {
          id: 1, name: 'Acme Corp', tier: 'enterprise',
          arr: 120000, mrr: 10000, renewal_date: '2026-12-01',
          csm_id: 1, ae_id: null, health_score: 72,
          churn_risk_tier: 'green', industry: 'SaaS',
          employee_count: 200, ticket_trend: 4, csm_sentiment: 4,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        },
      ],
      total: 1, page: 1, page_size: 25,
    })
  ),

  http.get(`${BASE}/accounts/:id`, ({ params }) =>
    HttpResponse.json({
      id: Number(params.id), name: 'Acme Corp', tier: 'enterprise',
      arr: 120000, mrr: 10000, renewal_date: '2026-12-01',
      csm_id: 1, ae_id: null, health_score: 72,
      churn_risk_tier: 'green', industry: 'SaaS',
      employee_count: 200, ticket_trend: 4, csm_sentiment: 4,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    })
  ),

  http.get(`${BASE}/accounts/:id/health`, ({ params }) =>
    HttpResponse.json({
      account_id: Number(params.id),
      health_score: 72,
      churn_risk_tier: 'green',
      rule_score: 72.5,
      signal_scores: {
        days_since_activity: 100, days_to_renewal: 90,
        open_high_priority_tasks: 100, latest_nps: 60,
        ticket_trend: 80, csm_sentiment: 80,
      },
      ml_probability: null,
      ml_top_features: null,
      ai_narrative: null,
      trend_90d: [],
    })
  ),

  http.get(`${BASE}/tasks`, () => HttpResponse.json([])),
  http.get(`${BASE}/accounts/:id/contacts`, () => HttpResponse.json([])),
]
