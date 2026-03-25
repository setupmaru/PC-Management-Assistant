export type AppUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateState {
  enabled: boolean
  status: AppUpdateStatus
  currentVersion: string
  availableVersion: string | null
  progressPercent: number | null
  transferredBytes: number
  totalBytes: number
  error: string | null
  checkedAt: number | null
}
