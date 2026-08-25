import { Request, Response, Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { isPolarCheckoutConfigured, isPolarWebhookConfigured, PaidPlan } from '../config/polar'
import {
  cancelSubscription,
  checkAndUseChatLimit,
  createCustomerPortalUrl,
  createPolarCheckout,
  getSubscriptionStatus,
} from '../services/subscription.service'

const router = Router()

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await getSubscriptionStatus(req.user!.id))
  } catch (error) {
    console.error('[subscription] Failed to load status:', error)
    res.status(500).json({ error: '구독 상태를 불러오지 못했습니다.' })
  }
})

router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  if (!isPolarCheckoutConfigured() || !isPolarWebhookConfigured()) {
    res.status(503).json({
      error: 'Polar 결제가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.',
    })
    return
  }

  const plan: PaidPlan = req.body?.plan === 'plus' ? 'plus' : 'pro'

  try {
    const status = await getSubscriptionStatus(req.user!.id)
    if (status.plan !== 'free' && status.status) {
      const url = await createCustomerPortalUrl(req.user!.id)
      res.json({ url, portal: true })
      return
    }

    const url = await createPolarCheckout(
      req.user!.id,
      req.user!.email,
      plan,
      req.ip
    )
    res.json({ url })
  } catch (error) {
    console.error('[subscription] Failed to create Polar checkout:', error)
    res.status(502).json({ error: '결제창을 열지 못했습니다. 잠시 후 다시 시도해주세요.' })
  }
})

router.post('/portal', requireAuth, async (req: Request, res: Response) => {
  if (!isPolarCheckoutConfigured()) {
    res.status(503).json({ error: 'Polar 결제가 아직 설정되지 않았습니다.' })
    return
  }

  try {
    res.json({ url: await createCustomerPortalUrl(req.user!.id) })
  } catch (error) {
    console.error('[subscription] Failed to create Polar customer session:', error)
    res.status(502).json({ error: '구독 관리 페이지를 열지 못했습니다.' })
  }
})

router.post('/cancel', requireAuth, async (req: Request, res: Response) => {
  if (!isPolarCheckoutConfigured()) {
    res.status(503).json({ error: 'Polar 결제가 아직 설정되지 않았습니다.' })
    return
  }

  try {
    await cancelSubscription(req.user!.id)
    res.json({ success: true })
  } catch (error) {
    console.error('[subscription] Failed to cancel Polar subscription:', error)
    const message = error instanceof Error && error.message === '취소할 활성 구독이 없습니다.'
      ? error.message
      : '구독 취소에 실패했습니다.'
    res.status(message === '취소할 활성 구독이 없습니다.' ? 409 : 502).json({ error: message })
  }
})

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

    res.json(await checkAndUseChatLimit(req.user!.id))
  } catch (error) {
    console.error('[subscription] Failed to consume chat allowance:', error)
    res.status(500).json({ error: '채팅 사용량을 확인하지 못했습니다.' })
  }
})

export default router
