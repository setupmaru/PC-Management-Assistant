const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const vm = require('node:vm')
const ts = require('typescript')

const windowsPath = require('node:path').win32
const windowsRoot = 'C:\\Windows'
const nvidiaSmi = windowsPath.join(windowsRoot, 'System32', 'nvidia-smi.exe')
const windowsProcess = { platform: 'win32', env: { SystemRoot: windowsRoot } }

function gpuDependencies(query) {
  return {
    path: windowsPath,
    util: require('node:util'),
    'fs/promises': {
      stat: async file => ({ isFile: () => file === nvidiaSmi }),
      readdir: async () => [],
    },
    child_process: {
      execFile(exe, args, options, callback) {
        try {
          callback(null, { stdout: query(exe, args, options) })
        } catch (error) {
          callback(error)
        }
      },
    },
  }
}

function load(file, modules, globals = {}) {
  const source = fs.readFileSync(file, 'utf8')
  const code = file.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText : source
  const module = { exports: {} }
  vm.runInNewContext(code, {
    exports: module.exports,
    process: { platform: 'win32' },
    require: name => {
      assert.ok(name in modules, `Unexpected collector dependency: ${name}`)
      return modules[name]
    },
    ...globals,
  })
  return module.exports
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('tray and minimize lower dashboard polling without stopping Windows monitoring', async () => {
  const timers = new Map()
  let metricsCalls = 0
  let processCalls = 0
  let eventCalls = 0
  let networkStarts = 0
  let completeMetrics
  const messages = []
  const { DataCollectorService } = load('src/main/collectors/index.ts', {
    './system-metrics': { collectSystemMetrics: () => {
      const timestamp = ++metricsCalls
      return new Promise(resolve => { completeMetrics = () => resolve({ timestamp }) })
    } },
    './process-collector': { collectTopProcesses: async () => [{ pid: ++processCalls }] },
    './event-log-collector': { EventLogCollector: class {
      async collect() { eventCalls++; return this.getLastResult() }
      getLastResult() { return { events: [] } }
    } },
    './windows-update-collector': { WindowsUpdateCollector: class {
      async collect() { return this.getLastResult() }
      getLastResult() { return { updates: [] } }
    } },
    '../maintenance/system-maintenance': { SystemMaintenanceService: class {} },
    '../diagnostics/network-monitor': { NetworkMonitorService: class {
      async initialize() { networkStarts++ }
      destroy() {}
    } },
    '../diagnostics/boot-optimizer': { BootOptimizerService: class { initialize() {} } },
  }, {
    setInterval: (callback, delay) => {
      timers.set(callback, delay)
      return callback
    },
    clearInterval: callback => timers.delete(callback),
  })
  const win = new EventEmitter()
  let visible = false
  let minimized = false
  Object.assign(win, {
    isVisible: () => visible,
    isMinimized: () => minimized,
    isDestroyed: () => false,
    webContents: { send: channel => messages.push(channel) },
  })
  const collector = new DataCollectorService()
  const initialized = collector.initialize(win)
  completeMetrics()
  await initialized

  const tick = async (delay) => {
    for (const [callback, interval] of timers) if (interval === delay) callback()
    await flush()
  }
  const lastMetrics = () => collector.getLastSnapshot().metrics.timestamp
  const dashboardMessages = () => messages.filter(channel =>
    channel === 'system:metricsUpdate' || channel === 'system:processesUpdate')

  assert.equal(networkStarts, 1)
  assert.equal(processCalls, 0)
  assert.equal(lastMetrics(), 1)
  await tick(3_000)
  await tick(10_000)
  assert.equal(metricsCalls, 1)
  await tick(60_000)
  completeMetrics()
  await flush()
  assert.equal(lastMetrics(), 2)
  assert.equal(eventCalls, 2)
  assert.deepEqual(dashboardMessages(), [])

  visible = true
  win.emit('show')
  assert.equal(metricsCalls, 3)
  assert.equal(processCalls, 1)
  const fresh = collector.getFreshSnapshot()
  await tick(3_000)
  assert.equal(metricsCalls, 3, 'a slow sample is shared with explicit requests and periodic ticks')
  assert.equal(processCalls, 1, 'an explicit request shares the foreground process scan')
  completeMetrics()
  assert.equal((await fresh).metrics.timestamp, 3)
  assert.deepEqual(dashboardMessages(), ['system:processesUpdate', 'system:metricsUpdate'])

  await tick(3_000)
  assert.equal(metricsCalls, 4)
  minimized = true
  win.emit('minimize')
  completeMetrics()
  await tick(10_000)
  assert.equal(processCalls, 1)
  assert.equal(dashboardMessages().length, 2, 'an in-flight sample is not sent to a minimized window')

  minimized = false
  win.emit('restore')
  assert.equal(metricsCalls, 5)
  assert.equal(processCalls, 2)
  visible = false
  win.emit('hide')
  completeMetrics()
  await tick(3_000)
  await tick(10_000)
  assert.equal(metricsCalls, 5)
  assert.equal(processCalls, 2)
  assert.equal(dashboardMessages().length, 2)
  collector.destroy()
  assert.equal(timers.size, 0)
})

test('GPU inventory is cached and NVIDIA telemetry uses the selected card with a Windows fallback', async () => {
  const calls = { load: 0, cpu: 0, temperature: 0, disks: 0, graphics: 0, nvidia: 0, fallback: 0 }
  let now = 100_000
  const { collectSystemMetrics } = load('src/main/collectors/system-metrics.ts', {
    ...gpuDependencies((exe, args, options) => {
      assert.equal(exe, nvidiaSmi)
      assert.deepEqual([...args], [
        '--query-gpu=utilization.gpu,memory.used,temperature.gpu',
        '--format=csv,noheader,nounits',
        '--id=00000000:02:00.0',
      ])
      assert.equal(options.timeout, 5000)
      calls.nvidia++
      if (calls.nvidia === 2) return 'N/A, 1024, N/A\r\n'
      if (calls.nvidia === 3) throw new Error('driver unavailable')
      return '0, 2048, 52\r\n'
    }),
    os: { totalmem: () => 10, freemem: () => 5 },
    systeminformation: {
      currentLoad: async () => ({ currentLoad: ++calls.load }),
      networkStats: async () => [],
      cpu: async () => ({ physicalCores: ++calls.cpu, speed: 3 }),
      cpuTemperature: async () => ({ main: 40 + ++calls.temperature }),
      fsSize: async () => [{ size: 100, used: ++calls.disks, use: 1 }],
      graphics: async () => {
        calls.graphics++
        return {
          controllers: [
            { vendor: 'NVIDIA', model: 'GPU 1', pciBus: '00000000:01:00.0', memoryTotal: 4096 },
            { vendor: 'NVIDIA', model: 'GPU 2', pciBus: '00000000:02:00.0', memoryTotal: 8192 },
          ],
        }
      },
    },
    '../utils/powershell': { runPowerShell: async () => { calls.fallback++; return '25' } },
  }, { Date: { now: () => now }, process: windowsProcess })

  const initial = (await collectSystemMetrics()).gpu
  assert.equal(initial.model, 'GPU 2')
  assert.equal(initial.memoryTotalMb, 8192)
  assert.equal(initial.usage, 0)
  assert.equal(initial.memoryUsedMb, 2048)
  assert.equal(initial.temperature, 52)
  now += 3_000
  const live = await collectSystemMetrics()
  assert.equal(live.cpu.usage, 2)
  assert.equal(live.cpu.temperature, 41)
  assert.equal(live.memory.used, 5)
  assert.equal(live.memory.usagePercent, 50)
  assert.equal(live.disks[0].used, 1)
  assert.equal(calls.fallback, 0)
  assert.deepEqual(calls, { load: 2, cpu: 1, temperature: 1, disks: 1, graphics: 1, nvidia: 1, fallback: 0 })

  now += 12_000
  const partial = (await collectSystemMetrics()).gpu
  assert.equal(partial.usage, 25)
  assert.equal(partial.memoryUsedMb, 1024)
  assert.equal(partial.temperature, undefined)
  now += 15_000
  const updated = await collectSystemMetrics()
  assert.equal(updated.gpu.usage, 25)
  assert.equal(updated.gpu.memoryUsedMb, undefined)
  assert.equal(updated.disks[0].used, 2)
  assert.equal(updated.cpu.temperature, 42)
  assert.equal(updated.cpu.cores, 1)
  now += 30_000
  assert.equal((await collectSystemMetrics()).cpu.cores, 2)
  now = 699_999
  await collectSystemMetrics()
  assert.equal(calls.graphics, 1)
  now += 15_000
  await collectSystemMetrics()
  assert.equal(calls.graphics, 2)
})

const scenarios = [
  { vendor: 'NVIDIA', visible: true, expectedPowerShell: 23 },
  { vendor: 'NVIDIA', visible: false, expectedPowerShell: 11 },
  { vendor: 'AMD', visible: true, expectedPowerShell: 27 },
  { vendor: 'AMD', visible: false, expectedPowerShell: 12 },
]
for (const { vendor, visible, expectedPowerShell } of scenarios) {
  test(`Windows PowerShell polling per minute on ${vendor} with the window ${visible ? 'open' : 'hidden'}`, { timeout: 5_000 }, async () => {
    let now = 120_000
    const timers = new Map()
    const schedule = (callback, delay, repeat = false) => {
      const id = Symbol()
      timers.set(id, { callback, at: now + delay, delay, repeat })
      return id
    }
    const clock = {
      Date: { now: () => now },
      setInterval: (callback, delay) => schedule(callback, delay, true),
      setTimeout: schedule,
      clearInterval: id => timers.delete(id),
      clearTimeout: id => timers.delete(id),
    }
    const advance = async duration => {
      const end = now + duration
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        const [id, timer] = next
        now = timer.at
        if (timer.repeat) timer.at += timer.delay
        else timers.delete(id)
        await timer.callback()
        await flush()
      }
      now = end
    }

    // Run the actual Windows collectors and library code on a stable network.
    // Count shell requests at the boundary, excluding startup and on-demand maintenance.
    const counts = {
      pageFile: 0, traffic: 0, processes: 0, eventLog: 0, networkHealth: 0,
      cpuInfo: 0, cpuTemperature: 0, disks: 0, gpuInventory: 0, gpuUsage: 0,
    }
    let nvidiaQueries = 0
    const controllerRecord = [
      `AdapterCompatibility : ${vendor}`,
      `Name : ${vendor} test GPU`,
      'AdapterRAM : 2147483648',
      `PNPDeviceID : PCI\\VEN_${vendor === 'NVIDIA' ? '10DE' : '1002'}&DEV_2484&SUBSYS_12345678&REV_A1`,
    ].join('\r\n')
    const nvidiaInventory = '555.1, 0x12345678, NVIDIA test GPU, 00000000:01:00.0, 10, 4096, 512, 3584, 32, 12, 48, N/A, 10, 100, 500, 500'
    const os = {
      EOL: '\r\n',
      totalmem: () => 10,
      freemem: () => 5,
      loadavg: () => [0, 0, 0],
      cpus: () => [{ times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } }],
      networkInterfaces: () => ({
        Ethernet: [{
          family: 'IPv4', address: '192.0.2.10', netmask: '255.255.255.0',
          mac: '02:00:00:00:00:01', internal: false,
        }],
      }),
    }
    const libraryUtil = require('systeminformation/lib/util.js')
    const siModules = {
      os, fs: { existsSync: file => vendor === 'NVIDIA' && file === nvidiaSmi },
      path: windowsPath,
      child_process: {
        exec: (_command, _options, callback) => callback(null, '0x0'),
        execSync: command => command.includes('nvidia-smi') ? nvidiaInventory : '',
        execFileSync: () => '',
      },
    }
    const powerShellBucket = {
      memory: () => 'pageFile',
      network: () => 'traffic',
      processes: () => 'processes',
      cpu: script => script.includes('MSAcpi_ThermalZoneTemperature') ? 'cpuTemperature' : 'cpuInfo',
      filesystem: () => 'disks',
      graphics: () => 'gpuInventory',
    }
    const si = Object.assign({}, ...Object.entries(powerShellBucket).map(([name, bucket]) =>
      load(require.resolve(`systeminformation/lib/${name}.js`), {
        ...siModules,
        './util': {
          ...libraryUtil,
          WINDIR: windowsRoot,
          powerShell: async script => {
            counts[bucket(script)]++
            return script.includes('win32_VideoController') ? controllerRecord : ''
          },
        },
      }, {
        ...clock, process: { ...windowsProcess, versions: process.versions, nextTick: process.nextTick },
      })))
    const event = { Id: 101, Message: 'fixture' }
    const runPowerShell = async script => {
      if (script.includes('Get-WinEvent')) {
        counts.eventLog++
        assert.match(script, /Get-WinEvent -LogName Security/)
        assert.match(script, /LogName='System','Application'/)
        return JSON.stringify({ events: [event], hasSecurityLog: true })
      }
      if (script.includes('Get-NetRoute')) {
        return JSON.stringify({ Gateway: '192.0.2.1', Dns: '192.0.2.2' })
      }
      if (script.includes('System.Net.NetworkInformation.Ping')) {
        counts.networkHealth++
        return '[]'
      }
      if (script.includes('Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine')) {
        counts.gpuUsage++
        return '25'
      }
      throw new Error('Unexpected PowerShell diagnostic')
    }
    const repair = { enabled: true }
    const { DataCollectorService } = load('src/main/collectors/index.ts', {
      './system-metrics': load('src/main/collectors/system-metrics.ts', {
        ...gpuDependencies(() => {
          nvidiaQueries++
          return '32, 512, 48'
        }),
        os, systeminformation: si, '../utils/powershell': { runPowerShell },
      }, { ...clock, process: windowsProcess }),
      './process-collector': load('src/main/collectors/process-collector.ts', { systeminformation: si }, clock),
      './event-log-collector': load('src/main/collectors/event-log-collector.ts', {
        '../utils/powershell': { runPowerShell },
        '../../shared/event-repair': { createInitialEventAutoRepairState: () => repair },
        '../maintenance/event-auto-repair': { EventAutoRepairService: class {
          async process() { return repair }
        } },
      }, clock),
      './windows-update-collector': { WindowsUpdateCollector: class {
        async collect() { return this.getLastResult() }
        getLastResult() { return { updates: [] } }
      } },
      '../maintenance/system-maintenance': { SystemMaintenanceService: class {} },
      '../diagnostics/boot-optimizer': { BootOptimizerService: class { initialize() {} } },
      '../diagnostics/network-monitor': load('src/main/diagnostics/network-monitor.ts', {
        electron: { app: { getPath: () => '/unused' } },
        fs: { readFileSync: () => '{}', mkdirSync() {}, writeFileSync() {} },
        path: require('node:path'),
        '../utils/powershell': { runPowerShell },
      }, clock),
    }, clock)
    const collector = new DataCollectorService()
    const win = Object.assign(new EventEmitter(), {
      isVisible: () => visible,
      isMinimized: () => false,
      isDestroyed: () => false,
      webContents: { send() {} },
    })
    const primingCpu = si.currentLoad()
    await flush()
    await advance(500)
    await primingCpu
    await collector.initialize(win)
    assert.equal(counts.gpuInventory, 8, 'initial discovery runs the full Windows graphics query')
    await advance(60_000)
    for (const key of Object.keys(counts)) counts[key] = 0
    nvidiaQueries = 0
    await advance(60_000)
    assert.deepEqual(counts, {
      pageFile: 0, traffic: visible ? 5 : 1, processes: visible ? 6 : 0, eventLog: 1, networkHealth: 4,
      cpuInfo: 3, cpuTemperature: visible ? 2 : 1, disks: visible ? 2 : 1, gpuInventory: 0,
      gpuUsage: vendor === 'AMD' ? (visible ? 4 : 1) : 0,
    })
    assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), expectedPowerShell)
    assert.equal(nvidiaQueries, vendor === 'NVIDIA' ? (visible ? 4 : 1) : 0)
    assert.equal(collector.getLastSnapshot().metrics.gpu.usage, vendor === 'NVIDIA' ? 32 : 25)
    assert.equal(collector.getLastSnapshot().events.hasSecurityLog, true)
    assert.equal(collector.getLastSnapshot().events.events[0].Id, event.Id)
    collector.destroy()
  })
}
