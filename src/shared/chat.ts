export interface ChatImageAttachment {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  size: number
}

export interface ChatSendPayload {
  text: string
  attachments: ChatImageAttachment[]
}
