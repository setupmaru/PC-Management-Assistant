import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
} from '../services/auth.service'

const router = Router()

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
    const normalizedEmail = String(email).trim().toLowerCase()
    const isAdminAlias = normalizedEmail === 'admin'
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!isAdminAlias && !emailRe.test(normalizedEmail)) {
      res.status(400).json({ error: '유효한 이메일 주소를 입력해주세요.' })
      return
    }

    const { user, tokens } = await registerUser(normalizedEmail, password)
    res.status(201).json({ user, ...tokens })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ error: '이미 사용 중인 이메일입니다.' })
    } else {
      res.status(500).json({ error: msg })
    }
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
