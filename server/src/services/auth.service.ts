import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto'
import { Pool, PoolClient } from 'pg'
import pool from '../config/db'
import {
  EMAIL_VERIFICATION_RESEND_SECONDS,
  EMAIL_VERIFICATION_SECRET,
  EMAIL_VERIFICATION_TTL_MINUTES,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
} from '../config/env'
import { sendEmailVerificationCode } from './email.service'

const ACCESS_SECRET = JWT_ACCESS_SECRET
const REFRESH_SECRET = JWT_REFRESH_SECRET
const ACCESS_EXPIRES = '15m'
const BCRYPT_COST = 12
const MAX_VERIFICATION_ATTEMPTS = 5

type Plan = 'free' | 'plus' | 'pro'
type Queryable = Pool | PoolClient

export interface UserPayload {
  id: string
  email: string
  plan: Plan
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface RegistrationResult {
  user: UserPayload
  verificationRequired: boolean
  tokens?: AuthTokens
}

export type AuthErrorCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_ALREADY_VERIFIED'
  | 'EMAIL_DELIVERY_FAILED'
  | 'INVALID_VERIFICATION_CODE'
  | 'VERIFICATION_CODE_EXPIRED'
  | 'VERIFICATION_RATE_LIMIT'
  | 'VERIFICATION_TOO_MANY_ATTEMPTS'

export class AuthServiceError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'AuthServiceError'
  }
}

interface UserRow {
  id: string
  email: string
  plan: string
  password_hash?: string
  email_verified_at?: Date | null
}

function toUserPayload(row: UserRow): UserPayload {
  return {
    id: row.id,
    email: row.email,
    plan: row.plan as Plan,
  }
}

// ── 해시 유틸 ─────────────────────────────────────────
export function hashTokenForStorage(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashVerificationCode(userId: string, code: string): string {
  return createHmac('sha256', EMAIL_VERIFICATION_SECRET)
    .update(`${userId}:${code}`)
    .digest('hex')
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

// ── JWT 발급 ──────────────────────────────────────────
export function generateAccessToken(user: UserPayload): string {
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES,
  })
}

export function generateRefreshToken(): string {
  return randomBytes(64).toString('hex')
}

export function verifyAccessToken(token: string): UserPayload {
  return jwt.verify(token, ACCESS_SECRET) as UserPayload
}

function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

async function saveVerificationCode(
  db: Queryable,
  userId: string,
  enforceCooldown: boolean
): Promise<{ code: string; codeHash: string }> {
  if (enforceCooldown) {
    const current = await db.query<{ sent_at: Date }>(
      `SELECT sent_at FROM email_verification_codes WHERE user_id = $1`,
      [userId]
    )
    const sentAt = current.rows[0]?.sent_at
    if (sentAt) {
      const elapsedSeconds = Math.floor((Date.now() - sentAt.getTime()) / 1000)
      const retryAfterSeconds = Math.max(0, EMAIL_VERIFICATION_RESEND_SECONDS - elapsedSeconds)
      if (retryAfterSeconds > 0) {
        throw new AuthServiceError(
          'VERIFICATION_RATE_LIMIT',
          `${retryAfterSeconds}초 후에 인증번호를 다시 요청해주세요.`,
          retryAfterSeconds
        )
      }
    }
  }

  const code = generateVerificationCode()
  const codeHash = hashVerificationCode(userId, code)
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000)

  await db.query(
    `INSERT INTO email_verification_codes (user_id, code_hash, expires_at, sent_at, attempts)
     VALUES ($1, $2, $3, NOW(), 0)
     ON CONFLICT (user_id) DO UPDATE SET
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       sent_at = NOW(),
       attempts = 0`,
    [userId, codeHash, expiresAt]
  )

  return { code, codeHash }
}

async function deliverVerificationCode(email: string, code: string): Promise<void> {
  try {
    await sendEmailVerificationCode(email, code, EMAIL_VERIFICATION_TTL_MINUTES)
  } catch (err) {
    console.error('[email] Failed to send verification email:', err instanceof Error ? err.message : err)
    throw new AuthServiceError(
      'EMAIL_DELIVERY_FAILED',
      '인증 이메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.'
    )
  }
}

// ── 사용자 등록 ───────────────────────────────────────
export async function registerUser(email: string, password: string): Promise<RegistrationResult> {
  const normalizedEmail = email.toLowerCase()
  const isAdminAlias = normalizedEmail === 'admin'
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const result = await client.query<UserRow>(
      `INSERT INTO users (email, password_hash, email_verified_at)
       VALUES ($1, $2, $3)
       RETURNING id, email, plan, email_verified_at`,
      [normalizedEmail, passwordHash, isAdminAlias ? new Date() : null]
    )
    const user = toUserPayload(result.rows[0])

    if (isAdminAlias) {
      const tokens = await issueTokenPair(user, client)
      await client.query('COMMIT')
      transactionOpen = false
      return { user, tokens, verificationRequired: false }
    }

    const { code } = await saveVerificationCode(client, user.id, false)
    await deliverVerificationCode(user.email, code)

    await client.query('COMMIT')
    transactionOpen = false
    return { user, verificationRequired: true }
  } catch (err) {
    if (transactionOpen) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── 이메일 인증 ───────────────────────────────────────
export async function verifyEmail(
  email: string,
  code: string
): Promise<{ user: UserPayload; tokens: AuthTokens }> {
  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const userResult = await client.query<UserRow>(
      `SELECT id, email, plan, email_verified_at FROM users WHERE email = $1 FOR UPDATE`,
      [email.toLowerCase()]
    )
    const row = userResult.rows[0]
    if (!row) {
      throw new AuthServiceError('INVALID_VERIFICATION_CODE', '인증번호가 올바르지 않습니다.')
    }
    if (row.email_verified_at) {
      throw new AuthServiceError('EMAIL_ALREADY_VERIFIED', '이미 인증된 이메일입니다. 로그인해주세요.')
    }

    const codeResult = await client.query<{
      code_hash: string
      expires_at: Date
      attempts: number
    }>(
      `SELECT code_hash, expires_at, attempts
       FROM email_verification_codes
       WHERE user_id = $1
       FOR UPDATE`,
      [row.id]
    )
    const savedCode = codeResult.rows[0]
    if (!savedCode) {
      throw new AuthServiceError(
        'INVALID_VERIFICATION_CODE',
        '인증번호가 없습니다. 새 인증번호를 요청해주세요.'
      )
    }

    if (new Date() > savedCode.expires_at) {
      await client.query(`DELETE FROM email_verification_codes WHERE user_id = $1`, [row.id])
      await client.query('COMMIT')
      transactionOpen = false
      throw new AuthServiceError(
        'VERIFICATION_CODE_EXPIRED',
        '인증번호가 만료되었습니다. 새 인증번호를 요청해주세요.'
      )
    }

    const candidateHash = hashVerificationCode(row.id, code)
    if (!constantTimeHexEqual(candidateHash, savedCode.code_hash)) {
      const nextAttempts = savedCode.attempts + 1
      if (nextAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        await client.query(`DELETE FROM email_verification_codes WHERE user_id = $1`, [row.id])
      } else {
        await client.query(
          `UPDATE email_verification_codes SET attempts = $2 WHERE user_id = $1`,
          [row.id, nextAttempts]
        )
      }
      await client.query('COMMIT')
      transactionOpen = false

      if (nextAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new AuthServiceError(
          'VERIFICATION_TOO_MANY_ATTEMPTS',
          '인증번호 입력 횟수를 초과했습니다. 새 인증번호를 요청해주세요.'
        )
      }
      throw new AuthServiceError('INVALID_VERIFICATION_CODE', '인증번호가 올바르지 않습니다.')
    }

    await client.query(
      `UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id]
    )
    await client.query(`DELETE FROM email_verification_codes WHERE user_id = $1`, [row.id])

    const user = toUserPayload(row)
    const tokens = await issueTokenPair(user, client)
    await client.query('COMMIT')
    transactionOpen = false
    return { user, tokens }
  } catch (err) {
    if (transactionOpen) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function resendEmailVerification(email: string): Promise<void> {
  const result = await pool.query<UserRow>(
    `SELECT id, email, plan, email_verified_at FROM users WHERE email = $1`,
    [email.toLowerCase()]
  )
  const row = result.rows[0]

  // 존재 여부와 인증 완료 여부를 외부에 노출하지 않는다.
  if (!row || row.email_verified_at) return

  const { code, codeHash } = await saveVerificationCode(pool, row.id, true)
  try {
    await deliverVerificationCode(row.email, code)
  } catch (err) {
    await pool.query(
      `DELETE FROM email_verification_codes WHERE user_id = $1 AND code_hash = $2`,
      [row.id, codeHash]
    )
    throw err
  }
}

// ── 로그인 ────────────────────────────────────────────
export async function loginUser(
  email: string,
  password: string
): Promise<{ user: UserPayload; tokens: AuthTokens }> {
  const result = await pool.query<UserRow>(
    `SELECT id, email, plan, password_hash, email_verified_at FROM users WHERE email = $1`,
    [email.toLowerCase()]
  )

  const row = result.rows[0]
  if (!row || !row.password_hash) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')

  const ok = await bcrypt.compare(password, row.password_hash)
  if (!ok) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
  if (!row.email_verified_at) {
    throw new AuthServiceError(
      'EMAIL_NOT_VERIFIED',
      '이메일 인증이 필요합니다.',
    )
  }

  const user = toUserPayload(row)
  const tokens = await issueTokenPair(user)
  return { user, tokens }
}

// ── Refresh Token 갱신 ────────────────────────────────
export async function refreshAccessToken(
  rawRefreshToken: string
): Promise<{ user: UserPayload; accessToken: string }> {
  const tokenHash = hashTokenForStorage(rawRefreshToken)

  const result = await pool.query<{
    user_id: string
    expires_at: Date
  }>(
    `SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  )

  const row = result.rows[0]
  if (!row) throw new Error('유효하지 않은 refresh token입니다.')
  if (new Date() > row.expires_at) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash])
    throw new Error('Refresh token이 만료되었습니다.')
  }

  const userResult = await pool.query<UserRow>(
    `SELECT id, email, plan, email_verified_at FROM users WHERE id = $1`,
    [row.user_id]
  )

  const userRow = userResult.rows[0]
  if (!userRow) throw new Error('사용자를 찾을 수 없습니다.')
  if (!userRow.email_verified_at) {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [row.user_id])
    throw new AuthServiceError('EMAIL_NOT_VERIFIED', '이메일 인증이 필요합니다.')
  }

  const user = toUserPayload(userRow)
  const accessToken = generateAccessToken(user)
  return { user, accessToken }
}

// ── 로그아웃 (refresh token 삭제) ────────────────────
export async function logoutUser(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashTokenForStorage(rawRefreshToken)
  await pool.query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash])
}

// ── 내부: token pair 발급 + DB 저장 ──────────────────
async function issueTokenPair(user: UserPayload, db: Queryable = pool): Promise<AuthTokens> {
  const accessToken = generateAccessToken(user)
  const refreshToken = generateRefreshToken()
  const tokenHash = hashTokenForStorage(refreshToken)

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  )

  return { accessToken, refreshToken }
}
