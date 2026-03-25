import pool from '../config/db'
import { TOSS_BASE_URL, PLUS_PRICE, PRO_PRICE, PLUS_ORDER_NAME, PRO_ORDER_NAME, tossHeaders } from '../config/toss'

const PLUS_DAILY_LIMIT = 5

// ── 구독 상태 조회 ────────────────────────────────────
export async function getSubscriptionStatus(userId: string) {
  const result = await pool.query<{
    plan: string
    toss_billing_key: string | null
    status: string | null
    current_period_end: Date | null
    cancel_at_period_end: boolean | null
  }>(
    `SELECT u.plan, u.toss_billing_key, s.status, s.current_period_end, s.cancel_at_period_end
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
     WHERE u.id = $1
     ORDER BY s.current_period_end DESC NULLS LAST
     LIMIT 1`,
    [userId]
  )

  const row = result.rows[0]

  // 구독 만료 자동 감지 → free 다운그레이드
  if ((row?.plan === 'pro' || row?.plan === 'plus') && row.current_period_end && new Date() > row.current_period_end) {
    await pool.query(`UPDATE users SET plan = 'free', updated_at = NOW() WHERE id = $1`, [userId])
    return {
      plan: 'free' as const,
      status: 'expired',
      periodEnd: null as null,
      cancelAtPeriodEnd: false,
      hasBillingKey: !!row.toss_billing_key,
    }
  }

  return {
    plan: (row?.plan ?? 'free') as 'free' | 'plus' | 'pro',
    status: row?.status ?? null,
    periodEnd: row?.current_period_end?.toISOString() ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    hasBillingKey: !!row?.toss_billing_key,
  }
}

// ── TossPayments 빌링키 발급 ─────────────────────────
export async function issueBillingKey(authKey: string, customerKey: string): Promise<string> {
  const res = await fetch(`${TOSS_BASE_URL}/v1/billing/authorizations/issue`, {
    method: 'POST',
    headers: tossHeaders(),
    body: JSON.stringify({ authKey, customerKey }),
  })

  const data = (await res.json()) as {
    billingKey?: string
    code?: string
    message?: string
  }

  if (!res.ok || !data.billingKey) {
    throw new Error(data.message ?? '빌링키 발급에 실패했습니다.')
  }

  return data.billingKey
}

// ── 빌링키 저장 ───────────────────────────────────────
export async function saveBillingKey(userId: string, billingKey: string): Promise<void> {
  await pool.query(
    `UPDATE users SET toss_billing_key = $1, updated_at = NOW() WHERE id = $2`,
    [billingKey, userId]
  )
}

// ── 빌링키로 결제 (첫 결제 또는 갱신) ────────────────
export async function chargeBillingKey(
  billingKey: string,
  userId: string,
  email: string,
  plan: 'plus' | 'pro'
): Promise<void> {
  const price = plan === 'plus' ? PLUS_PRICE : PRO_PRICE
  const orderName = plan === 'plus' ? PLUS_ORDER_NAME : PRO_ORDER_NAME
  const orderId = `sub-${userId.replace(/-/g, '').slice(0, 12)}-${Date.now()}`

  const res = await fetch(`${TOSS_BASE_URL}/v1/billing/${billingKey}`, {
    method: 'POST',
    headers: tossHeaders(),
    body: JSON.stringify({
      customerKey: userId,
      amount: price,
      orderId,
      orderName,
      customerEmail: email,
    }),
  })

  const data = (await res.json()) as {
    status?: string
    code?: string
    message?: string
  }

  if (!res.ok) throw new Error(data.message ?? '결제에 실패했습니다.')
  if (data.status !== 'DONE') throw new Error(`결제 상태 오류: ${data.status}`)

  // 구독 기간 30일 설정
  const periodEnd = new Date()
  periodEnd.setDate(periodEnd.getDate() + 30)

  await pool.query(
    `INSERT INTO subscriptions (user_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, 'active', $3, FALSE)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       status = 'active',
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = FALSE,
       updated_at = NOW()`,
    [userId, orderId, periodEnd]
  )

  await pool.query(
    `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
    [plan, userId]
  )
}

// ── 저장된 빌링키로 즉시 갱신 결제 ──────────────────
export async function renewWithBillingKey(userId: string, email: string, plan: 'plus' | 'pro'): Promise<void> {
  const result = await pool.query<{ toss_billing_key: string | null }>(
    `SELECT toss_billing_key FROM users WHERE id = $1`,
    [userId]
  )

  const billingKey = result.rows[0]?.toss_billing_key
  if (!billingKey) throw new Error('등록된 결제 수단이 없습니다.')

  await chargeBillingKey(billingKey, userId, email, plan)
}

// ── 구독 취소 (기간 만료 후 free 전환) ───────────────
export async function cancelSubscription(userId: string): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW()
     WHERE user_id = $1 AND status = 'active'`,
    [userId]
  )
}

// ── 결제 수단 삭제 ────────────────────────────────────
export async function deleteBillingKey(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET toss_billing_key = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  )
}

// ── Plus 일일 채팅 한도 확인 및 소비 ─────────────────
export async function checkAndUseChatLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

  // 현재 사용량 조회
  const checkResult = await pool.query<{ count: number }>(
    `SELECT count FROM chat_usage WHERE user_id = $1 AND date = $2`,
    [userId, today]
  )

  const currentCount = checkResult.rows[0]?.count ?? 0

  if (currentCount >= PLUS_DAILY_LIMIT) {
    return { allowed: false, remaining: 0 }
  }

  // 사용량 증가
  await pool.query(
    `INSERT INTO chat_usage (user_id, date, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, date) DO UPDATE SET count = chat_usage.count + 1`,
    [userId, today]
  )

  return { allowed: true, remaining: PLUS_DAILY_LIMIT - currentCount - 1 }
}
