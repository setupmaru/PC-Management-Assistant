import Store from 'electron-store'
import { safeStorage } from 'electron'

interface StoreSchema {
  encryptedApiKey?: string
  encryptedRefreshToken?: string
  windowBounds?: { x: number; y: number; width: number; height: number }
  theme?: 'dark' | 'light'
}

// app.whenReady() 이후에 사용 - lazy init
let _store: Store<StoreSchema> | null = null

function getStore(): Store<StoreSchema> {
  if (!_store) {
    _store = new Store<StoreSchema>({
      name: 'pc-assistant-config',
      defaults: { theme: 'dark' },
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

// ── API Key ───────────────────────────────────────────
export function saveApiKey(apiKey: string): void {
  const store = getStore()
  if (!apiKey) {
    store.delete('encryptedApiKey')
    return
  }
  store.set('encryptedApiKey', encryptValue(apiKey))
}

export function loadApiKey(): string | null {
  const stored = getStore().get('encryptedApiKey')
  if (!stored) return null
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
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

// ── Window Bounds ─────────────────────────────────────
export function saveWindowBounds(bounds: StoreSchema['windowBounds']): void {
  getStore().set('windowBounds', bounds)
}

export function loadWindowBounds(): StoreSchema['windowBounds'] {
  return getStore().get('windowBounds')
}
