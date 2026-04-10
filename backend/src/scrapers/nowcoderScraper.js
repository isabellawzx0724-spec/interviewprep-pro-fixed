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

function detectSignals(text = '') {
  const haystack = cleanText(text)
  return {
    antiBotDetected: /验证码|安全验证|请完成验证|请先验证|captcha|robot|异常访问/i.test(haystack),
    loginDetected: /登录后查看|登录查看更多|登录|扫码登录|手机号登录|立即登录/i.test(haystack),
    contentDetected: /面经|面试|一面|二面|三面|终面|复盘|offer|笔试|自我介绍|问了什么/i.test(haystack)
  }
}

function detectPageWarning(text = '') {
  const signals = detectSignals(text)
  if (signals.antiBotDetected) return 'anti-bot checkpoint detected'
  if (signals.loginDetected) return 'login prompt detected'
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

export async function scrapeNowcoder({ company, role, queries = [], limit = 24, cookie = '', headless = true, timeoutMs = 15000 }) {
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  const diagnostics = {
    source: 'Nowcoder',
    warnings: [],
    queryStats: [],
    cookieConfigured: Boolean(cookie),
    cookieInjected: false,
    loginDetected: false,
    antiBotDetected: false,
    authenticatedLikely: false,
    candidateCount: 0,
    lastError: ''
  }

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123 Safari/537.36'
    })
    page.setDefaultTimeout(timeoutMs)

    if (cookie) {
      await page.context().addCookies(parseCookie(cookie, '.nowcoder.com'))
      diagnostics.cookieInjected = true
      console.info('[scrape/nowcoder] cookie injected into browser context')
    } else {
      console.warn('[scrape/nowcoder] cookie missing, running in fallback mode')
    }

    const effectiveQueries = Array.isArray(queries) && queries.length
      ? queries
      : [`${company || ''} ${role || ''} 面经`.trim()]

    const aggregated = []

    for (const query of effectiveQueries.slice(0, 6)) {
      const searchUrl = `https://www.nowcoder.com/search?query=${encodeURIComponent(query)}`

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        await page.waitForTimeout(1200)

        const html = await page.content()
        const $ = cheerio.load(html)
        const bodyText = $('body').text()
        const pageSignals = detectSignals(bodyText)
        const pageWarning = detectPageWarning(bodyText)

        diagnostics.loginDetected = diagnostics.loginDetected || pageSignals.loginDetected
        diagnostics.antiBotDetected = diagnostics.antiBotDetected || pageSignals.antiBotDetected

        if (pageWarning) diagnostics.warnings.push(`${query}: ${pageWarning}`)

        const batch = []
        $('a').each((_, element) => {
          const href = $(element).attr('href')
          if (!href || href.startsWith('javascript:') || href === '#') return

          const title = cleanText($(element).text())
          const url = href.startsWith('http') ? href : `https://www.nowcoder.com${href}`
          const snippet = buildSnippet($, element, title)
          const text = `${title} ${snippet}`

          if (!/nowcoder\.com/i.test(url)) return
          if (!title && !snippet) return
          if (!/面经|面试|一面|二面|三面|hr|终面|复盘|offer/i.test(text)) return

          batch.push({
            source: 'Nowcoder',
            title: title || url,
            url,
            snippet,
            searchQuery: query,
            searchUrl
          })
        })

        if (cookie && batch.length && !pageSignals.loginDetected && !pageSignals.antiBotDetected) {
          diagnostics.authenticatedLikely = true
        }

        diagnostics.queryStats.push({
          query,
          searchUrl,
          candidateCount: batch.length,
          pageWarning: pageWarning || '',
          loginDetected: pageSignals.loginDetected,
          antiBotDetected: pageSignals.antiBotDetected
        })

        aggregated.push(...batch)
      } catch (error) {
        diagnostics.lastError = error.message
        diagnostics.queryStats.push({
          query,
          searchUrl,
          candidateCount: 0,
          error: error.message
        })
        diagnostics.warnings.push(`${query}: ${error.message}`)
      }
    }

    const results = dedupeResults(aggregated, limit)
    diagnostics.candidateCount = results.length

    return {
      results,
      diagnostics
    }
  } catch (error) {
    error.source = 'Nowcoder'
    diagnostics.lastError = error.message
    error.diagnostics = diagnostics
    throw error
  } finally {
    await browser.close()
  }
}
