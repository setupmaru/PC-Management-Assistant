import si from 'systeminformation'

export interface CpuMetrics {
  usage: number
  cores: number
  performanceCores?: number
  efficiencyCores?: number
  speed: number
  model?: string
  temperature?: number
}

export interface MemoryMetrics {
  total: number
  used: number
  free: number
  usagePercent: number
}

export interface DiskMetrics {
  mount: string
  fs: string
  size: number
  used: number
  usagePercent: number
}

export interface NetworkMetrics {
  iface: string
  rxSec: number
  txSec: number
}

export interface SystemMetrics {
  cpu: CpuMetrics
  memory: MemoryMetrics
  disks: DiskMetrics[]
  network: NetworkMetrics[]
  timestamp: number
}

let warmedUp = false

export async function warmupSystemInfo(): Promise<void> {
  if (warmedUp) return
  try {
    await Promise.all([
      si.currentLoad(),
      si.mem(),
    ])
    warmedUp = true
  } catch {
    // ignore warmup errors
  }
}

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const [load, mem, fsSize, networkStats, cpuData, temp] = await Promise.allSettled([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.cpu(),
    si.cpuTemperature(),
  ])

  const cpuLoad = load.status === 'fulfilled' ? load.value : null
  const cpuInfo = cpuData.status === 'fulfilled' ? cpuData.value : null
  const tempInfo = temp.status === 'fulfilled' ? temp.value : null

  const cpu: CpuMetrics = {
    usage: cpuLoad ? Math.round(cpuLoad.currentLoad) : 0,
    cores: cpuInfo ? cpuInfo.physicalCores : 0,
    performanceCores: cpuInfo?.performanceCores,
    efficiencyCores: cpuInfo?.efficiencyCores,
    speed: cpuInfo ? cpuInfo.speed : 0,
    model: cpuInfo?.brand || undefined,
    temperature: tempInfo?.main && tempInfo.main > 0 ? tempInfo.main : undefined,
  }

  const memData = mem.status === 'fulfilled' ? mem.value : null
  const memory: MemoryMetrics = {
    total: memData?.total ?? 0,
    used: memData?.used ?? 0,
    free: memData?.free ?? 0,
    usagePercent: memData ? Math.round((memData.used / memData.total) * 100) : 0,
  }

  const diskData = fsSize.status === 'fulfilled' ? fsSize.value : []
  const disks: DiskMetrics[] = diskData
    .filter((disk) => disk.size > 0)
    .map((disk) => ({
      mount: disk.mount,
      fs: disk.fs,
      size: disk.size,
      used: disk.used,
      usagePercent: Math.round(disk.use),
    }))

  const netData = networkStats.status === 'fulfilled' ? networkStats.value : []
  const network: NetworkMetrics[] = netData
    .filter((item) => item.iface && (item.rx_sec > 0 || item.tx_sec > 0 || item.iface.includes('Ethernet') || item.iface.includes('Wi-Fi')))
    .slice(0, 3)
    .map((item) => ({
      iface: item.iface,
      rxSec: Math.round(item.rx_sec || 0),
      txSec: Math.round(item.tx_sec || 0),
    }))

  return {
    cpu,
    memory,
    disks,
    network,
    timestamp: Date.now(),
  }
}
