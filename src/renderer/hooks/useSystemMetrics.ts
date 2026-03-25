import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'

export function useSystemMetrics() {
  const { setMetrics, setProcesses, setEventLog, setWindowsUpdate } = useAppStore()

  useEffect(() => {
    // 초기 스냅샷 로드
    window.api.getLastSnapshot().then((res: any) => {
      if (res.success && res.data) {
        if (res.data.metrics) setMetrics(res.data.metrics)
        if (res.data.processes) setProcesses(res.data.processes)
        if (res.data.events) setEventLog(res.data.events)
        if (res.data.windowsUpdate) setWindowsUpdate(res.data.windowsUpdate)
      }
    })

    // 실시간 업데이트 구독
    const unsubMetrics = window.api.onMetricsUpdate((data) => {
      setMetrics(data.metrics)
      if (data.processes) setProcesses(data.processes)
    })

    const unsubProcesses = window.api.onProcessesUpdate((processes) => {
      setProcesses(processes)
    })

    const unsubEvents = window.api.onEventsUpdate((events) => {
      setEventLog(events)
    })

    const unsubWindowsUpdate = window.api.onWindowsUpdateUpdate((data) => {
      setWindowsUpdate(data)
    })

    return () => {
      unsubMetrics()
      unsubProcesses()
      unsubEvents()
      unsubWindowsUpdate()
    }
  }, [setMetrics, setProcesses, setEventLog, setWindowsUpdate])
}
