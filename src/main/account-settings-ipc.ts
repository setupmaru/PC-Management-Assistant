import type { IpcMain } from 'electron'
import type { AccountSettings, AccountSettingsResult } from '../shared/account-settings'

export function registerAccountSettingsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  authenticatedFetch: (path: string, options?: RequestInit) => Promise<Response>,
): void {
  async function request(options: RequestInit): Promise<AccountSettingsResult> {
    try {
      const response = await authenticatedFetch('/auth/settings', options)
      const data = await response.json() as AccountSettings & { error?: string }
      if (!response.ok) return { success: false, error: data.error ?? '계정 설정 요청에 실패했습니다.' }
      return { success: true, data }
    } catch { return { success: false, error: '계정 설정 서버에 연결하지 못했습니다. 다시 시도해주세요.' } }
  }
  ipc.handle('accountSettings:get', () => request({ method: 'GET' }))
  ipc.handle('accountSettings:update', (_event, chatModel: unknown) => request({
    method: 'PATCH', body: JSON.stringify({ chatModel }),
  }))
}
