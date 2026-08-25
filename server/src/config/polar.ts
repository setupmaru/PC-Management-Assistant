import { Polar } from '@polar-sh/sdk'
import {
  POLAR_ACCESS_TOKEN,
  POLAR_ENVIRONMENT,
  POLAR_PLUS_PRODUCT_ID,
  POLAR_PRO_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET,
} from './env'

export type PaidPlan = 'plus' | 'pro'

let client: Polar | null = null

function isConfiguredValue(value: string): boolean {
  return Boolean(value && !value.includes('...'))
}

function isProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    && value !== '00000000-0000-0000-0000-000000000000'
}

export function isPolarCheckoutConfigured(): boolean {
  return isConfiguredValue(POLAR_ACCESS_TOKEN)
    && isProductId(POLAR_PLUS_PRODUCT_ID)
    && isProductId(POLAR_PRO_PRODUCT_ID)
}

export function isPolarWebhookConfigured(): boolean {
  return isConfiguredValue(POLAR_WEBHOOK_SECRET)
}

export function getPolarClient(): Polar {
  if (!isPolarCheckoutConfigured()) {
    throw new Error('Polar 결제 환경 변수가 설정되지 않았습니다.')
  }

  client ??= new Polar({
    accessToken: POLAR_ACCESS_TOKEN,
    server: POLAR_ENVIRONMENT,
  })
  return client
}

export function getPolarWebhookSecret(): string {
  if (!isPolarWebhookConfigured()) {
    throw new Error('POLAR_WEBHOOK_SECRET이 설정되지 않았습니다.')
  }
  return POLAR_WEBHOOK_SECRET
}

export function productIdForPlan(plan: PaidPlan): string {
  return plan === 'plus' ? POLAR_PLUS_PRODUCT_ID : POLAR_PRO_PRODUCT_ID
}

export function planForProductId(productId: string): PaidPlan | null {
  if (isProductId(POLAR_PLUS_PRODUCT_ID) && productId === POLAR_PLUS_PRODUCT_ID) return 'plus'
  if (isProductId(POLAR_PRO_PRODUCT_ID) && productId === POLAR_PRO_PRODUCT_ID) return 'pro'
  return null
}
