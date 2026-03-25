import { BrowserWindow } from 'electron'
import { ChatSendPayload } from '../../shared/chat'

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ChatContentPart[]
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const MAX_HISTORY = 20

export class ClaudeService {
  private apiKey: string | null = null
  private history: ChatMessage[] = []
  private win: BrowserWindow | null = null

  initialize(apiKey: string, win: BrowserWindow): void {
    this.updateApiKey(apiKey)
    this.win = win
  }

  updateApiKey(apiKey: string): void {
    const trimmed = apiKey.trim()
    this.apiKey = trimmed.length > 0 ? trimmed : null
  }

  setWindow(win: BrowserWindow): void {
    this.win = win
  }

  private buildUserContent(payload: ChatSendPayload): string | ChatContentPart[] {
    if (payload.attachments.length === 0) {
      return payload.text.trim()
    }

    const parts: ChatContentPart[] = []
    const text = payload.text.trim()
    if (text) {
      parts.push({ type: 'text', text })
    }

    for (const attachment of payload.attachments) {
      parts.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl },
      })
    }

    return parts
  }

  async streamMessage(payload: ChatSendPayload, systemPrompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key가 설정되지 않았습니다.')
    }

    this.history.push({ role: 'user', content: this.buildUserContent(payload) })
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    let fullText = ''

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.history.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`OpenAI API error (${res.status}): ${errText}`)
      }

      const data = await res.json() as {
        choices?: Array<{
          message?: {
            content?: string
          }
        }>
      }

      fullText = data.choices?.[0]?.message?.content?.trim() ?? ''

      if (!fullText) {
        throw new Error('API 응답이 비어 있습니다. API 키와 모델을 확인해주세요.')
      }

      this.win?.webContents.send('chat:streamChunk', { text: fullText, done: false })
      this.win?.webContents.send('chat:streamChunk', { text: '', done: true })
      this.history.push({ role: 'assistant', content: fullText })
    } catch (err) {
      this.history.pop()
      throw err
    }

    return fullText
  }

  clearHistory(): void {
    this.history = []
  }

  getHistory(): ChatMessage[] {
    return [...this.history]
  }
}
