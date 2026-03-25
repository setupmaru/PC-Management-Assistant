import dotenv from 'dotenv'

dotenv.config()

type NodeEnv = 'development' | 'production' | 'test'

function normalizeNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') return value
  return 'development'
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

const TOSS_CLIENT_KEY = readRequired('TOSS_CLIENT_KEY')
const TOSS_SECRET_KEY = readRequired('TOSS_SECRET_KEY')
const TOSS_WEBHOOK_SECRET = readOptional('TOSS_WEBHOOK_SECRET') ?? ''
const TOSS_PLUS_PRICE = readInteger('TOSS_PLUS_PRICE', 4900)
const TOSS_PRO_PRICE = readInteger('TOSS_PRO_PRICE', 15000)
const STRIPE_SECRET_KEY = readOptional('STRIPE_SECRET_KEY') ?? ''

const ALLOWED_ORIGINS = (() => {
  const configured = parseOriginList(readOptional('ALLOWED_ORIGINS'))
  if (configured.length > 0) return unique(configured)

  if (IS_PRODUCTION) return [PUBLIC_ORIGIN]

  return unique([PUBLIC_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'])
})()

export {
  ALLOWED_ORIGINS,
  DATABASE_URL,
  HOST,
  IS_PRODUCTION,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  NODE_ENV,
  PORT,
  PUBLIC_BASE_URL,
  PUBLIC_ORIGIN,
  STRIPE_SECRET_KEY,
  TOSS_CLIENT_KEY,
  TOSS_PLUS_PRICE,
  TOSS_PRO_PRICE,
  TOSS_SECRET_KEY,
  TOSS_WEBHOOK_SECRET,
}
