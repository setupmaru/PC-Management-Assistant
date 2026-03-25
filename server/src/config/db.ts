import { Pool } from 'pg'
import { DATABASE_URL } from './env'

const pool = new Pool({
  connectionString: DATABASE_URL,
})

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err)
})

export default pool

export async function closePool(): Promise<void> {
  await pool.end()
}
