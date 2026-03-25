import si from 'systeminformation'

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number    // %
  mem: number    // %
  memRss: number // bytes
}

export async function collectTopProcesses(limit = 10): Promise<ProcessInfo[]> {
  try {
    const { list } = await si.processes()
    return list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, limit)
      .map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: Math.round(p.cpu * 10) / 10,
        mem: Math.round(p.mem * 10) / 10,
        memRss: p.memRss ?? 0,
      }))
  } catch {
    return []
  }
}
