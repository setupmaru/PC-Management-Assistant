import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { ChatSendPayload } from '../../shared/chat'

export function useChat() {
  const {
    messages,
    isStreaming,
    addUserMessage,
    startAssistantMessage,
    addAssistantMessage,
    appendStreamChunk,
    finishAssistantMessage,
    clearMessages,
    hasApiKey,
    pendingWindowsUpdateConflictSessionId,
    setPendingWindowsUpdateConflictSessionId,
  } = useAppStore()

  const currentAssistantId = useRef<string | null>(null)

  useEffect(() => {
    const unsubStream = window.api.onStreamChunk((chunk) => {
      if (!currentAssistantId.current) return

      if (chunk.text) {
        appendStreamChunk(currentAssistantId.current, chunk.text)
      }

      if (chunk.done) {
        finishAssistantMessage(currentAssistantId.current)
        currentAssistantId.current = null
      }
    })

    const unsubPrompt = window.api.onWindowsUpdateConflictPrompt((data) => {
      setPendingWindowsUpdateConflictSessionId(data.sessionId)
      addAssistantMessage(data.question)
    })

    return () => {
      unsubStream()
      unsubPrompt()
    }
  }, [
    addAssistantMessage,
    appendStreamChunk,
    finishAssistantMessage,
    setPendingWindowsUpdateConflictSessionId,
  ])

  const sendMessage = async (input: string | ChatSendPayload) => {
    const payload = typeof input === 'string'
      ? { text: input, attachments: [] }
      : { text: input.text, attachments: input.attachments ?? [] }
    const userText = payload.text.trim()

    if ((!userText && payload.attachments.length === 0) || isStreaming) return
    if (!hasApiKey && !pendingWindowsUpdateConflictSessionId) return

    if (pendingWindowsUpdateConflictSessionId) {
      if (!userText) return

      addUserMessage({ text: userText, attachments: [] })
      const assistantId = startAssistantMessage()
      currentAssistantId.current = assistantId

      const sessionId = pendingWindowsUpdateConflictSessionId
      setPendingWindowsUpdateConflictSessionId(null)
      try {
        await window.api.submitAudioInterfaceAnswer(sessionId, userText)
      } catch {
        finishAssistantMessage(assistantId)
        currentAssistantId.current = null
      }
      return
    }

    const normalizedPayload: ChatSendPayload = {
      text: userText,
      attachments: payload.attachments,
    }

    addUserMessage(normalizedPayload)
    const assistantId = startAssistantMessage()
    currentAssistantId.current = assistantId

    try {
      await window.api.sendMessage(normalizedPayload)
    } catch {
      finishAssistantMessage(assistantId)
      currentAssistantId.current = null
    }
  }

  const clearChat = async () => {
    await window.api.clearHistory()
    setPendingWindowsUpdateConflictSessionId(null)
    clearMessages()
  }

  return {
    messages,
    isStreaming,
    sendMessage,
    clearChat,
    hasApiKey,
    pendingWindowsUpdateConflictSessionId,
  }
}
