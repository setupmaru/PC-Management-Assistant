import { Request, Response, NextFunction } from 'express'

export function requirePro(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.plan !== 'pro') {
    res.status(403).json({ error: 'Pro 구독이 필요한 기능입니다.' })
    return
  }
  next()
}
