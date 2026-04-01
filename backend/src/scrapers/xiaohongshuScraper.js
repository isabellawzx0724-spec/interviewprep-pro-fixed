import { chromium } from 'playwright'
import * as cheerio from 'cheerio'

function parseCookie(cookie = '', domain) {
  return cookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, ...rest] = pair.split('=')
      return {
        name,
        value: rest.join('='),
        domain,
        path: '/'
      }
    })
}

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function buildSnippet($, element, title) {
  const container = $(element).closest('article, section, li, div')
  const text = cleanText(container.text())
  if (!text) return ''
  return cleanText(text.replace(title, '')).slice(0, 220)
}

function detectPageWarning(text = '') {
  const haystack = cleanText(text)
  if (!haystack) return ''
  if (/验证码|安全验证|请完成验证|captcha|robot/i.test(haystack)) return 'anti-bot checkpoint detected'
  if (/登录|扫码登录|手机号登录/i.test(haystack)) return 'login prompt detected'
  return ''
}

function dedupeResults(items = [], limit = 24) {
  const seen = new Set()
  const output = []

  for (const item of items) {
    const key = item.url || `${item.source}-${item.title}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(item)
    if (output.length >= limit) break
  }

  return output
}

export async function scrapeXiaohongshu({ company, role, queries = [], limit = 24, cookie = '', headless = true, timeoutMs = 15000 }) {
  const browser = await chromium.launch({ headless })
  const diagnostics = {
    source: 'Xiaohongshu',
    warnings: [],
    queryStats: []
  }

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123 Safari/537.36'
    })
    page.setDefaultTimeout(timeoutMs)

    if (cookie) {
      await page.context().addCookies(parseCookie(cookie, '.xiaohongshu.com'))
    }

    const effectiveQueries = Array.isArray(queries) && queries.length
      ? queries
      : [`${company || ''} ${role || ''} 面经`.trim()]

    const aggregated = []

    for (const query of effectiveQueries.slice(0, 6)) {
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        await page.waitForTimeout(1800)

        const html = await page.content()
        const $ = cheerio.load(html)
        const pageWarning = detectPageWarning($('body').text())
        if (pageWarning) diagnostics.warnings.push(`${query}: ${pageWarning}`)

        const batch = []
        $('a').each((_, element) => {
          const href = $(element).attr('href')
          if (!href || href.startsWith('javascript:') || href === '#') return

          const title = cleanText($(element).text())
          const url = href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`
          const snippet = buildSnippet($, element, title)
          const text = `${title} ${snippet}`

          if (!/xiaohongshu\.com/i.test(url)) return
          if (!title && !snippet) return
          if (!/面经|面试|一面|二面|三面|hr|终面|复盘|offer|笔试/i.test(text)) return

          batch.push({
            source: 'Xiaohongshu',
            title: title || url,
            url,
            snippet,
            searchQuery: query,
            searchUrl
          })
        })

        diagnostics.queryStats.push({
          query,
          searchUrl,
          candidateCount: batch.length,
          pageWarning: pageWarning || ''
        })

        aggregated.push(...batch)
      } catch (error) {
        diagnostics.queryStats.push({
          query,
          searchUrl,
          candidateCount: 0,
          error: error.message
        })
        diagnostics.warnings.push(`${query}: ${error.message}`)
      }
    }

    return {
      results: dedupeResults(aggregated, limit),
      diagnostics
    }
  } catch (error) {
    error.source = 'Xiaohongshu'
    error.diagnostics = diagnostics
    throw error
  } finally {
    await browser.close()
  }
}
