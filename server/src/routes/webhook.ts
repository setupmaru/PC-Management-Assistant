import { Request, Response, Router } from 'express'
import { TOSS_WEBHOOK_SECRET } from '../config/env'

const router = Router()

router.post('/', (req: Request, res: Response) => {
  if (TOSS_WEBHOOK_SECRET) {
    const { secret } = req.body as { secret?: string }
    if (secret !== TOSS_WEBHOOK_SECRET) {
      res.status(401).json({ error: 'Invalid webhook secret.' })
      return
    }
  }

  const { status, orderId } = req.body as { status?: string; orderId?: string }
  console.log(`[webhook] TossPayments: status=${status}, orderId=${orderId}`)

  res.json({ received: true })
})

export default router
