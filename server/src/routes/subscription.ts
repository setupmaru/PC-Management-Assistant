import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  getSubscriptionStatus,
  renewWithBillingKey,
  cancelSubscription,
  checkAndUseChatLimit,
} from '../services/subscription.service'
import { generateBillingToken } from './billing'
import { isConfigured } from '../config/toss'
import { makeApiUrl } from '../config/app'

const router = Router()

// GET /api/subscription/status
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = await getSubscriptionStatus(req.user!.id)
    res.json(status)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// POST /api/subscription/checkout
// - 빌링키 없음: 카드 등록 페이지 URL 반환
// - 빌링키 있음: 즉시 갱신 결제
router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  if (!isConfigured()) {
    res.status(503).json({
      error:
        '토스페이먼츠 키가 설정되지 않았습니다. server/.env에 TOSS_CLIENT_KEY와 TOSS_SECRET_KEY를 입력해주세요.',
    })
    return
  }

  const plan: 'plus' | 'pro' = req.body?.plan === 'plus' ? 'plus' : 'pro'

  try {
    const status = await getSubscriptionStatus(req.user!.id)

    if (status.hasBillingKey) {
      // 빌링키 있으면 즉시 갱신
      await renewWithBillingKey(req.user!.id, req.user!.email, plan)
      res.json({ renewed: true })
      return
    }

    // 빌링키 없으면 카드 등록 페이지 URL 반환
    const token = generateBillingToken(req.user!.id, plan)
    const url = makeApiUrl(`/api/billing/page?token=${encodeURIComponent(token)}`)
    res.json({ url })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// POST /api/subscription/cancel
router.post('/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    await cancelSubscription(req.user!.id)
    res.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// POST /api/subscription/chat-use
// Plus 일일 채팅 한도 확인 및 소비 (Pro는 무제한, Free는 거부)
router.post('/chat-use', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = await getSubscriptionStatus(req.user!.id)

    if (status.plan === 'free') {
      res.status(403).json({ allowed: false, remaining: 0, error: '채팅은 Plus 이상 플랜에서만 이용 가능합니다.' })
      return
    }

    if (status.plan === 'pro') {
      res.json({ allowed: true, remaining: -1 })
      return
    }

    // Plus: 일일 한도 확인
    const result = await checkAndUseChatLimit(req.user!.id)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

export default router
