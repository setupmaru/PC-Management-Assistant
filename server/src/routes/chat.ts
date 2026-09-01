import express, { Request, Response, Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  createChatCompletion,
  isOpenAIConfigured,
  OpenAIChatContentPart,
  OpenAIChatMessage,
} from '../services/openai.service'
import {
  checkAndUseChatLimit,
  getSubscriptionStatus,
} from '../services/subscription.service'

const router = Router()
const MAX_SYSTEM_PROMPT_LENGTH = 100_000
const MAX_MESSAGES = 40
const MAX_TEXT_LENGTH = 50_000
const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024
const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i

function normalizeContentPart(value: unknown): OpenAIChatContentPart | null {
  if (!value || typeof value !== 'object') return null

  const part = value as {
    type?: unknown
    text?: unknown
    image_url?: { url?: unknown }
  }
  if (part.type === 'text') {
    if (typeof part.text !== 'string' || part.text.length > MAX_TEXT_LENGTH) return null
    return { type: 'text', text: part.text }
  }

  const url = part.image_url?.url
  if (
    part.type !== 'image_url'
    || typeof url !== 'string'
    || url.length > MAX_IMAGE_DATA_URL_LENGTH
    || !IMAGE_DATA_URL_PATTERN.test(url)
  ) {
    return null
  }

  return { type: 'image_url', image_url: { url } }
}

function normalizeMessages(value: unknown): OpenAIChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    return null
  }

  const messages: OpenAIChatMessage[] = []
  let imageCount = 0
  for (const valueMessage of value) {
    if (!valueMessage || typeof valueMessage !== 'object') return null
    const message = valueMessage as { role?: unknown; content?: unknown }
    if (message.role !== 'user' && message.role !== 'assistant') return null

    if (typeof message.content === 'string') {
      if (message.content.length > MAX_TEXT_LENGTH) return null
      messages.push({ role: message.role, content: message.content })
      continue
    }

    if (!Array.isArray(message.content) || message.content.length === 0) return null
    const content: OpenAIChatContentPart[] = []
    for (const valuePart of message.content) {
      const part = normalizeContentPart(valuePart)
      if (!part) return null
      if (part.type === 'image_url') imageCount += 1
      if (imageCount > MAX_IMAGE_COUNT) return null
      content.push(part)
    }
    messages.push({ role: message.role, content })
  }

  return messages
}

router.post(
  '/completions',
  requireAuth,
  express.json({ limit: '30mb' }),
  async (req: Request, res: Response) => {
    const systemPrompt = typeof req.body?.systemPrompt === 'string'
      ? req.body.systemPrompt
      : ''
    const messages = normalizeMessages(req.body?.messages)

    if (!systemPrompt || systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH || !messages) {
      res.status(400).json({ error: '유효하지 않은 채팅 요청입니다.' })
      return
    }

    if (!isOpenAIConfigured()) {
      res.status(503).json({ error: 'AI 서비스가 서버에 설정되지 않았습니다.' })
      return
    }

    try {
      const status = await getSubscriptionStatus(req.user!.id)
      let remaining = -1

      if (status.plan === 'free') {
        res.status(403).json({ error: '채팅은 Plus 이상 플랜에서만 이용 가능합니다.' })
        return
      }
      if (status.plan === 'plus') {
        const allowance = await checkAndUseChatLimit(req.user!.id)
        if (!allowance.allowed) {
          res.status(429).json({ error: '오늘 채팅 한도를 초과했습니다. Pro 플랜에서 무제한으로 이용 가능합니다.' })
          return
        }
        remaining = allowance.remaining
      }

      const text = await createChatCompletion(systemPrompt, messages)
      res.json({ text, remaining })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[chat] OpenAI completion failed:', message)
      res.status(502).json({ error: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.' })
    }
  }
)

export default router
