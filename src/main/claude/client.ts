import { BrowserWindow } from 'electron'
import { ChatSendPayload } from '../../shared/chat'

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ChatContentPart[]
}

export interface ServerChatRequest {
  systemPrompt: string
  messages: ChatMessage[]
}

export type RequestChatCompletion = (request: ServerChatRequest) => Promise<string>

const MAX_HISTORY = 20

export class ClaudeService {
  private history: ChatMessage[] = []
  private win: BrowserWindow | null = null

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

  async streamMessage(
    payload: ChatSendPayload,
    systemPrompt: string,
    requestCompletion: RequestChatCompletion
  ): Promise<string> {
    this.history.push({ role: 'user', content: this.buildUserContent(payload) })
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    let fullText = ''

    try {
      fullText = (await requestCompletion({
        systemPrompt,
        messages: this.history,
      })).trim()

      if (!fullText) {
        throw new Error('AI 응답이 비어 있습니다. 잠시 후 다시 시도해주세요.')
      }

      // The current request needs image data, but retaining base64 images in
      // history would make every later server request unnecessarily large.
      if (payload.attachments.length > 0) {
        const text = payload.text.trim()
        this.history[this.history.length - 1] = {
          role: 'user',
          content: [text, `[이미지 ${payload.attachments.length}개 첨부]`]
            .filter(Boolean)
            .join('\n'),
        }
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
