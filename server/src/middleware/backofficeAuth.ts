import { timingSafeEqual } from 'crypto'
import { NextFunction, Request, Response } from 'express'

import { BACKOFFICE_API_TOKEN } from '../config/env'

export function requireBackofficeToken(req: Request, res: Response, next: NextFunction): void {
  if (!BACKOFFICE_API_TOKEN) {
    res.status(503).json({ error: '백오피스 API 인증이 설정되지 않았습니다.' })
    return
  }

  const authorization = req.headers.authorization
  const candidate = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  const expectedBuffer = Buffer.from(BACKOFFICE_API_TOKEN)
  const candidateBuffer = Buffer.from(candidate)

  if (
    candidateBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(candidateBuffer, expectedBuffer)
  ) {
    res.status(401).json({ error: '유효하지 않은 백오피스 API 인증입니다.' })
    return
  }

  next()
}
