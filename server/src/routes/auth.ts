import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  AuthServiceError,
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  verifyEmail,
} from '../services/auth.service'

const router = Router()
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function sendAuthServiceError(res: Response, err: AuthServiceError): void {
  if (err.code === 'EMAIL_NOT_VERIFIED') {
    res.status(403).json({
      error: err.message,
      code: err.code,
      verificationRequired: true,
    })
    return
  }
  if (err.code === 'EMAIL_DELIVERY_FAILED') {
    res.status(503).json({ error: err.message, code: err.code })
    return
  }
  if (err.code === 'VERIFICATION_RATE_LIMIT') {
    if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds))
    res.status(429).json({
      error: err.message,
      code: err.code,
      retryAfterSeconds: err.retryAfterSeconds,
    })
    return
  }
  if (err.code === 'VERIFICATION_CODE_EXPIRED') {
    res.status(410).json({ error: err.message, code: err.code })
    return
  }
  if (err.code === 'VERIFICATION_TOO_MANY_ATTEMPTS' || err.code === 'PASSWORD_RESET_TOO_MANY_ATTEMPTS') {
    res.status(429).json({ error: err.message, code: err.code })
    return
  }
  if (err.code === 'PASSWORD_RESET_CODE_EXPIRED') {
    res.status(410).json({ error: err.message, code: err.code })
    return
  }
  if (err.code === 'EMAIL_ALREADY_VERIFIED') {
    res.status(409).json({ error: err.message, code: err.code })
    return
  }

  res.status(400).json({ error: err.message, code: err.code })
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' })
      return
    }
    if (password.length < 8) {
      res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })
      return
    }
    const normalizedEmail = normalizeEmail(email)
    const isAdminAlias = normalizedEmail === 'admin'
    if (!isAdminAlias && !emailRe.test(normalizedEmail)) {
      res.status(400).json({ error: '유효한 이메일 주소를 입력해주세요.' })
      return
    }

    const { user, tokens, verificationRequired } = await registerUser(normalizedEmail, password)
    res.status(201).json({
      user,
      ...(tokens ?? {}),
      verificationRequired,
      message: verificationRequired ? '입력한 이메일로 인증번호를 보냈습니다.' : undefined,
    })
  } catch (err: unknown) {
    if (err instanceof AuthServiceError) {
      sendAuthServiceError(res, err)
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    const dbCode = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
    if (dbCode === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ error: '이미 사용 중인 이메일입니다.' })
    } else {
      console.error('[auth] Registration failed:', msg)
      res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' })
    }
  }
})

// POST /api/auth/verify-email
router.post('/verify-email', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email)
  const code = String(req.body?.code ?? '').trim()
  if (!emailRe.test(email) || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: '이메일과 6자리 인증번호를 확인해주세요.' })
    return
  }

  try {
    const { user, tokens } = await verifyEmail(email, code)
    res.json({ user, ...tokens })
  } catch (err: unknown) {
    if (err instanceof AuthServiceError) {
      sendAuthServiceError(res, err)
      return
    }
    console.error('[auth] Email verification failed:', err)
    res.status(500).json({ error: '이메일 인증 처리 중 오류가 발생했습니다.' })
  }
})

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email)
  if (!emailRe.test(email)) {
    res.status(400).json({ error: '유효한 이메일 주소를 입력해주세요.' })
    return
  }

  try {
    await resendEmailVerification(email)
    res.json({ success: true, message: '인증이 필요한 계정이라면 인증번호를 전송했습니다.' })
  } catch (err: unknown) {
    if (err instanceof AuthServiceError) {
      sendAuthServiceError(res, err)
      return
    }
    console.error('[auth] Verification resend failed:', err)
    res.status(500).json({ error: '인증번호 재전송 중 오류가 발생했습니다.' })
  }
})

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email)
  if (!emailRe.test(email)) {
    res.status(400).json({ error: '유효한 이메일 주소를 입력해주세요.' })
    return
  }

  void requestPasswordReset(email).catch((err) => {
    // 계정 존재 여부, 재전송 제한, 메일 장애 여부를 응답으로 구분하지 않는다.
    console.error('[auth] Password reset request failed:', err instanceof Error ? err.message : err)
  })

  res.json({
    success: true,
    message: '해당 이메일 계정이 존재하면 인증번호를 전송했습니다.',
  })
})

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email)
  const code = String(req.body?.code ?? '').trim()
  const newPassword = String(req.body?.newPassword ?? '')

  if (!emailRe.test(email) || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: '이메일과 6자리 인증번호를 확인해주세요.' })
    return
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' })
    return
  }

  try {
    await resetPassword(email, code, newPassword)
    res.json({ success: true, message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.' })
  } catch (err: unknown) {
    if (err instanceof AuthServiceError) {
      sendAuthServiceError(res, err)
      return
    }
    console.error('[auth] Password reset failed:', err)
    res.status(500).json({ error: '비밀번호 재설정 중 오류가 발생했습니다.' })
  }
})

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' })
      return
    }

    const { user, tokens } = await loginUser(email, password)
    res.json({ user, ...tokens })
  } catch (err: unknown) {
    if (err instanceof AuthServiceError) {
      sendAuthServiceError(res, err)
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    res.status(401).json({ error: msg })
  }
})

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken이 필요합니다.' })
      return
    }

    const { user, accessToken } = await refreshAccessToken(refreshToken)
    res.json({ user, accessToken })
  } catch (err: unknown) {
    if (err instanceof AuthServiceError) {
      sendAuthServiceError(res, err)
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    res.status(401).json({ error: msg })
  }
})

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body
    if (refreshToken) {
      await logoutUser(refreshToken)
    }
    res.json({ success: true })
  } catch {
    res.json({ success: true })
  }
})

export default router
