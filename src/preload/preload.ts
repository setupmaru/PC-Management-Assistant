import { contextBridge, ipcRenderer } from 'electron'
import { ChatSendPayload } from '../shared/chat'
import { AppUpdateState } from '../shared/updater'

export interface SystemMetricsUpdate {
  metrics: {
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
  processes: { pid: number; name: string; cpu: number; mem: number; memRss: number }[]
}

export interface StreamChunk {
  text: string
  done: boolean
}

export interface WindowsUpdateConflictPrompt {
  sessionId: string
  question: string
}

export interface ConflictEvidence {
  source: string
  title: string
  snippet: string
  url: string
}

export interface ConflictResult {
  risk: 'high' | 'possible' | 'none'
  summary: string
  matchedUpdates: { title: string; severity: string }[]
  evidence: ConflictEvidence[]
  searchedAt: number
}

export interface SystemMaintenanceStep {
  key: 'memory' | 'startup' | 'disk' | 'network' | 'dcom' | 'windowsUpdate'
  title: string
  status: 'success' | 'warning' | 'error'
  detail: string
}

export interface SystemMaintenanceReport {
  startedAt: number
  finishedAt: number
  steps: SystemMaintenanceStep[]
  summary: string
}

export interface EventLogUpdate {
  events: {
    TimeCreated: string
    Id: number
    LevelDisplayName: string
    ProviderName: string
    Message: string
  }[]
  error?: string
  hasSecurityLog: boolean
}

export interface WindowsUpdateUpdate {
  count: number
  updates: { Title: string; Severity: string }[]
  error?: string
  checkedAt: number
  isChecking: boolean
}

export interface User {
  id: string
  email: string
  plan: 'free' | 'plus' | 'pro'
}

export interface AuthConnectionInfo {
  reachable: boolean
  activeBase: string
  triedBases: string[]
  error?: string
}

export interface SubscriptionStatus {
  plan: 'free' | 'plus' | 'pro'
  status: string | null
  periodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export interface UpdateApplyResult {
  success: boolean
  error?: string
}

const api = {
  auth: {
    login: (email: string, password: string) =>
      ipcRenderer.invoke('auth:login', email, password) as Promise<{
        success: boolean
        user?: User
        error?: string
      }>,
    register: (email: string, password: string) =>
      ipcRenderer.invoke('auth:register', email, password) as Promise<{
        success: boolean
        user?: User
        error?: string
      }>,
    refreshToken: () =>
      ipcRenderer.invoke('auth:refreshToken') as Promise<{
        success: boolean
        user?: User
      }>,
    logout: () =>
      ipcRenderer.invoke('auth:logout') as Promise<{ success: boolean }>,
    getConnectionInfo: () =>
      ipcRenderer.invoke('auth:getConnectionInfo') as Promise<AuthConnectionInfo>,
  },

  subscription: {
    getStatus: () =>
      ipcRenderer.invoke('subscription:getStatus') as Promise<{
        success: boolean
        data?: SubscriptionStatus
        error?: string
      }>,
    openCheckout: (plan: 'plus' | 'pro') =>
      ipcRenderer.invoke('subscription:openCheckout', plan) as Promise<{
        success: boolean
        renewed?: boolean
        status?: SubscriptionStatus | null
        error?: string
      }>,
    chatUse: () =>
      ipcRenderer.invoke('subscription:chatUse') as Promise<{
        allowed: boolean
        remaining: number
        error?: string
      }>,
    cancel: () =>
      ipcRenderer.invoke('subscription:cancel') as Promise<{
        success: boolean
        error?: string
      }>,
  },

  saveApiKey: (key: string) => ipcRenderer.invoke('settings:saveApiKey', key),
  loadApiKey: () => ipcRenderer.invoke('settings:loadApiKey') as Promise<{ hasKey: boolean; maskedKey: string | null }>,

  sendMessage: (payload: ChatSendPayload) => ipcRenderer.invoke('chat:sendMessage', payload),
  clearHistory: () => ipcRenderer.invoke('chat:clearHistory'),

  getSnapshot: () => ipcRenderer.invoke('system:getSnapshot'),
  getLastSnapshot: () => ipcRenderer.invoke('system:getLastSnapshot'),
  checkWindowsUpdates: () => ipcRenderer.invoke('system:checkWindowsUpdates'),
  runMaintenance: () =>
    ipcRenderer.invoke('system:runMaintenance') as Promise<{
      success: boolean
      data?: SystemMaintenanceReport
      error?: string
    }>,
  getLastMaintenanceReport: () =>
    ipcRenderer.invoke('system:getLastMaintenanceReport') as Promise<{
      success: boolean
      data?: SystemMaintenanceReport | null
      error?: string
    }>,
  startWindowsUpdateConflictFlow: () =>
    ipcRenderer.invoke('system:startWindowsUpdateConflictFlow') as Promise<{
      success: boolean
      sessionId?: string
      error?: string
    }>,
  submitAudioInterfaceAnswer: (sessionId: string, audioInterface: string) =>
    ipcRenderer.invoke('system:submitAudioInterfaceAnswer', sessionId, audioInterface) as Promise<{
      success: boolean
      result?: ConflictResult
      error?: string
    }>,

  onMetricsUpdate: (cb: (data: SystemMetricsUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: SystemMetricsUpdate) => cb(data)
    ipcRenderer.on('system:metricsUpdate', handler)
    return () => ipcRenderer.removeListener('system:metricsUpdate', handler)
  },

  onProcessesUpdate: (cb: (data: SystemMetricsUpdate['processes']) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: SystemMetricsUpdate['processes']) => cb(data)
    ipcRenderer.on('system:processesUpdate', handler)
    return () => ipcRenderer.removeListener('system:processesUpdate', handler)
  },

  onEventsUpdate: (cb: (data: EventLogUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: EventLogUpdate) => cb(data)
    ipcRenderer.on('system:eventsUpdate', handler)
    return () => ipcRenderer.removeListener('system:eventsUpdate', handler)
  },

  onWindowsUpdateUpdate: (cb: (data: WindowsUpdateUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: WindowsUpdateUpdate) => cb(data)
    ipcRenderer.on('system:windowsUpdateUpdate', handler)
    return () => ipcRenderer.removeListener('system:windowsUpdateUpdate', handler)
  },

  onStreamChunk: (cb: (chunk: StreamChunk) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: StreamChunk) => cb(chunk)
    ipcRenderer.on('chat:streamChunk', handler)
    return () => ipcRenderer.removeListener('chat:streamChunk', handler)
  },

  onWindowsUpdateConflictPrompt: (cb: (data: WindowsUpdateConflictPrompt) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: WindowsUpdateConflictPrompt) => cb(data)
    ipcRenderer.on('chat:windowsUpdateConflictPrompt', handler)
    return () => ipcRenderer.removeListener('chat:windowsUpdateConflictPrompt', handler)
  },

  updater: {
    getState: () =>
      ipcRenderer.invoke('updater:getState') as Promise<AppUpdateState>,
    check: () =>
      ipcRenderer.invoke('updater:check') as Promise<UpdateApplyResult>,
    apply: () =>
      ipcRenderer.invoke('updater:apply') as Promise<UpdateApplyResult>,
    onStateChange: (cb: (state: AppUpdateState) => void) => {
      const handler = (_: Electron.IpcRendererEvent, state: AppUpdateState) => cb(state)
      ipcRenderer.on('app:updateState', handler)
      return () => ipcRenderer.removeListener('app:updateState', handler)
    },
  },

  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: typeof api
  }
}
