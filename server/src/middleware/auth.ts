import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken, UserPayload } from '../services/auth.service'

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: '인증이 필요합니다.' })
    return
  }

  const token = authHeader.slice(7)
  try {
    req.user = verifyAccessToken(token)
    next()
  } catch {
    res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' })
  }
}
