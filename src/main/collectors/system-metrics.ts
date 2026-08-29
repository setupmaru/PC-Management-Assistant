import si from 'systeminformation'
import { runPowerShell } from '../utils/powershell'

export interface CpuMetrics {
  usage: number
  cores: number
  performanceCores?: number
  efficiencyCores?: number
  speed: number
  model?: string
  temperature?: number
}

export interface GpuMetrics {
  usage: number | null
  model: string
  vendor?: string
  memoryTotalMb?: number
  memoryUsedMb?: number
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
  gpu: GpuMetrics | null
  memory: MemoryMetrics
  disks: DiskMetrics[]
  network: NetworkMetrics[]
  timestamp: number
}

let warmedUp = false
let lastGpu: GpuMetrics | null = null
let lastGpuCollectedAt = 0
let gpuCollection: Promise<GpuMetrics | null> | null = null
const GPU_POLL_INTERVAL = 10_000

function toFiniteNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function collectWindowsGpuUsage(): Promise<number | undefined> {
  if (process.platform !== 'win32') return undefined

  try {
    const output = await runPowerShell(`
$samples = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
  Where-Object { $_.Name -like '*engtype_3D' }
$total = ($samples | Measure-Object -Property UtilizationPercentage -Sum).Sum
if ($null -ne $total) {
  [Console]::WriteLine(([math]::Round([double]$total, 2)).ToString([Globalization.CultureInfo]::InvariantCulture))
}
`, 5000)
    const usage = Number.parseFloat(output)
    return Number.isFinite(usage) ? usage : undefined
  } catch {
    return undefined
  }
}

async function collectGpuMetrics(): Promise<GpuMetrics | null> {
  const now = Date.now()
  if (lastGpuCollectedAt > 0 && now - lastGpuCollectedAt < GPU_POLL_INTERVAL) {
    return lastGpu
  }
  if (gpuCollection) return gpuCollection

  gpuCollection = Promise.all([si.graphics(), collectWindowsGpuUsage()])
    .then(([{ controllers }, windowsUsage]) => {
      const candidates = controllers.filter((controller) => {
        const name = `${controller.vendor} ${controller.model}`.toLowerCase()
        return controller.model && !name.includes('microsoft basic')
      })

      const controller = candidates.sort((a, b) => {
        const score = (item: typeof a) => {
          const hasLiveUsage = toFiniteNumber(item.utilizationGpu) !== undefined ? 1_000_000 : 0
          const dedicatedMemory = toFiniteNumber(item.memoryTotal) ?? toFiniteNumber(item.vram) ?? 0
          const isDedicated = item.vramDynamic ? 0 : 100_000
          return hasLiveUsage + isDedicated + dedicatedMemory
        }
        return score(b) - score(a)
      })[0]

      if (!controller) return null

      const rawUsage = toFiniteNumber(controller.utilizationGpu) ?? windowsUsage
      const rawTemperature = toFiniteNumber(controller.temperatureGpu)
      const rawMemoryTotal = toFiniteNumber(controller.memoryTotal) ?? toFiniteNumber(controller.vram)
      const rawMemoryUsed = toFiniteNumber(controller.memoryUsed)

      return {
        usage: rawUsage === undefined ? null : Math.round(Math.min(100, Math.max(0, rawUsage))),
        model: controller.name || controller.model,
        vendor: controller.vendor || undefined,
        memoryTotalMb: rawMemoryTotal && rawMemoryTotal > 0 ? Math.round(rawMemoryTotal) : undefined,
        memoryUsedMb: rawMemoryUsed !== undefined && rawMemoryUsed >= 0 ? Math.round(rawMemoryUsed) : undefined,
        temperature: rawTemperature && rawTemperature > 0 ? Math.round(rawTemperature) : undefined,
      }
    })
    .catch(() => lastGpu)
    .then((gpu) => {
      lastGpu = gpu
      lastGpuCollectedAt = Date.now()
      return gpu
    })
    .finally(() => {
      gpuCollection = null
    })

  return gpuCollection
}

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
  const [load, mem, fsSize, networkStats, cpuData, temp, gpuData] = await Promise.allSettled([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.cpu(),
    si.cpuTemperature(),
    collectGpuMetrics(),
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
    gpu: gpuData.status === 'fulfilled' ? gpuData.value : lastGpu,
    memory,
    disks,
    network,
    timestamp: Date.now(),
  }
}
