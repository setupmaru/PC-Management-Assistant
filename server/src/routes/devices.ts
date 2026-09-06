import { Request, Response, Router } from 'express'

import pool from '../config/db'
import { requireAuth } from '../middleware/auth'

const router = Router()
const deviceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function number(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined
}

function sanitizeMetrics(value: unknown): Record<string, unknown> {
  const metrics = record(value)
  const cpu = record(metrics.cpu)
  const gpu = record(metrics.gpu)
  const memory = record(metrics.memory)
  const disks = Array.isArray(metrics.disks) ? metrics.disks.slice(0, 32) : []

  return {
    cpu: {
      usage: number(cpu.usage, 0, 100),
      cores: number(cpu.cores, 0, 1024),
      speed: number(cpu.speed, 0, 20),
      model: text(cpu.model, 160),
      temperature: number(cpu.temperature, -100, 250),
    },
    gpu: Object.keys(gpu).length > 0 ? {
      usage: number(gpu.usage, 0, 100),
      model: text(gpu.model, 160),
      vendor: text(gpu.vendor, 80),
      memoryTotalMb: number(gpu.memoryTotalMb, 0, 10_000_000),
      memoryUsedMb: number(gpu.memoryUsedMb, 0, 10_000_000),
      temperature: number(gpu.temperature, -100, 250),
    } : null,
    memory: {
      total: number(memory.total, 0, Number.MAX_SAFE_INTEGER),
      used: number(memory.used, 0, Number.MAX_SAFE_INTEGER),
      usagePercent: number(memory.usagePercent, 0, 100),
    },
    disks: disks.map((entry) => {
      const disk = record(entry)
      return {
        mount: text(disk.mount, 128),
        fs: text(disk.fs, 64),
        size: number(disk.size, 0, Number.MAX_SAFE_INTEGER),
        used: number(disk.used, 0, Number.MAX_SAFE_INTEGER),
        usagePercent: number(disk.usagePercent, 0, 100),
      }
    }),
    timestamp: number(metrics.timestamp, 0, Number.MAX_SAFE_INTEGER),
  }
}

router.post('/heartbeat', requireAuth, async (req: Request, res: Response) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: '인증이 필요합니다.' })
    return
  }

  const deviceId = text(req.body?.deviceId, 128)
  const name = text(req.body?.name, 255)
  const platform = text(req.body?.platform, 32)
  const osVersion = text(req.body?.osVersion, 255)
  const appVersion = text(req.body?.appVersion, 32)

  if (!deviceIdPattern.test(deviceId) || !name || !platform) {
    res.status(400).json({ error: '장비 식별자, 이름, 운영체제를 확인해주세요.' })
    return
  }

  const metrics = sanitizeMetrics(req.body?.metrics)

  try {
    const result = await pool.query<{ id: string; last_seen_at: Date }>(
      `INSERT INTO managed_devices
         (user_id, device_id, name, platform, os_version, app_version, metrics)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (device_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         name = EXCLUDED.name,
         platform = EXCLUDED.platform,
         os_version = EXCLUDED.os_version,
         app_version = EXCLUDED.app_version,
         metrics = EXCLUDED.metrics,
         last_seen_at = NOW(),
         updated_at = NOW()
       RETURNING id, last_seen_at`,
      [user.id, deviceId, name, platform, osVersion || null, appVersion || null, JSON.stringify(metrics)]
    )

    res.json({
      success: true,
      deviceId: result.rows[0].id,
      lastSeenAt: result.rows[0].last_seen_at.toISOString(),
    })
  } catch (error) {
    console.error('[devices] Heartbeat failed:', error)
    res.status(500).json({ error: '장비 상태를 저장하지 못했습니다.' })
  }
})

export default router
