import { Polar } from '@polar-sh/sdk'
import {
  POLAR_ACCESS_TOKEN,
  POLAR_ENVIRONMENT,
  POLAR_PLUS_CHECKOUT_URL,
  POLAR_PLUS_PRODUCT_ID,
  POLAR_PRO_CHECKOUT_URL,
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

function isCheckoutLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'buy.polar.sh'
      && /^\/polar_cl_[A-Za-z0-9]+$/.test(url.pathname)
  } catch {
    return false
  }
}

export function isPolarApiConfigured(): boolean {
  return isConfiguredValue(POLAR_ACCESS_TOKEN)
}

export function isPolarCheckoutConfigured(): boolean {
  return isProductId(POLAR_PLUS_PRODUCT_ID)
    && isProductId(POLAR_PRO_PRODUCT_ID)
    && (
      isPolarApiConfigured()
      || (isCheckoutLink(POLAR_PLUS_CHECKOUT_URL) && isCheckoutLink(POLAR_PRO_CHECKOUT_URL))
    )
}

export function isPolarWebhookConfigured(): boolean {
  return isConfiguredValue(POLAR_WEBHOOK_SECRET)
}

export function getPolarClient(): Polar {
  if (!isPolarApiConfigured()) {
    throw new Error('POLAR_ACCESS_TOKEN이 설정되지 않았습니다.')
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

export function checkoutLinkForPlan(plan: PaidPlan): string | null {
  const value = plan === 'plus' ? POLAR_PLUS_CHECKOUT_URL : POLAR_PRO_CHECKOUT_URL
  return isCheckoutLink(value) ? value : null
}

export function planForProductId(productId: string): PaidPlan | null {
  if (isProductId(POLAR_PLUS_PRODUCT_ID) && productId === POLAR_PLUS_PRODUCT_ID) return 'plus'
  if (isProductId(POLAR_PRO_PRODUCT_ID) && productId === POLAR_PRO_PRODUCT_ID) return 'pro'
  return null
}
