import Store from 'electron-store'
import { safeStorage } from 'electron'

interface StoreSchema {
  // Removed from current builds; retained only so upgrades can delete it.
  encryptedApiKey?: string
  encryptedRefreshToken?: string
  windowBounds?: { x: number; y: number; width: number; height: number }
  theme?: 'dark' | 'light'
  eventAutoRepairEnabled?: boolean
  eventAutoRepairHistory?: EventAutoRepairHistoryEntry[]
}

export interface EventAutoRepairHistoryEntry {
  fingerprint: string
  ruleId: string
  lastAttemptAt: number
  attempts: number
  succeeded: boolean
}

// app.whenReady() 이후에 사용 - lazy init
let _store: Store<StoreSchema> | null = null

function getStore(): Store<StoreSchema> {
  if (!_store) {
    _store = new Store<StoreSchema>({
      name: 'pc-assistant-config',
      defaults: { theme: 'dark', eventAutoRepairEnabled: true },
    })
  }
  return _store
}

// ── safeStorage 공통 헬퍼 ─────────────────────────────
function encryptValue(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  return Buffer.from(value).toString('base64')
}

function decryptValue(stored: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }
  return Buffer.from(stored, 'base64').toString('utf8')
}

// Delete API keys saved by versions that called OpenAI from the desktop app.
export function clearLegacyApiKey(): void {
  getStore().delete('encryptedApiKey')
}

// ── Refresh Token ─────────────────────────────────────
export function saveRefreshToken(token: string): void {
  getStore().set('encryptedRefreshToken', encryptValue(token))
}

export function loadRefreshToken(): string | null {
  const stored = getStore().get('encryptedRefreshToken')
  if (!stored) return null
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

export function clearRefreshToken(): void {
  getStore().delete('encryptedRefreshToken')
}

// ── Event auto repair ─────────────────────────────────
export function loadEventAutoRepairEnabled(): boolean {
  return getStore().get('eventAutoRepairEnabled') !== false
}

export function saveEventAutoRepairEnabled(enabled: boolean): void {
  getStore().set('eventAutoRepairEnabled', enabled)
}

export function loadEventAutoRepairHistory(): EventAutoRepairHistoryEntry[] {
  const history = getStore().get('eventAutoRepairHistory')
  if (!Array.isArray(history)) return []

  return history.filter((entry) => (
    typeof entry?.fingerprint === 'string'
    && typeof entry.ruleId === 'string'
    && Number.isFinite(entry.lastAttemptAt)
    && Number.isInteger(entry.attempts)
    && entry.attempts > 0
    && typeof entry.succeeded === 'boolean'
  ))
}

export function saveEventAutoRepairHistory(history: EventAutoRepairHistoryEntry[]): void {
  getStore().set('eventAutoRepairHistory', history)
}

// ── Window Bounds ─────────────────────────────────────
export function saveWindowBounds(bounds: StoreSchema['windowBounds']): void {
  getStore().set('windowBounds', bounds)
}

export function loadWindowBounds(): StoreSchema['windowBounds'] {
  return getStore().get('windowBounds')
}
