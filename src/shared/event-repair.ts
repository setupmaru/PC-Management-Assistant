export type EventAutoRepairActionStatus = 'success' | 'failed'

export interface EventAutoRepairAction {
  ruleId: string
  title: string
  status: EventAutoRepairActionStatus
  eventCount: number
  detail: string
  attemptedAt: number
}

export interface EventAutoRepairState {
  enabled: boolean
  running: boolean
  supportedEventCount: number
  pendingEventCount: number
  lastRunAt: number | null
  summary: string
  actions: EventAutoRepairAction[]
}

export function createInitialEventAutoRepairState(enabled = true): EventAutoRepairState {
  return {
    enabled,
    running: false,
    supportedEventCount: 0,
    pendingEventCount: 0,
    lastRunAt: null,
    summary: enabled ? '자동 복구 대상 이벤트를 확인하는 중입니다.' : '이벤트 자동 복구가 꺼져 있습니다.',
    actions: [],
  }
}
