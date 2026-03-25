import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createHash, randomBytes } from 'crypto'
import pool from '../config/db'
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } from '../config/env'

const ACCESS_SECRET = JWT_ACCESS_SECRET
const REFRESH_SECRET = JWT_REFRESH_SECRET
const ACCESS_EXPIRES = '15m'
const REFRESH_EXPIRES = '30d'
const BCRYPT_COST = 12

export interface UserPayload {
  id: string
  email: string
  plan: 'free' | 'pro'
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

// ── 해시 유틸 ─────────────────────────────────────────
export function hashTokenForStorage(token: string): string {
  return createHash('sha256').update(token).digest('hex')
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

// ── 사용자 등록 ───────────────────────────────────────
export async function registerUser(
  email: string,
  password: string
): Promise<{ user: UserPayload; tokens: AuthTokens }> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const result = await pool.query<{ id: string; email: string; plan: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, plan`,
    [email.toLowerCase(), passwordHash]
  )

  const user: UserPayload = {
    id: result.rows[0].id,
    email: result.rows[0].email,
    plan: result.rows[0].plan as 'free' | 'pro',
  }

  const tokens = await issueTokenPair(user)
  return { user, tokens }
}

// ── 로그인 ────────────────────────────────────────────
export async function loginUser(
  email: string,
  password: string
): Promise<{ user: UserPayload; tokens: AuthTokens }> {
  const result = await pool.query<{
    id: string
    email: string
    plan: string
    password_hash: string
  }>(`SELECT id, email, plan, password_hash FROM users WHERE email = $1`, [email.toLowerCase()])

  const row = result.rows[0]
  if (!row) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')

  const ok = await bcrypt.compare(password, row.password_hash)
  if (!ok) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')

  const user: UserPayload = { id: row.id, email: row.email, plan: row.plan as 'free' | 'pro' }
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

  const userResult = await pool.query<{ id: string; email: string; plan: string }>(
    `SELECT id, email, plan FROM users WHERE id = $1`,
    [row.user_id]
  )

  const userRow = userResult.rows[0]
  if (!userRow) throw new Error('사용자를 찾을 수 없습니다.')

  const user: UserPayload = {
    id: userRow.id,
    email: userRow.email,
    plan: userRow.plan as 'free' | 'pro',
  }

  const accessToken = generateAccessToken(user)
  return { user, accessToken }
}

// ── 로그아웃 (refresh token 삭제) ────────────────────
export async function logoutUser(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashTokenForStorage(rawRefreshToken)
  await pool.query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash])
}

// ── 내부: token pair 발급 + DB 저장 ──────────────────
async function issueTokenPair(user: UserPayload): Promise<AuthTokens> {
  const accessToken = generateAccessToken(user)
  const refreshToken = generateRefreshToken()
  const tokenHash = hashTokenForStorage(refreshToken)

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  )

  return { accessToken, refreshToken }
}
