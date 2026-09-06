import { Request, Response, Router } from 'express'

import pool from '../config/db'
import { requireBackofficeToken } from '../middleware/backofficeAuth'

const router = Router()

interface DeviceRow {
  id: string
  device_id: string
  name: string
  platform: string
  os_version: string | null
  app_version: string | null
  metrics: Record<string, unknown>
  last_seen_at: Date
  created_at: Date
  owner_email: string
  owner_plan: string
  online: boolean
}

router.get('/managed-pcs', requireBackofficeToken, async (_req: Request, res: Response) => {
  try {
    const [devicesResult, usersResult] = await Promise.all([
      pool.query<DeviceRow>(
        `SELECT d.id,
                d.device_id,
                d.name,
                d.platform,
                d.os_version,
                d.app_version,
                d.metrics,
                d.last_seen_at,
                d.created_at,
                u.email AS owner_email,
                u.plan AS owner_plan,
                d.last_seen_at >= NOW() - INTERVAL '5 minutes' AS online
           FROM managed_devices d
           JOIN users u ON u.id = d.user_id
          ORDER BY d.last_seen_at DESC
          LIMIT 1000`
      ),
      pool.query<{ registered_users: string }>(
        `SELECT COUNT(*)::text AS registered_users
           FROM users
          WHERE email_verified_at IS NOT NULL`
      ),
    ])

    const devices = devicesResult.rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      name: row.name,
      platform: row.platform,
      osVersion: row.os_version,
      appVersion: row.app_version,
      ownerEmail: row.owner_email,
      ownerPlan: row.owner_plan,
      metrics: row.metrics,
      online: row.online,
      lastSeenAt: row.last_seen_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    }))

    res.json({
      status: 'ok',
      api: { reachable: true },
      db: { reachable: true },
      summary: {
        registeredUsers: Number(usersResult.rows[0]?.registered_users ?? 0),
        totalDevices: devices.length,
        onlineDevices: devices.filter((device) => device.online).length,
      },
      devices,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[admin] Managed PC query failed:', error)
    res.status(503).json({
      status: 'degraded',
      api: { reachable: true },
      db: { reachable: false },
      error: 'PC 관리 데이터를 조회하지 못했습니다.',
      timestamp: new Date().toISOString(),
    })
  }
})

export default router
