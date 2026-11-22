import { execFile } from 'child_process'
import { readdir, stat } from 'fs/promises'
import { freemem, totalmem } from 'os'
import { isAbsolute, join } from 'path'
import { promisify } from 'util'
import si, { Systeminformation } from 'systeminformation'
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

let lastGpu: GpuMetrics | null = null
let lastGpuCollectedAt = 0
let gpuCollection: Promise<GpuMetrics | null> | null = null
const GPU_POLL_INTERVAL = 15_000
const GPU_INVENTORY_INTERVAL = 10 * 60_000
const execFileAsync = promisify(execFile)

type GpuDevice = Pick<GpuMetrics, 'model' | 'vendor' | 'memoryTotalMb'>

function cacheSample<T>(read: () => Promise<T>, intervalMs: number): () => Promise<T> {
  let sample: Promise<T> | undefined
  let sampledAt = 0
  return () => {
    if (!sample || Date.now() - sampledAt >= intervalMs) {
      sampledAt = Date.now()
      sample = read().catch((error) => {
        sample = undefined
        throw error
      })
    }
    return sample
  }
}

// These probes can run system commands even though their data changes slowly.
const readCpuInfo = cacheSample(() => si.cpu(), 60_000)
const readCpuTemperature = cacheSample(() => si.cpuTemperature(), 30_000)
const readDisks = cacheSample(() => si.fsSize(), 30_000)
const readNetworkStats = process.platform === 'win32'
  ? cacheSample(() => si.networkStats(), 10_000)
  : () => si.networkStats()

async function readMemory() {
  if (process.platform !== 'win32') return si.mem()

  // systeminformation uses these same values for physical RAM on Windows.
  // Its additional PowerShell query reads page file data this app doesn't display.
  const total = totalmem()
  const free = freemem()
  return { total, free, used: total - free }
}

function toFiniteNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function collectWindowsGpuUsage(): Promise<number | undefined> {
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

function selectGpu(controllers: Systeminformation.GraphicsControllerData[]) {
  const score = (controller: Systeminformation.GraphicsControllerData) => {
    const hasLiveUsage = toFiniteNumber(controller.utilizationGpu) !== undefined ? 1_000_000 : 0
    const dedicatedMemory = toFiniteNumber(controller.memoryTotal) ?? toFiniteNumber(controller.vram) ?? 0
    const isDedicated = controller.vramDynamic ? 0 : 100_000
    return hasLiveUsage + isDedicated + dedicatedMemory
  }
  return controllers
    .filter((controller) => controller.model && !/microsoft basic/i.test(`${controller.vendor} ${controller.model}`))
    .sort((a, b) => score(b) - score(a))[0]
}

function getGpuDevice(controller: Systeminformation.GraphicsControllerData): GpuDevice {
  const memoryTotal = toFiniteNumber(controller.memoryTotal) ?? toFiniteNumber(controller.vram)
  return {
    model: controller.name || controller.model,
    vendor: controller.vendor || undefined,
    memoryTotalMb: memoryTotal && memoryTotal > 0 ? Math.round(memoryTotal) : undefined,
  }
}

function isNvidia(controller: Systeminformation.GraphicsControllerData): boolean {
  return /nvidia/i.test(`${controller.vendor} ${controller.model}`)
}

async function findNvidiaSmi(): Promise<string | undefined> {
  const windows = process.env.SystemRoot || process.env.WINDIR || ''
  const programs = process.env.ProgramW6432 || process.env.ProgramFiles || ''
  const system32 = isAbsolute(windows) ? join(windows, 'System32') : undefined
  const directories = [system32, isAbsolute(programs) ? join(programs, 'NVIDIA Corporation', 'NVSMI') : undefined]
  for (const dir of directories) {
    if (!dir) continue
    const exe = join(dir, 'nvidia-smi.exe')
    if ((await stat(exe).catch(() => undefined))?.isFile()) return exe
  }

  if (!system32) return undefined
  const store = join(system32, 'DriverStore', 'FileRepository')
  const entries = await readdir(store, { withFileTypes: true }).catch(() => [])
  let newest: { exe: string; modified: number } | undefined
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^nv.*\.inf_/i.test(entry.name)) continue
    const exe = join(store, entry.name, 'nvidia-smi.exe')
    const file = await stat(exe).catch(() => undefined)
    if (file?.isFile() && (!newest || file.mtimeMs > newest.modified)) {
      newest = { exe, modified: file.mtimeMs }
    }
  }
  return newest?.exe
}

const readWindowsGpuDevice = cacheSample(async () => {
  const { controllers } = await si.graphics()
  const controller = selectGpu(controllers)
  if (!controller) return null

  const pciBus = controller.pciBus && /^(?:[0-9a-f]{4}|[0-9a-f]{8}):[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i.test(controller.pciBus)
    ? controller.pciBus
    : undefined
  // Only allow a query without a PCI ID if there is a single NVIDIA card.
  const nvidiaSmi = isNvidia(controller) && (pciBus || controllers.filter(isNvidia).length === 1)
    ? await findNvidiaSmi()
    : undefined
  return { ...getGpuDevice(controller), nvidiaSmi, pciBus }
}, GPU_INVENTORY_INTERVAL)

async function readNvidiaGpu(exe: string, pciBus: string | undefined): Promise<Array<number | undefined>> {
  try {
    const args = ['--query-gpu=utilization.gpu,memory.used,temperature.gpu', '--format=csv,noheader,nounits']
    if (pciBus) args.push(`--id=${pciBus}`)
    const { stdout } = await execFileAsync(exe, args, { windowsHide: true, timeout: 5_000, encoding: 'utf8' })
    const rows = stdout.trim().split(/\r?\n/)
    if (rows.length !== 1) return []
    const fields = rows[0].split(',').map(field => field.trim())
    if (fields.length !== 3) return []
    return fields.map(field => field ? toFiniteNumber(Number(field)) : undefined)
  } catch {
    return []
  }
}

function withGpuUsage(device: GpuDevice, usage?: number, memoryUsed?: number, temperature?: number): GpuMetrics {
  return {
    model: device.model,
    vendor: device.vendor,
    memoryTotalMb: device.memoryTotalMb,
    usage: usage === undefined ? null : Math.round(Math.min(100, Math.max(0, usage))),
    memoryUsedMb: memoryUsed !== undefined && memoryUsed >= 0 ? Math.round(memoryUsed) : undefined,
    temperature: temperature && temperature > 0 ? Math.round(temperature) : undefined,
  }
}

async function sampleGpu(): Promise<GpuMetrics | null> {
  if (process.platform === 'win32') {
    const device = await readWindowsGpuDevice()
    if (!device) return null

    const [usage, memoryUsed, temperature] = device.nvidiaSmi
      ? await readNvidiaGpu(device.nvidiaSmi, device.pciBus)
      : []
    return withGpuUsage(device, usage ?? await collectWindowsGpuUsage(), memoryUsed, temperature)
  }

  const { controllers } = await si.graphics()
  const controller = selectGpu(controllers)
  if (!controller) return null
  return withGpuUsage(
    getGpuDevice(controller),
    toFiniteNumber(controller.utilizationGpu),
    toFiniteNumber(controller.memoryUsed),
    toFiniteNumber(controller.temperatureGpu),
  )
}

async function collectGpuMetrics(): Promise<GpuMetrics | null> {
  const now = Date.now()
  if (lastGpuCollectedAt > 0 && now - lastGpuCollectedAt < GPU_POLL_INTERVAL) {
    return lastGpu
  }
  if (gpuCollection) return gpuCollection

  gpuCollection = sampleGpu()
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

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const [load, mem, fsSize, networkStats, cpuData, temp, gpuData] = await Promise.allSettled([
    si.currentLoad(),
    readMemory(),
    readDisks(),
    readNetworkStats(),
    readCpuInfo(),
    readCpuTemperature(),
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
    usagePercent: memData?.total ? Math.round((memData.used / memData.total) * 100) : 0,
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
