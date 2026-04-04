import { create } from 'zustand'
import { ChatImageAttachment, ChatSendPayload } from '../../shared/chat'
import { AppUpdateState } from '../../shared/updater'

export interface MetricsState {
  cpu: {
    usage: number
    cores: number
    performanceCores?: number
    efficiencyCores?: number
    speed: number
    model?: string
    temperature?: number
  }
  memory: { total: number; used: number; free: number; usagePercent: number }
  disks: { mount: string; fs: string; size: number; used: number; usagePercent: number }[]
  network: { iface: string; rxSec: number; txSec: number }[]
  timestamp: number
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  mem: number
  memRss: number
}

export interface EventLogEntry {
  TimeCreated: string
  Id: number
  LevelDisplayName: string
  ProviderName: string
  Message: string
}

export interface EventLogState {
  events: EventLogEntry[]
  error?: string
  hasSecurityLog: boolean
}

export interface WindowsUpdateState {
  count: number
  updates: { Title: string; Severity: string }[]
  error?: string
  checkedAt: number
  isChecking: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatImageAttachment[]
  streaming?: boolean
  timestamp: number
}

export interface CurrentUser {
  id: string
  email: string
  plan: 'free' | 'plus' | 'pro'
}

export interface SubscriptionStatus {
  plan: 'free' | 'plus' | 'pro'
  status: string | null
  periodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export type AuthStatus = 'loading' | 'login' | 'authenticated'

interface AppState {
  // 인증
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  subscriptionStatus: SubscriptionStatus | null
  setAuthStatus: (status: AuthStatus) => void
  setCurrentUser: (user: CurrentUser | null) => void
  setSubscriptionStatus: (status: SubscriptionStatus | null) => void

  // 메트릭
  metrics: MetricsState | null
  processes: ProcessInfo[]
  eventLog: EventLogState
  windowsUpdate: WindowsUpdateState
  setMetrics: (metrics: MetricsState) => void
  setProcesses: (processes: ProcessInfo[]) => void
  setEventLog: (log: EventLogState) => void
  setWindowsUpdate: (update: WindowsUpdateState) => void

  // 채팅
  messages: ChatMessage[]
  isStreaming: boolean
  addUserMessage: (payload: ChatSendPayload) => string
  startAssistantMessage: () => string
  addAssistantMessage: (text: string) => string
  appendStreamChunk: (id: string, text: string) => void
  finishAssistantMessage: (id: string) => void
  clearMessages: () => void
  pendingWindowsUpdateConflictSessionId: string | null
  setPendingWindowsUpdateConflictSessionId: (sessionId: string | null) => void

  // 설정
  hasApiKey: boolean
  maskedApiKey: string | null
  setApiKeyStatus: (hasKey: boolean, maskedKey: string | null) => void

  // UI
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  showPricingModal: boolean
  setShowPricingModal: (v: boolean) => void
  showRegister: boolean
  setShowRegister: (v: boolean) => void
  appUpdate: AppUpdateState
  setAppUpdate: (update: AppUpdateState) => void
}

export const useAppStore = create<AppState>((set) => ({
  // 인증
  authStatus: 'login',
  currentUser: null,
  subscriptionStatus: null,
  setAuthStatus: (authStatus) => set({ authStatus }),
  setCurrentUser: (currentUser) => set({ currentUser }),
  setSubscriptionStatus: (subscriptionStatus) => set({ subscriptionStatus }),

  // 메트릭
  metrics: {
    cpu: { usage: 0, cores: 0, performanceCores: 0, efficiencyCores: 0, speed: 0, model: '' },
    memory: { total: 0, used: 0, free: 0, usagePercent: 0 },
    disks: [],
    network: [],
    timestamp: 0,
  },
  processes: [],
  eventLog: { events: [], hasSecurityLog: false },
  windowsUpdate: { count: -1, updates: [], checkedAt: 0, isChecking: true },
  setMetrics: (metrics) => set({ metrics }),
  setProcesses: (processes) => set({ processes }),
  setEventLog: (eventLog) => set({ eventLog }),
  setWindowsUpdate: (windowsUpdate) => set({ windowsUpdate }),

  // 채팅
  messages: [],
  isStreaming: false,
  addUserMessage: (payload) => {
    const id = `user-${Date.now()}`
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: 'user',
          content: payload.text,
          attachments: payload.attachments.length > 0 ? [...payload.attachments] : undefined,
          timestamp: Date.now(),
        },
      ],
    }))
    return id
  },
  startAssistantMessage: () => {
    const id = `assistant-${Date.now()}`
    set((state) => ({
      isStreaming: true,
      messages: [
        ...state.messages,
        { id, role: 'assistant', content: '', streaming: true, timestamp: Date.now() },
      ],
    }))
    return id
  },
  addAssistantMessage: (text) => {
    const id = `assistant-${Date.now()}`
    set((state) => ({
      messages: [
        ...state.messages,
        { id, role: 'assistant', content: text, streaming: false, timestamp: Date.now() },
      ],
    }))
    return id
  },
  appendStreamChunk: (id, text) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + text } : m
      ),
    }))
  },
  finishAssistantMessage: (id) => {
    set((state) => ({
      isStreaming: false,
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      ),
    }))
  },
  clearMessages: () => set({
    messages: [],
    isStreaming: false,
    pendingWindowsUpdateConflictSessionId: null,
  }),
  pendingWindowsUpdateConflictSessionId: null,
  setPendingWindowsUpdateConflictSessionId: (pendingWindowsUpdateConflictSessionId) =>
    set({ pendingWindowsUpdateConflictSessionId }),

  // 설정
  hasApiKey: false,
  maskedApiKey: null,
  setApiKeyStatus: (hasKey, maskedKey) => set({ hasApiKey: hasKey, maskedApiKey: maskedKey }),

  // UI
  showSettings: false,
  setShowSettings: (v) => set({ showSettings: v }),
  showPricingModal: false,
  setShowPricingModal: (v) => set({ showPricingModal: v }),
  showRegister: false,
  setShowRegister: (v) => set({ showRegister: v }),
  appUpdate: {
    enabled: false,
    status: 'disabled',
    currentVersion: '0.0.0',
    availableVersion: null,
    progressPercent: null,
    transferredBytes: 0,
    totalBytes: 0,
    error: null,
    checkedAt: null,
  },
  setAppUpdate: (appUpdate) => set({ appUpdate }),
}))
