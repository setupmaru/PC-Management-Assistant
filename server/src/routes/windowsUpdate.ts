import { Router, Request, Response } from 'express'
import https from 'https'
import { requireAuth } from '../middleware/auth'

interface UpdateInput {
  title: string
  severity: string
}

interface SearchHit {
  title: string
  url: string
  snippet: string
  source: string
}

interface ConflictResult {
  risk: 'high' | 'possible' | 'none'
  summary: string
  matchedUpdates: { title: string; severity: string }[]
  evidence: { source: string; title: string; snippet: string; url: string }[]
  searchedAt: number
}

const router = Router()

const STRONG_CONFLICT_TERMS = [
  'bsod',
  'blue screen',
  'crash',
  'dropout',
  'crackling',
  'stutter',
  'not recognized',
  'rollback',
  'driver issue',
]

router.post('/conflict-check', requireAuth, async (req: Request, res: Response) => {
  try {
    const audioInterface = String(req.body?.audioInterface ?? '').trim()
    const updatesRaw: unknown[] = Array.isArray(req.body?.updates)
      ? (req.body.updates as unknown[])
      : []

    if (audioInterface.length < 2) {
      res.status(400).json({ error: 'audioInterface must be at least 2 characters.' })
      return
    }

    const updates: UpdateInput[] = updatesRaw
      .map((u: unknown) => {
        const item = u as Partial<UpdateInput>
        return {
          title: String(item.title ?? '').trim(),
          severity: String(item.severity ?? 'Unspecified').trim() || 'Unspecified',
        }
      })
      .filter((u) => u.title.length > 0)
      .slice(0, 5)

    if (updates.length === 0) {
      res.status(400).json({ error: 'updates must contain at least one title.' })
      return
    }

    const queries = buildQueries(audioInterface, updates)
    const allHits: SearchHit[] = []

    for (const query of queries) {
      try {
        const hits = await searchDuckDuckGo(query)
        allHits.push(...hits)
      } catch {
        // keep trying other queries
      }
      if (allHits.length >= 40) break
    }

    const deduped = dedupeByUrl(allHits).slice(0, 40)
    const result = classifyConflicts(audioInterface, updates, deduped)

    res.json({ result })
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

function buildQueries(audioInterface: string, updates: UpdateInput[]): string[] {
  const queries: string[] = []

  for (const update of updates) {
    const kb = extractKb(update.title)
    const anchor = kb ?? update.title.slice(0, 100)
    queries.push(`"${audioInterface}" "${anchor}" windows update audio interface issue`)
    queries.push(`"${audioInterface}" "${anchor}" windows update driver conflict`)
  }

  queries.push(`"${audioInterface}" windows update audio crackling`)
  queries.push(`"${audioInterface}" windows update bsod`)

  return [...new Set(queries)].slice(0, 10)
}

async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await getHtml(url)
  return parseDuckDuckGoHtml(html)
}

function getHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'text/html',
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Search request failed with status ${res.statusCode ?? 'unknown'}`))
          return
        }

        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve(data))
      },
    )

    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy(new Error('Search request timed out'))
    })
  })
}

function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const blockRegex = /<div class="result results_links[\s\S]*?<\/div>\s*<\/div>/gi

  for (const block of html.match(blockRegex) ?? []) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    const rawUrl = decodeHtml(titleMatch[1])
    const rawTitle = decodeHtml(stripTags(titleMatch[2]))

    const snippetMatch = block.match(/<(?:a|div)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i)
    const rawSnippet = snippetMatch ? decodeHtml(stripTags(snippetMatch[1])) : ''

    const resolvedUrl = resolveDuckDuckGoRedirect(rawUrl)
    if (!resolvedUrl) continue

    hits.push({
      title: sanitizeSpace(rawTitle),
      url: resolvedUrl,
      snippet: sanitizeSpace(rawSnippet),
      source: toSourceDomain(resolvedUrl),
    })
  }

  return hits
}

function resolveDuckDuckGoRedirect(raw: string): string | null {
  if (!raw) return null

  if (raw.startsWith('/l/?')) {
    const query = raw.split('?')[1] ?? ''
    const params = new URLSearchParams(query)
    const uddg = params.get('uddg')
    if (!uddg) return null
    try {
      return decodeURIComponent(uddg)
    } catch {
      return uddg
    }
  }

  if (/^https?:\/\//i.test(raw)) return raw
  return null
}

function classifyConflicts(audioInterface: string, updates: UpdateInput[], hits: SearchHit[]): ConflictResult {
  const audioTokens = tokenize(audioInterface)
  const updateMatchers = updates.map((u) => ({
    update: u,
    tokens: updateTokens(u.title),
  }))

  const matchedHits: Array<SearchHit & { matchedTitles: string[]; strong: boolean }> = []

  for (const hit of hits) {
    const text = normalize(`${hit.title} ${hit.snippet}`)
    const audioMatch = audioTokens.some((token) => text.includes(token))
    if (!audioMatch) continue

    const matchedTitles: string[] = []
    for (const matcher of updateMatchers) {
      if (matcher.tokens.some((token) => text.includes(token))) {
        matchedTitles.push(matcher.update.title)
      }
    }

    if (matchedTitles.length === 0) continue

    const strong = STRONG_CONFLICT_TERMS.some((term) => text.includes(normalize(term)))
    matchedHits.push({ ...hit, matchedTitles, strong })
  }

  const matchedUpdateSet = new Set<string>()
  for (const hit of matchedHits) {
    for (const title of hit.matchedTitles) matchedUpdateSet.add(title)
  }

  const matchedUpdates = updates
    .filter((u) => matchedUpdateSet.has(u.title))
    .map((u) => ({ title: u.title, severity: u.severity }))

  let risk: ConflictResult['risk'] = 'none'
  if (matchedHits.length > 0) {
    risk = matchedHits.some((h) => h.strong) || matchedHits.length >= 2 ? 'high' : 'possible'
  }

  const summary = buildSummary(audioInterface, risk, matchedHits.length)

  const evidenceSource = matchedHits.length > 0 ? matchedHits : hits
  const evidence = evidenceSource.slice(0, 5).map((h) => ({
    source: h.source,
    title: h.title,
    snippet: h.snippet,
    url: h.url,
  }))

  return {
    risk,
    summary,
    matchedUpdates,
    evidence,
    searchedAt: Date.now(),
  }
}

function buildSummary(audioInterface: string, risk: 'high' | 'possible' | 'none', matchCount: number): string {
  if (risk === 'none') {
    return `${audioInterface} 관련 공개 충돌 언급을 현재 검색 결과에서 찾지 못했습니다.`
  }
  if (risk === 'high') {
    return `${audioInterface}와 이번 업데이트 조합에서 충돌 징후 언급이 ${matchCount}건 확인되었습니다.`
  }
  return `${audioInterface}와 이번 업데이트 조합의 충돌 가능성 언급이 검색 결과에 확인되었습니다.`
}

function extractKb(title: string): string | null {
  const match = title.match(/KB\d{5,8}/i)
  return match ? match[0].toUpperCase() : null
}

function updateTokens(title: string): string[] {
  const kb = extractKb(title)
  if (kb) return [normalize(kb)]
  return tokenize(title).slice(0, 5)
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function toSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

function dedupeByUrl(items: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item)
  }
  return out
}

export default router
