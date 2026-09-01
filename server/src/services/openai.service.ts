import { OPENAI_API_KEY, OPENAI_MODEL } from '../config/env'

export type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface OpenAIChatMessage {
  role: 'user' | 'assistant'
  content: string | OpenAIChatContentPart[]
}

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_REQUEST_TIMEOUT_MS = 60_000

export function isOpenAIConfigured(): boolean {
  return OPENAI_API_KEY.startsWith('sk-') && OPENAI_API_KEY.length >= 20
}

export async function createChatCompletion(
  systemPrompt: string,
  messages: OpenAIChatMessage[]
): Promise<string> {
  if (!isOpenAIConfigured()) {
    throw new Error('OPENAI_NOT_CONFIGURED')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`OPENAI_UPSTREAM_${response.status}`)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) {
      throw new Error('OPENAI_EMPTY_RESPONSE')
    }

    return text
  } finally {
    clearTimeout(timeout)
  }
}
