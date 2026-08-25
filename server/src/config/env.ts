import dotenv from 'dotenv'

dotenv.config()

type NodeEnv = 'development' | 'production' | 'test'
type PolarEnvironment = 'sandbox' | 'production'

function normalizeNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') return value
  return 'development'
}

function normalizePolarEnvironment(value: string | undefined): PolarEnvironment {
  return value?.trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production'
}

function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function readRequired(name: string): string {
  const value = readOptional(name)
  if (!value) {
    throw new Error(`[env] Missing required environment variable: ${name}`)
  }

  return value
}

function readInteger(name: string, fallback: number): number {
  const raw = readOptional(name)
  if (!raw) return fallback

  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`[env] ${name} must be a valid integer`)
  }

  return parsed
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function toOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new Error(`[env] Invalid URL: ${url}`)
  }
}

function parseOriginList(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(/[,\r\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => toOrigin(entry))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

const NODE_ENV = normalizeNodeEnv(process.env.NODE_ENV)
const IS_PRODUCTION = NODE_ENV === 'production'
const PORT = readInteger('PORT', 3400)
const HOST = readOptional('HOST') ?? '0.0.0.0'

function resolvePublicBaseUrl(): string {
  const publicBaseUrl = readOptional('PUBLIC_BASE_URL')
  if (publicBaseUrl) return normalizeUrl(publicBaseUrl)

  const apiBase = readOptional('API_BASE')
  if (apiBase) {
    const normalized = normalizeUrl(apiBase)
    return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized
  }

  if (IS_PRODUCTION) {
    throw new Error('[env] PUBLIC_BASE_URL is required when NODE_ENV=production')
  }

  return `http://localhost:${PORT}`
}

const PUBLIC_BASE_URL = resolvePublicBaseUrl()
const PUBLIC_ORIGIN = toOrigin(PUBLIC_BASE_URL)

const DATABASE_URL = readRequired('DATABASE_URL')
const JWT_ACCESS_SECRET = readRequired('JWT_ACCESS_SECRET')
const JWT_REFRESH_SECRET = readRequired('JWT_REFRESH_SECRET')

if (IS_PRODUCTION) {
  if (JWT_ACCESS_SECRET.length < 32) {
    throw new Error('[env] JWT_ACCESS_SECRET must be at least 32 characters in production')
  }

  if (JWT_REFRESH_SECRET.length < 32) {
    throw new Error('[env] JWT_REFRESH_SECRET must be at least 32 characters in production')
  }
}

const POLAR_ACCESS_TOKEN = readOptional('POLAR_ACCESS_TOKEN') ?? ''
const POLAR_WEBHOOK_SECRET = readOptional('POLAR_WEBHOOK_SECRET') ?? ''
const POLAR_PLUS_PRODUCT_ID = readOptional('POLAR_PLUS_PRODUCT_ID') ?? ''
const POLAR_PRO_PRODUCT_ID = readOptional('POLAR_PRO_PRODUCT_ID') ?? ''
const POLAR_ENVIRONMENT = normalizePolarEnvironment(process.env.POLAR_ENVIRONMENT)

const GMAIL_USER = readOptional('GMAIL_USER') ?? ''
const GMAIL_APP_PASSWORD = readOptional('GMAIL_APP_PASSWORD') ?? ''
const EMAIL_FROM = readOptional('EMAIL_FROM') ?? GMAIL_USER
const EMAIL_VERIFICATION_SECRET = readOptional('EMAIL_VERIFICATION_SECRET') ?? JWT_ACCESS_SECRET
const EMAIL_VERIFICATION_TTL_MINUTES = readInteger('EMAIL_VERIFICATION_TTL_MINUTES', 10)
const EMAIL_VERIFICATION_RESEND_SECONDS = readInteger('EMAIL_VERIFICATION_RESEND_SECONDS', 60)

const ALLOWED_ORIGINS = (() => {
  const configured = parseOriginList(readOptional('ALLOWED_ORIGINS'))
  if (configured.length > 0) return unique(configured)

  if (IS_PRODUCTION) return [PUBLIC_ORIGIN]

  return unique([PUBLIC_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'])
})()

export {
  ALLOWED_ORIGINS,
  DATABASE_URL,
  EMAIL_FROM,
  EMAIL_VERIFICATION_RESEND_SECONDS,
  EMAIL_VERIFICATION_SECRET,
  EMAIL_VERIFICATION_TTL_MINUTES,
  GMAIL_APP_PASSWORD,
  GMAIL_USER,
  HOST,
  IS_PRODUCTION,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  NODE_ENV,
  POLAR_ACCESS_TOKEN,
  POLAR_ENVIRONMENT,
  POLAR_PLUS_PRODUCT_ID,
  POLAR_PRO_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET,
  PORT,
  PUBLIC_BASE_URL,
  PUBLIC_ORIGIN,
}
