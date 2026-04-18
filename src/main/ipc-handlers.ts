import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'fs'
import { net } from 'electron'
import os from 'os'
import path from 'path'
import { DataCollectorService } from './collectors'
import { ClaudeService } from './claude/client'
import { buildSystemPrompt } from './claude/prompt-builder'
import { ChatImageAttachment, ChatSendPayload } from '../shared/chat'
import {
  saveApiKey,
  loadApiKey,
  saveRefreshToken,
  loadRefreshToken,
  clearRefreshToken,
} from './store'

const LOCALHOST_FALLBACK_API_BASE = 'http://localhost:3400/api'
const DEV_DEFAULT_API_BASE = LOCALHOST_FALLBACK_API_BASE
const PACKAGED_DEFAULT_API_BASE = 'http://api.setupmaru.com:3400/api'
const DEFAULT_LAN_API_BASE = 'http://192.168.0.117:3400/api'
const REMOTE_API_REQUEST_TIMEOUT_MS = 12000
const LOCAL_API_REQUEST_TIMEOUT_MS = 4000
const REMOTE_HEALTHCHECK_TIMEOUT_MS = 8000
const LOCAL_HEALTHCHECK_TIMEOUT_MS = 1500
const CONFIG_BASENAME = 'pc-assistant.config.json'
const MAX_CHAT_ATTACHMENTS = 4
const MAX_CHAT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024

interface ConflictCheckUpdate {
  title: string
  severity: string
}

interface ConflictEvidence {
  source: string
  title: string
  snippet: string
  url: string
}

interface ConflictResult {
  risk: 'high' | 'possible' | 'none'
  summary: string
  matchedUpdates: ConflictCheckUpdate[]
  evidence: ConflictEvidence[]
  searchedAt: number
}

interface ConflictSession {
  createdAt: number
  updates: ConflictCheckUpdate[]
}

interface ApiConnectionInfo {
  reachable: boolean
  activeBase: string
  triedBases: string[]
  error?: string
}

const CONFLICT_SESSION_TTL_MS = 10 * 60 * 1000
const AUDIO_INTERFACE_QUESTION = '무슨 오디오 인터페이스를 쓰시나요?'

let inMemoryAccessToken: string | null = null
let lastReachableApiBase: string | null = null

function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, '')
}

function ensureApiBase(base: string): string {
  const normalized = normalizeBase(base)
  if (!normalized) return ''
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`
}

function collectApiBases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => collectApiBases(item))
      .filter(Boolean)
  }
  if (typeof value !== 'string') return []

  return value
    .split(/[\r\n,;]+/)
    .map((item) => ensureApiBase(item))
    .filter(Boolean)
}

function dedupeBases(bases: string[]): string[] {
  return Array.from(new Set(bases.map((base) => normalizeBase(base)).filter(Boolean)))
}

function getIpv4Host(base: string): string | null {
  try {
    const hostname = new URL(ensureApiBase(base)).hostname
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ? hostname : null
  } catch {
    return null
  }
}

function isPrivateIpv4(ip: string): boolean {
  return ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isLocalOnlyBase(base: string): boolean {
  try {
    const hostname = new URL(ensureApiBase(base)).hostname
    return isLoopbackHost(hostname) || isPrivateIpv4(hostname)
  } catch {
    return false
  }
}

function isSame24Subnet(a: string, b: string): boolean {
  const aParts = a.split('.')
  const bParts = b.split('.')
  return aParts.length === 4
    && bParts.length === 4
    && aParts[0] === bParts[0]
    && aParts[1] === bParts[1]
    && aParts[2] === bParts[2]
}

function shouldPreferLanBase(base: string): boolean {
  const host = getIpv4Host(base)
  if (!host || !isPrivateIpv4(host)) return false

  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue
      if (isSame24Subnet(entry.address, host)) return true
    }
  }

  return false
}

function getDefaultApiBase(): string {
  return app.isPackaged ? PACKAGED_DEFAULT_API_BASE : DEV_DEFAULT_API_BASE
}

function loadApiBasesFromConfig(): string[] {
  const readJson = (filePath: string): Record<string, unknown> | null => {
    try {
      if (!fs.existsSync(filePath)) return null
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }

  const candidates = dedupeBases([
    path.join(app.getPath('userData'), CONFIG_BASENAME),
    path.join(path.dirname(app.getPath('exe')), CONFIG_BASENAME),
    path.join(process.resourcesPath, CONFIG_BASENAME),
    path.join(process.resourcesPath, 'app', CONFIG_BASENAME),
    path.join(app.getAppPath(), CONFIG_BASENAME),
    path.join(path.dirname(app.getAppPath()), CONFIG_BASENAME),
    path.resolve(process.cwd(), CONFIG_BASENAME),
  ])

  for (const filePath of candidates) {
    const data = readJson(filePath)
    if (!data) continue

    const bases = dedupeBases([
      ...collectApiBases(data.API_BASES ?? data.apiBases),
      ...collectApiBases(data.API_BASE ?? data.apiBase),
      ...collectApiBases(data.PUBLIC_BASE_URL ?? data.publicBaseUrl),
      ...collectApiBases(data.LAN_API_BASE ?? data.lanApiBase),
      ...collectApiBases(data.LOCAL_API_BASE ?? data.localApiBase),
    ])
    if (bases.length > 0) return bases
  }

  return []
}

function getLocalApiBases(): string[] {
  const interfaces = os.networkInterfaces()
  const bases: string[] = []

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue
      bases.push(ensureApiBase(`http://${entry.address}:3400`))
    }
  }

  return dedupeBases(bases)
}

function getApiBaseCandidates(): string[] {
  const configBases = loadApiBasesFromConfig()
  const localBases = getLocalApiBases()
  const remoteConfigBases = configBases.filter((base) => !isLocalOnlyBase(base))
  const localConfigBases = configBases.filter((base) => isLocalOnlyBase(base))
  const lanBases = dedupeBases([
    ...(shouldPreferLanBase(DEFAULT_LAN_API_BASE) ? [DEFAULT_LAN_API_BASE] : []),
    ...collectApiBases(process.env.LAN_API_BASE).filter((base) => shouldPreferLanBase(base)),
    ...localConfigBases.filter((base) => shouldPreferLanBase(base)),
  ])

  const remoteEnvBases = dedupeBases([
    ...collectApiBases(process.env.API_BASES),
    ...collectApiBases(process.env.API_BASE),
    ...collectApiBases(process.env.PUBLIC_BASE_URL),
  ])
  const localCandidateBases = dedupeBases([
    ...collectApiBases(process.env.LOCAL_API_BASE),
    ...lanBases,
    LOCALHOST_FALLBACK_API_BASE,
    ...localBases,
    ...localConfigBases,
  ])

  return dedupeBases([
    ...localCandidateBases,
    lastReachableApiBase ?? '',
    ...remoteEnvBases,
    ...remoteConfigBases,
    getDefaultApiBase(),
  ])
}

function getRequestTimeoutMs(base: string): number {
  return isLocalOnlyBase(base) ? LOCAL_API_REQUEST_TIMEOUT_MS : REMOTE_API_REQUEST_TIMEOUT_MS
}

function getHealthcheckTimeoutMs(base: string): number {
  return isLocalOnlyBase(base) ? LOCAL_HEALTHCHECK_TIMEOUT_MS : REMOTE_HEALTHCHECK_TIMEOUT_MS
}

function buildUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/')) return `${base}${path}`
  return `${base}/${path}`
}

async function performApiRequest(url: string, options: RequestInit = {}): Promise<Response> {
  return net.fetch(url, options)
}

class ApiFetchError extends Error {
  base: string
  attemptedBases: string[]
  cause: unknown

  constructor(base: string, cause: unknown, attemptedBases: string[]) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(message)
    this.base = base
    this.cause = cause
    this.attemptedBases = attemptedBases
  }
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const bases = getApiBaseCandidates()
  if (bases.length === 0) {
    throw new Error('API base is not configured. Set API_BASE or PUBLIC_BASE_URL.')
  }

  let lastError: unknown = new Error('No API bases available')

  for (const base of bases) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), getRequestTimeoutMs(base))

    try {
      const response = await performApiRequest(buildUrl(base, path), {
        ...options,
        signal: options.signal ?? controller.signal,
      })
      lastReachableApiBase = base
      return response
    } catch (err) {
      lastError = err
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw new ApiFetchError(bases[0], lastError, bases)
}

async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const makeReq = (token: string) =>
    apiFetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    })

  if (!inMemoryAccessToken) throw new Error('로그인이 필요합니다.')

  let res = await makeReq(inMemoryAccessToken)
  if (res.status === 401) {
    const refreshToken = loadRefreshToken()
    if (!refreshToken) throw new Error('로그인이 필요합니다.')

    const refreshRes = await apiFetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!refreshRes.ok) {
      inMemoryAccessToken = null
      clearRefreshToken()
      throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.')
    }

    const data = (await refreshRes.json()) as { accessToken: string }
    inMemoryAccessToken = data.accessToken
    res = await makeReq(inMemoryAccessToken)
  }

  return res
}

function formatNetworkError(err: unknown): string {
  const base = (err && typeof err === 'object' && 'base' in err)
    ? String((err as { base: string }).base)
    : ''
  const attemptedBases = (err && typeof err === 'object' && 'attemptedBases' in err)
    ? (err as { attemptedBases: string[] }).attemptedBases
    : []
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  const suffix = attemptedBases.length > 0
    ? ` (tried: ${attemptedBases.join(', ')})`
    : base
      ? ` (base: ${base})`
      : ''
  if (lower.includes('api base is not configured')) {
    return `API base is not configured. Set API_BASE or PUBLIC_BASE_URL.${suffix}`
  }
  if (lower.includes('econnreset')) return `Connection was reset by the server.${suffix}`
  if (lower.includes('econnrefused')) return `Connection refused. Is the API server running?${suffix}`
  if (lower.includes('aborted')) return `API request timed out.${suffix}`
  return `Failed to connect to the API server: ${msg}.${suffix}`
}

async function getApiConnectionInfo(): Promise<ApiConnectionInfo> {
  const triedBases = getApiBaseCandidates()
  if (triedBases.length === 0) {
    return {
      reachable: false,
      activeBase: '',
      triedBases: [],
      error: 'API base is not configured.',
    }
  }

  let lastError: unknown = new Error('No API bases available')

  for (const base of triedBases) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), getHealthcheckTimeoutMs(base))

    try {
      const response = await performApiRequest(buildUrl(base, '/health'), {
        signal: controller.signal,
      })
      lastReachableApiBase = base
      return {
        reachable: response.ok,
        activeBase: base,
        triedBases,
        error: response.ok ? undefined : `Health check failed with status ${response.status}.`,
      }
    } catch (err) {
      lastError = err
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return {
    reachable: false,
    activeBase: triedBases[0],
    triedBases,
    error: formatNetworkError(new ApiFetchError(triedBases[0], lastError, triedBases)),
  }
}

async function preflightApiHealthCheck(): Promise<void> {
  const info = await getApiConnectionInfo()
  if (!info.activeBase) {
    console.error('[api] API base is not configured')
    return
  }

  console.log(`[api] Candidate API bases: ${info.triedBases.join(', ')}`)
  if (info.reachable) {
    console.log(`[api] Health check OK (${info.activeBase})`)
  } else {
    console.error(`[api] Health check error: ${info.error ?? 'Unknown error'}`)
  }
}

function pushAssistantMessage(win: BrowserWindow, text: string): void {
  win.webContents.send('chat:streamChunk', { text, done: false })
  win.webContents.send('chat:streamChunk', { text: '', done: true })
}

function isChatImageAttachment(value: unknown): value is ChatImageAttachment {
  if (!value || typeof value !== 'object') return false

  const attachment = value as Partial<ChatImageAttachment>
  return (
    typeof attachment.id === 'string' &&
    typeof attachment.name === 'string' &&
    typeof attachment.mimeType === 'string' &&
    attachment.mimeType.startsWith('image/') &&
    typeof attachment.dataUrl === 'string' &&
    attachment.dataUrl.startsWith('data:image/') &&
    attachment.dataUrl.length <= MAX_CHAT_IMAGE_DATA_URL_LENGTH &&
    typeof attachment.size === 'number' &&
    Number.isFinite(attachment.size) &&
    attachment.size > 0 &&
    attachment.size <= MAX_CHAT_IMAGE_SIZE_BYTES
  )
}

function normalizeChatPayload(value: unknown): ChatSendPayload {
  const payload = (value && typeof value === 'object') ? value as Partial<ChatSendPayload> : {}
  const text = typeof payload.text === 'string' ? payload.text : ''
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments.filter(isChatImageAttachment).slice(0, MAX_CHAT_ATTACHMENTS)
    : []

  return { text, attachments }
}

function formatConflictResultMessage(audioInterface: string, result: ConflictResult): string {
  const riskLabel = result.risk === 'high'
    ? '충돌 가능성 높음'
    : result.risk === 'possible'
      ? '충돌 가능성 있음'
      : '충돌 징후 없음'

  const lines: string[] = [
    `### Windows Update x ${audioInterface}`,
    `- 결과: **${riskLabel}**`,
    `- 요약: ${result.summary}`,
  ]

  if (result.matchedUpdates.length > 0) {
    lines.push('- 관련 업데이트:')
    for (const update of result.matchedUpdates.slice(0, 5)) {
      lines.push(`  - [${update.severity}] ${update.title}`)
    }
  }

  if (result.evidence.length > 0) {
    lines.push('- 참고 근거:')
    for (const item of result.evidence.slice(0, 3)) {
      lines.push(`  - [${item.source}] [${item.title}](${item.url})`)
    }
  } else {
    lines.push('- 참고 근거: 검색 결과에서 명확한 충돌 언급을 찾지 못했습니다.')
  }

  lines.push('- 안내: 이 결과는 공개 웹 언급 기반 추정이며, 설치 전 복원 지점 생성을 권장합니다.')
  return lines.join('\n')
}

export function registerIpcHandlers(
  win: BrowserWindow,
  collector: DataCollectorService,
  claude: ClaudeService,
): void {
  const conflictSessions = new Map<string, ConflictSession>()

  preflightApiHealthCheck().catch(() => {})

  ipcMain.handle('auth:login', async (_event, email: string, password: string) => {
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json() as {
        accessToken?: string
        refreshToken?: string
        user?: { id: string; email: string; plan: string }
        error?: string
      }
      if (!res.ok) return { success: false, error: data.error ?? '로그인 실패' }

      inMemoryAccessToken = data.accessToken ?? null
      if (data.refreshToken) saveRefreshToken(data.refreshToken)
      return { success: true, user: data.user }
    } catch (err) {
      return { success: false, error: formatNetworkError(err) }
    }
  })

  ipcMain.handle('auth:register', async (_event, email: string, password: string) => {
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json() as {
        accessToken?: string
        refreshToken?: string
        user?: { id: string; email: string; plan: string }
        error?: string
      }
      if (!res.ok) return { success: false, error: data.error ?? '회원가입 실패' }

      inMemoryAccessToken = data.accessToken ?? null
      if (data.refreshToken) saveRefreshToken(data.refreshToken)
      return { success: true, user: data.user }
    } catch (err) {
      return { success: false, error: formatNetworkError(err) }
    }
  })

  ipcMain.handle('auth:refreshToken', async () => {
    try {
      const refreshToken = loadRefreshToken()
      if (!refreshToken) return { success: false }

      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      const data = await res.json() as {
        accessToken?: string
        user?: { id: string; email: string; plan: string }
      }

      if (!res.ok || !data.accessToken) {
        clearRefreshToken()
        inMemoryAccessToken = null
        return { success: false }
      }

      inMemoryAccessToken = data.accessToken
      return { success: true, user: data.user }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('auth:getConnectionInfo', async () => {
    try {
      return await getApiConnectionInfo()
    } catch (err) {
      return {
        reachable: false,
        activeBase: '',
        triedBases: getApiBaseCandidates(),
        error: err instanceof Error ? err.message : String(err),
      } satisfies ApiConnectionInfo
    }
  })

  ipcMain.handle('auth:logout', async () => {
    try {
      const refreshToken = loadRefreshToken()
      if (inMemoryAccessToken && refreshToken) {
        await apiFetch('/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${inMemoryAccessToken}`,
          },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {})
      }
    } finally {
      inMemoryAccessToken = null
      clearRefreshToken()
    }
    return { success: true }
  })

  ipcMain.handle('subscription:getStatus', async () => {
    try {
      const res = await authenticatedFetch('/subscription/status')
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('subscription:openCheckout', async (_event, plan: 'plus' | 'pro' = 'pro') => {
    try {
      const res = await authenticatedFetch('/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      })
      const data = await res.json() as {
        url?: string
        renewed?: boolean
        error?: string
      }
      if (!res.ok) return { success: false, error: data.error }

      if (data.url) {
        const popup = new BrowserWindow({
          parent: win,
          modal: true,
          width: 900,
          height: 720,
          title: `${plan === 'plus' ? 'Plus' : 'Pro'} 구독 결제`,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        })
        popup.setMenu(null)

        popup.webContents.setWindowOpenHandler(() => ({
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 500,
            height: 700,
            autoHideMenuBar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
          },
        }))

        popup.loadURL(data.url)

        return new Promise<{ success: boolean; status?: unknown }>((resolve) => {
          popup.on('closed', async () => {
            try {
              const statusRes = await authenticatedFetch('/subscription/status')
              const statusData = await statusRes.json()
              resolve({ success: true, status: statusData })
            } catch {
              resolve({ success: true, status: null })
            }
          })
        })
      }

      if (data.renewed) {
        try {
          const statusRes = await authenticatedFetch('/subscription/status')
          const statusData = await statusRes.json()
          return { success: true, renewed: true, status: statusData }
        } catch {
          return { success: true, renewed: true, status: null }
        }
      }

      return { success: false, error: 'Invalid checkout response' }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('subscription:chatUse', async () => {
    try {
      const res = await authenticatedFetch('/subscription/chat-use', { method: 'POST' })
      const data = await res.json() as { allowed: boolean; remaining: number; error?: string }
      if (!res.ok) return { allowed: false, remaining: 0, error: data.error }
      return data
    } catch (err) {
      return { allowed: false, remaining: 0, error: String(err) }
    }
  })

  ipcMain.handle('subscription:cancel', async () => {
    try {
      const res = await authenticatedFetch('/subscription/cancel', { method: 'POST' })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok) return { success: false, error: data.error }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('settings:saveApiKey', async (_event, apiKey: string) => {
    try {
      saveApiKey(apiKey)
      claude.updateApiKey(apiKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('settings:loadApiKey', async () => {
    const key = loadApiKey()
    return {
      hasKey: !!key,
      maskedKey: key ? `${key.substring(0, 8)}${'*'.repeat(20)}` : null,
    }
  })

  ipcMain.handle('chat:sendMessage', async (_event, rawPayload: ChatSendPayload) => {
    try {
      const payload = normalizeChatPayload(rawPayload)
      if (!payload.text.trim() && payload.attachments.length === 0) {
        return { success: false, error: '메시지 내용이 비어 있습니다.' }
      }

      try {
        const limitRes = await authenticatedFetch('/subscription/chat-use', { method: 'POST' })
        const limitData = await limitRes.json() as { allowed: boolean; remaining: number; error?: string }
        if (!limitData.allowed) {
          const msg = limitRes.status === 403
            ? '채팅은 Plus 이상 플랜에서 사용 가능합니다.'
            : '오늘 채팅 한도를 초과했습니다. Pro 플랜에서 무제한으로 이용 가능합니다.'
          win.webContents.send('chat:streamChunk', { text: `> **제한**: ${msg}`, done: true })
          return { success: false, error: msg }
        }
      } catch {
        // Ignore quota API errors and continue to keep offline behavior.
      }

      const snapshot = await collector.getFreshSnapshot()
      const systemPrompt = buildSystemPrompt(snapshot)
      await claude.streamMessage(payload, systemPrompt)
      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      win.webContents.send('chat:streamChunk', {
        text: `\n\n> **오류**: ${errorMsg}`,
        done: true,
      })
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle('chat:clearHistory', async () => {
    claude.clearHistory()
    return { success: true }
  })

  ipcMain.handle('system:getSnapshot', async () => {
    try {
      const snapshot = await collector.getFreshSnapshot()
      return { success: true, data: snapshot }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('system:getLastSnapshot', () => {
    return { success: true, data: collector.getLastSnapshot() }
  })

  ipcMain.handle('system:checkWindowsUpdates', async () => {
    try {
      win.webContents.send('system:windowsUpdateUpdate', {
        ...collector.getLastSnapshot().windowsUpdate,
        isChecking: true,
      })
      const result = await collector.checkWindowsUpdates()
      win.webContents.send('system:windowsUpdateUpdate', result)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('system:runMaintenance', async () => {
    try {
      const report = await collector.runSystemMaintenance()
      return { success: true, data: report }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('system:getLastMaintenanceReport', async () => {
    return {
      success: true,
      data: collector.getLastMaintenanceReport(),
    }
  })

  ipcMain.handle('system:startWindowsUpdateConflictFlow', async () => {
    try {
      const latest = collector.getLastSnapshot().windowsUpdate
      const updates = (latest?.updates ?? []).map((u) => ({
        title: u.Title,
        severity: u.Severity,
      }))

      if (updates.length === 0) {
        return { success: false, error: 'No pending Windows updates to analyze.' }
      }

      const now = Date.now()
      for (const [id, session] of conflictSessions.entries()) {
        if (now - session.createdAt > CONFLICT_SESSION_TTL_MS) {
          conflictSessions.delete(id)
        }
      }

      const sessionId = `wu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      conflictSessions.set(sessionId, { createdAt: now, updates })

      win.webContents.send('chat:windowsUpdateConflictPrompt', {
        sessionId,
        question: AUDIO_INTERFACE_QUESTION,
      })
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('system:submitAudioInterfaceAnswer', async (_event, sessionId: string, audioInterface: string) => {
    const session = conflictSessions.get(sessionId)
    if (!session) {
      const msg = '충돌 분석 세션이 만료되었습니다. 업데이트 버튼을 다시 눌러주세요.'
      pushAssistantMessage(win, msg)
      return { success: false, error: msg }
    }

    if (Date.now() - session.createdAt > CONFLICT_SESSION_TTL_MS) {
      conflictSessions.delete(sessionId)
      const msg = '충돌 분석 세션이 만료되었습니다. 업데이트 버튼을 다시 눌러주세요.'
      pushAssistantMessage(win, msg)
      return { success: false, error: msg }
    }

    const normalizedAudio = String(audioInterface ?? '').trim()
    if (normalizedAudio.length < 2) {
      const msg = '오디오 인터페이스 이름을 2글자 이상 입력해주세요.'
      pushAssistantMessage(win, msg)
      return { success: false, error: msg }
    }

    try {
      const res = await authenticatedFetch('/windows-update/conflict-check', {
        method: 'POST',
        body: JSON.stringify({
          audioInterface: normalizedAudio,
          updates: session.updates,
        }),
      })

      const data = await res.json() as { result?: ConflictResult; error?: string }
      if (!res.ok || !data.result) {
        const msg = data.error ?? '충돌 분석 서버 응답이 올바르지 않습니다.'
        pushAssistantMessage(win, msg)
        return { success: false, error: msg }
      }

      conflictSessions.delete(sessionId)
      const message = formatConflictResultMessage(normalizedAudio, data.result)
      pushAssistantMessage(win, message)
      return { success: true, result: data.result }
    } catch (err) {
      const msg = `충돌 분석 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`
      pushAssistantMessage(win, msg)
      return { success: false, error: msg }
    }
  })
}
