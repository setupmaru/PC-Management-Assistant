import crypto from 'node:crypto'
import net from 'node:net'
import type { Subscription } from '@polar-sh/sdk/models/components/subscription'
import pool from '../config/db'
import { makeApiUrl } from '../config/app'
import { JWT_ACCESS_SECRET } from '../config/env'
import {
  checkoutLinkForPlan,
  getPolarClient,
  isPolarApiConfigured,
  PaidPlan,
  planForProductId,
  productIdForPlan,
} from '../config/polar'

const PLUS_DAILY_LIMIT = 5
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due'])

interface SubscriptionStatusRow {
  plan: 'free' | PaidPlan
  status: string | null
  current_period_end: Date | null
  cancel_at_period_end: boolean | null
  provider_subscription_id: string | null
}

function normalizeCustomerIp(value?: string): string | undefined {
  const first = value?.split(',')[0]?.trim()
  if (!first) return undefined

  const ip = first.startsWith('::ffff:') ? first.slice(7) : first
  if (!net.isIP(ip) || ip === '127.0.0.1' || ip === '::1') return undefined
  return ip
}

function createCheckoutReference(userId: string, plan: PaidPlan): string {
  const message = `${userId}:${plan}`
  const signature = crypto.createHmac('sha256', JWT_ACCESS_SECRET).update(`polar:${message}`).digest('hex')
  return `${message}:${signature}`
}

function userIdFromCheckoutReference(value: unknown, expectedPlan: PaidPlan): string | null {
  if (typeof value !== 'string') return null
  const [userId, plan, signature, extra] = value.split(':')
  if (extra !== undefined || plan !== expectedPlan || !USER_ID_PATTERN.test(userId) || !/^[0-9a-f]{64}$/.test(signature)) {
    return null
  }

  const expected = createCheckoutReference(userId, expectedPlan).split(':')[2]
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
    ? userId
    : null
}

function externalUserId(subscription: Subscription, plan: PaidPlan): string | null {
  const metadataUserId = subscription.metadata.userId
  const checkoutReferenceUserId = userIdFromCheckoutReference(subscription.metadata.reference_id, plan)
  const customerUserId = subscription.customer.externalId
  const validMetadataUserId = typeof metadataUserId === 'string' && USER_ID_PATTERN.test(metadataUserId)
    ? metadataUserId
    : null
  const validCustomerUserId = typeof customerUserId === 'string' && USER_ID_PATTERN.test(customerUserId)
    ? customerUserId
    : null

  const candidates = [validMetadataUserId, validCustomerUserId, checkoutReferenceUserId]
    .filter((value): value is string => value !== null)
  if (new Set(candidates).size > 1) {
    return null
  }
  return candidates[0] ?? null
}

function subscriptionIsEntitled(status: string, periodEnd: Date, cancelAtPeriodEnd: boolean): boolean {
  if (ENTITLED_STATUSES.has(status)) return true
  return status === 'canceled' && cancelAtPeriodEnd && periodEnd.getTime() > Date.now()
}

export async function getSubscriptionStatus(userId: string) {
  const result = await pool.query<SubscriptionStatusRow>(
    `SELECT u.plan, s.status, s.current_period_end, s.cancel_at_period_end,
            s.provider_subscription_id
       FROM users u
       LEFT JOIN LATERAL (
         SELECT status, current_period_end, cancel_at_period_end, provider_subscription_id
           FROM subscriptions
          WHERE user_id = u.id AND provider = 'polar'
          ORDER BY
            CASE
              WHEN status IN ('active', 'trialing', 'past_due') THEN 0
              WHEN status = 'canceled' AND cancel_at_period_end = TRUE AND current_period_end > NOW() THEN 1
              ELSE 2
            END,
            current_period_end DESC
          LIMIT 1
       ) s ON TRUE
      WHERE u.id = $1`,
    [userId]
  )

  const row = result.rows[0]
  if (!row) throw new Error('사용자를 찾을 수 없습니다.')

  if (
    row.plan !== 'free'
    && row.provider_subscription_id
    && row.cancel_at_period_end
    && row.current_period_end
    && row.current_period_end.getTime() <= Date.now()
  ) {
    await pool.query(`UPDATE users SET plan = 'free', updated_at = NOW() WHERE id = $1`, [userId])
    row.plan = 'free'
  }

  return {
    plan: row.plan,
    status: row.status,
    periodEnd: row.current_period_end?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
  }
}

export async function createPolarCheckout(
  userId: string,
  email: string,
  plan: PaidPlan,
  customerIp?: string
): Promise<string> {
  if (!isPolarApiConfigured()) {
    const checkoutLink = checkoutLinkForPlan(plan)
    if (!checkoutLink) throw new Error('Polar Checkout Link가 설정되지 않았습니다.')

    const url = new URL(checkoutLink)
    url.searchParams.set('customer_email', email)
    url.searchParams.set('locale', 'ko')
    url.searchParams.set('reference_id', createCheckoutReference(userId, plan))
    return url.toString()
  }

  const checkout = await getPolarClient().checkouts.create({
    products: [productIdForPlan(plan)],
    externalCustomerId: userId,
    customerEmail: email,
    customerIpAddress: normalizeCustomerIp(customerIp),
    metadata: {
      userId,
      plan,
      app: 'pc-management-assistant',
    },
    allowDiscountCodes: true,
    locale: 'ko',
    successUrl: makeApiUrl('/api/billing/success?checkout_id={CHECKOUT_ID}'),
    returnUrl: makeApiUrl('/api/billing/cancelled'),
  })

  return checkout.url
}

export async function createCustomerPortalUrl(userId: string): Promise<string> {
  const session = await getPolarClient().customerSessions.create({
    externalCustomerId: userId,
    returnUrl: makeApiUrl('/api/billing/portal-return'),
  })
  return session.customerPortalUrl
}

export async function syncPolarSubscription(subscription: Subscription): Promise<void> {
  const plan = planForProductId(subscription.productId)
  if (!plan) {
    throw new Error(`등록되지 않은 Polar 상품입니다: ${subscription.productId}`)
  }

  const userId = externalUserId(subscription, plan)
  if (!userId) {
    throw new Error(`Polar 구독 ${subscription.id}에 유효한 외부 사용자 ID가 없습니다.`)
  }

  const client = await pool.connect()
  const providerUpdatedAt = subscription.modifiedAt ?? subscription.createdAt
  try {
    await client.query('BEGIN')

    const userResult = await client.query(
      `UPDATE users
          SET polar_customer_id = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id`,
      [subscription.customerId, userId]
    )
    if (userResult.rowCount !== 1) {
      throw new Error(`Polar 구독에 연결된 사용자를 찾을 수 없습니다: ${userId}`)
    }

    await client.query(
      `INSERT INTO subscriptions (
         user_id, provider, provider_subscription_id, provider_product_id,
         provider_updated_at, status, current_period_end, cancel_at_period_end, updated_at
       )
       VALUES ($1, 'polar', $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         provider_product_id = EXCLUDED.provider_product_id,
         provider_updated_at = EXCLUDED.provider_updated_at,
         status = EXCLUDED.status,
         current_period_end = EXCLUDED.current_period_end,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         updated_at = NOW()
       WHERE subscriptions.provider_updated_at IS NULL
          OR EXCLUDED.provider_updated_at IS NULL
          OR EXCLUDED.provider_updated_at >= subscriptions.provider_updated_at`,
      [
        userId,
        subscription.id,
        subscription.productId,
        providerUpdatedAt,
        subscription.status,
        subscription.currentPeriodEnd,
        subscription.cancelAtPeriodEnd,
      ]
    )

    // 결제가 아직 완료되지 않은 체크아웃은 기존 플랜을 변경하지 않는다.
    if (subscription.status !== 'incomplete') {
      const subscriptionRows = await client.query<{
        provider_product_id: string
        status: string
        current_period_end: Date
        cancel_at_period_end: boolean
      }>(
        `SELECT provider_product_id, status, current_period_end, cancel_at_period_end
           FROM subscriptions
          WHERE user_id = $1 AND provider = 'polar'`,
        [userId]
      )

      const entitledPlans = subscriptionRows.rows
        .filter((row) => subscriptionIsEntitled(
          row.status,
          row.current_period_end,
          row.cancel_at_period_end
        ))
        .map((row) => planForProductId(row.provider_product_id))
        .filter((candidate): candidate is PaidPlan => candidate !== null)

      const effectivePlan: 'free' | PaidPlan = entitledPlans.includes('pro')
        ? 'pro'
        : entitledPlans.includes('plus')
          ? 'plus'
          : 'free'

      await client.query(
        `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
        [effectivePlan, userId]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function cancelSubscription(userId: string): Promise<void> {
  const result = await pool.query<{ provider_subscription_id: string }>(
    `SELECT provider_subscription_id
       FROM subscriptions
      WHERE user_id = $1
        AND provider = 'polar'
        AND provider_subscription_id IS NOT NULL
        AND status IN ('active', 'trialing', 'past_due', 'canceled')
        AND cancel_at_period_end = FALSE
      ORDER BY current_period_end DESC
      LIMIT 1`,
    [userId]
  )

  const subscriptionId = result.rows[0]?.provider_subscription_id
  if (!subscriptionId) {
    throw new Error('취소할 활성 구독이 없습니다.')
  }

  const subscription = await getPolarClient().subscriptions.update({
    id: subscriptionId,
    subscriptionUpdate: { cancelAtPeriodEnd: true },
  })
  await syncPolarSubscription(subscription)
}

export async function checkAndUseChatLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const checkResult = await pool.query<{ count: number }>(
    `SELECT count FROM chat_usage WHERE user_id = $1 AND date = $2`,
    [userId, today]
  )

  const currentCount = checkResult.rows[0]?.count ?? 0
  if (currentCount >= PLUS_DAILY_LIMIT) {
    return { allowed: false, remaining: 0 }
  }

  await pool.query(
    `INSERT INTO chat_usage (user_id, date, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, date) DO UPDATE SET count = chat_usage.count + 1`,
    [userId, today]
  )

  return { allowed: true, remaining: PLUS_DAILY_LIMIT - currentCount - 1 }
}
