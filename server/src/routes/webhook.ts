import { Request, Response, Router } from 'express'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { getPolarWebhookSecret, isPolarWebhookConfigured } from '../config/polar'
import { syncPolarSubscription } from '../services/subscription.service'

const router = Router()

function stringHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[name] = value
    else if (Array.isArray(value)) headers[name] = value.join(',')
  }
  return headers
}

router.post('/', async (req: Request, res: Response) => {
  if (!isPolarWebhookConfigured()) {
    res.status(503).json({ error: 'Polar webhook is not configured.' })
    return
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Expected a raw webhook payload.' })
    return
  }

  try {
    const event = validateEvent(req.body, stringHeaders(req), getPolarWebhookSecret())

    switch (event.type) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.active':
      case 'subscription.canceled':
      case 'subscription.uncanceled':
      case 'subscription.revoked':
      case 'subscription.past_due':
        await syncPolarSubscription(event.data)
        console.log(`[webhook] Polar ${event.type}: ${event.data.id}`)
        break
      default:
        break
    }

    res.status(202).json({ received: true })
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      res.status(403).json({ error: 'Invalid Polar webhook signature.' })
      return
    }

    console.error('[webhook] Failed to process Polar event:', error)
    res.status(500).json({ error: 'Failed to process Polar webhook.' })
  }
})

export default router
