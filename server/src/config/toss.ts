import { TOSS_CLIENT_KEY, TOSS_PLUS_PRICE, TOSS_PRO_PRICE, TOSS_SECRET_KEY } from './env'

export const TOSS_BASE_URL = 'https://api.tosspayments.com'
export const PLUS_PRICE = TOSS_PLUS_PRICE
export const PRO_PRICE = TOSS_PRO_PRICE
export const PLUS_ORDER_NAME = 'PC Management Assistant Plus'
export const PRO_ORDER_NAME = 'PC Management Assistant Pro'

export function tossHeaders(): Record<string, string> {
  const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')

  return {
    Authorization: `Basic ${encoded}`,
    'Content-Type': 'application/json',
  }
}

export function isConfigured(): boolean {
  return !TOSS_CLIENT_KEY.includes('...') && !TOSS_SECRET_KEY.includes('...')
}
