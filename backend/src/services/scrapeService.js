import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { scrapeNowcoder } from '../scrapers/nowcoderScraper.js'
import { scrapeXiaohongshu } from '../scrapers/xiaohongshuScraper.js'

const HIGH_QUALITY_SCORE = 38
const MAX_RESULTS = 8
const MAX_EXCLUDED = 8
const DETAIL_PAGE_TYPES = new Set(['post', 'discussion', 'detail'])
const CHINESE_SOURCES = new Set(['Nowcoder', 'Xiaohongshu'])
const INTERVIEW_TERMS = ['面经', '面试', '一面', '二面', '三面', 'hr面', '业务面', '终面', 'offer', '总结', '复盘']
const ROUND_TERMS = ['一面', '二面', '三面', '四面', 'hr面', '业务面', '专业面', '交叉面', '终面', '群面', '无领导']
const CONTENT_TERMS = ['问了', '问题', '回答', '流程', '自我介绍', '深挖', '追问', 'case', '反问', '笔试', '群面', '终面']

const COMPANY_ALIAS_RULES = [
  { test: /tencent|腾讯/i, aliases: ['腾讯', 'Tencent'] }
]

const ROLE_ALIAS_RULES = [
  {
    test: /business development intern|business development|商务拓展实习|商务拓展|商业拓展|商务发展|\bbd\b/i,
    aliases: ['商务拓展', '商务拓展实习', '商务拓展实习生', '商业拓展', 'BD', 'BD实习', 'Business Development']
  },
  {
    test: /product operations|产品运营/i,
    aliases: ['产品运营', '产品运营实习', 'Product Operations']
  },
  {
    test: /product manager|产品经理|\bpm\b/i,
    aliases: ['产品经理', '产品经理实习', 'PM', 'Product Manager']
  },
  {
    test: /marketing|市场|营销/i,
    aliases: ['市场', '营销', '市场营销', 'Marketing']
  },
  {
    test: /strategy|战略|策略/i,
    aliases: ['战略', '策略', 'Strategy']
  },
  {
    test: /data analyst|数据分析|数据分析师/i,
    aliases: ['数据分析', '数据分析师', 'Data Analyst']
  }
]

const TYPE_ALIAS_RULES = [
  { test: /^hr|human|人力/i, aliases: ['HR面', '人力面', 'HR'] },
  { test: /professional|business|functional|专业|业务|职能/i, aliases: ['业务面', '专业面', '职能面'] },
  { test: /manager|final|终面|主管/i, aliases: ['终面', '主管面'] },
  { test: /group|群面|无领导/i, aliases: ['群面', '无领导'] },
  { test: /technical|tech|技术/i, aliases: ['技术面'] }
]

const REJECT_URL_RULES = [
  { pattern: /\/interview\/center/i, reason: 'interview-center-page' },
  { pattern: /\/interview\/ai/i, reason: 'ai-interview-page' },
  { pattern: /hr\.nowcoder\.com/i, reason: 'enterprise-hr-page' },
  { pattern: /\/search_result/i, reason: 'search-results-page' },
  { pattern: /[?&]query=/i, reason: 'search-results-page' },
  { pattern: /\/search(\b|\/)/i, reason: 'search-results-page' },
  { pattern: /\/login|signin|signup|register/i, reason: 'login-page' },
  { pattern: /trial|free[-_ ]?trial|免费试用/i, reason: 'trial-page' },
  { pattern: /solution|solutions|product|products|pricing|商业化|企业服务/i, reason: 'product-page' },
  { pattern: /\.(png|jpg|jpeg|svg|gif|webp|pdf)(\?|$)/i, reason: 'static-asset' }
]

const REJECT_TITLE_RULES = [
  { pattern: /AI模拟面试|免费试用|企业方案|产品|解决方案|导航栏|面试中心|商业化|官方入口/i, reason: 'landing-or-product-title' },
  { pattern: /登录|注册|验证码|扫码/i, reason: 'login-title' }
]

const runtimeState = {
  Nowcoder: {
    source: 'Nowcoder',
    cookieValid: 'unknown',
    lastError: '',
    lastErrorCode: '',
    lastCheckedAt: '',
    authenticatedLikely: false,
    cookieInjectedLastRun: false,
    searchRewriteEnabled: true
  },
  Xiaohongshu: {
    source: 'Xiaohongshu',
    cookieValid: 'unknown',
    lastError: '',
    lastErrorCode: '',
    lastCheckedAt: '',
    authenticatedLikely: false,
    cookieInjectedLastRun: false,
    searchRewriteEnabled: true
  }
}

function cleanDiagnosticText(value = '') {
  return String(value)
    .replace(/\u001b\[[0-9;]*m/g, ' ')
    .replace(/[─-╿▀-▟]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function classifyScrapeError(value = '') {
  const message = cleanDiagnosticText(value)

  if (!message) return { code: '', message: '' }
  if (/browser executable doesn't exist|executable doesn't exist|please run:.*playwright install|failed to launch browser/i.test(message)) {
    return { code: 'browser-not-installed', message: 'Browser not installed on server' }
  }
  if (/host system is missing dependencies|missing dependencies|lib.*.so/i.test(message)) {
    return { code: 'browser-runtime-missing-deps', message: 'Browser runtime missing required system libraries' }
  }
  if (/timeout/i.test(message)) {
    return { code: 'timeout', message: 'Source temporarily timed out' }
  }
  if (/captcha|anti-bot|verification|verify|异常访问|安全验证|验证码/i.test(message)) {
    return { code: 'source-blocked', message: 'Source temporarily blocked' }
  }
  if (/cookie|login|signin|登录|扫码登录/i.test(message)) {
    return { code: 'cookie-invalid', message: 'Cookie invalid or login required' }
  }
  if (/selector|locator/i.test(message)) {
    return { code: 'selector-outdated', message: 'Scraper selector outdated' }
  }

  return { code: 'scrape-unavailable', message: 'Source temporarily unavailable' }
}

function sanitizePublicError(value = '') {
  const message = cleanDiagnosticText(value)
  if (!message) return ''
  if (/company-too-short|role-too-short|cookie missing|ALLOW_LIVE_SCRAPE/i.test(message)) return message
  return classifyScrapeError(message).message || 'Source temporarily unavailable'
}

function sanitizeWarnings(warnings = []) {
  return uniqueStrings(warnings.map((item) => sanitizePublicError(item)).filter(Boolean), 12)
}

function sanitizeDiagnostics(diagnostics = null) {
  if (!diagnostics) return null

  return {
    ...diagnostics,
    warnings: sanitizeWarnings(diagnostics.warnings || []),
    lastError: sanitizePublicError(diagnostics.lastError || ''),
    lastErrorCode: classifyScrapeError(diagnostics.lastError || '').code || '',
    queryStats: Array.isArray(diagnostics.queryStats)
      ? diagnostics.queryStats.map((item) => ({
        ...item,
        error: sanitizePublicError(item.error || ''),
        errorCode: classifyScrapeError(item.error || '').code || '',
        pageWarning: sanitizePublicError(item.pageWarning || ''),
        pageWarningCode: classifyScrapeError(item.pageWarning || '').code || ''
      }))
      : []
  }
}

function getBrowserRuntime() {
  try {
    const browserPath = cleanDiagnosticText(typeof chromium.executablePath === 'function' ? chromium.executablePath() : '')
    const browserExecutableFound = Boolean(browserPath) && existsSync(browserPath)
    return {
      playwrightInstalled: true,
      browserPath,
      browserExecutableFound,
      browserRuntimeReady: browserExecutableFound
    }
  } catch (error) {
    return {
      playwrightInstalled: false,
      browserPath: '',
      browserExecutableFound: false,
      browserRuntimeReady: false,
      browserIssue: sanitizePublicError(error.message || '')
    }
  }
}

function toNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeSpace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizeKey(value = '') {
  return normalizeSpace(value).toLowerCase()
}

function containsChinese(value = '') {
  return /[\u4e00-\u9fa5]/.test(value)
}

function detectLanguage(value = '') {
  if (containsChinese(value)) {
    return /[a-zA-Z]/.test(value) ? 'mixed' : 'zh'
  }
  if (/[a-zA-Z]/.test(value)) return 'en'
  return 'unknown'
}

function uniqueStrings(values = [], limit = Infinity) {
  const seen = new Set()
  const output = []

  for (const value of values) {
    const normalized = normalizeSpace(value)
    if (!normalized) continue
    const key = normalizeKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
    if (output.length >= limit) break
  }

  return output
}

function canonicalSource(source = '') {
  const normalized = normalizeKey(source)
  if (normalized.includes('nowcoder')) return 'Nowcoder'
  if (normalized.includes('xiaohongshu')) return 'Xiaohongshu'
  return normalizeSpace(source) || 'Unknown'
}

function canonicalInterviewType(value = '') {
  const normalized = normalizeKey(value)
  if (/^hr|human|人力/.test(normalized)) return 'hr'
  if (/professional|business|functional|专业|业务|职能/.test(normalized)) return 'professional'
  if (/manager|final|终面|主管/.test(normalized)) return 'manager'
  if (/group|群面|无领导/.test(normalized)) return 'group'
  if (/technical|tech|技术/.test(normalized)) return 'technical'
  if (/one|1v1|single|单面/.test(normalized)) return 'oneOnOne'
  return normalized
}

function expandAliases(value = '', rules = []) {
  const normalized = normalizeSpace(value)
  const aliases = [normalized]

  for (const rule of rules) {
    if (rule.test.test(normalized)) {
      aliases.push(...rule.aliases)
    }
  }

  return uniqueStrings(aliases)
}

function stripRoleDecorators(role = '') {
  return normalizeSpace(role)
    .replace(/\b(intern(ship)?|summer|full[- ]?time|graduate)\b/ig, '')
    .replace(/实习生?|校招|岗位/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectIntern(role = '') {
  return /intern|实习/i.test(role)
}

function firstChinese(values = []) {
  return values.find((value) => containsChinese(value))
}

function buildTypeAliases(interviewType = '') {
  const canonical = canonicalInterviewType(interviewType)
  const aliases = expandAliases(interviewType, TYPE_ALIAS_RULES)

  if (canonical === 'hr') aliases.push('HR面', '人力面')
  if (canonical === 'professional') aliases.push('业务面', '专业面', '职能面')
  if (canonical === 'manager') aliases.push('终面', '主管面')
  if (canonical === 'group') aliases.push('群面', '无领导')
  if (canonical === 'technical') aliases.push('技术面')

  return uniqueStrings(aliases)
}

function composeOriginalQuery({ company = '', role = '', interviewType = '' } = {}) {
  return normalizeSpace([company, role, interviewType, 'interview experience'].filter(Boolean).join(' '))
}

export function buildSourceSearchUrl(source, query = '') {
  const normalizedSource = canonicalSource(source)
  const encoded = encodeURIComponent(normalizeSpace(query))

  if (normalizedSource === 'Nowcoder') {
    return `https://www.nowcoder.com/search?query=${encoded}`
  }

  if (normalizedSource === 'Xiaohongshu') {
    return `https://www.xiaohongshu.com/search_result?keyword=${encoded}`
  }

  return `https://www.bing.com/search?q=${encoded}`
}

export function buildSearchPlan({ company = '', role = '', interviewType = '' } = {}) {
  const originalQuery = composeOriginalQuery({ company, role, interviewType })
  const rawCompany = normalizeSpace(company)
  const rawRole = normalizeSpace(role)
  const strippedRole = stripRoleDecorators(rawRole)
  const inputLanguage = detectLanguage(originalQuery || `${rawCompany} ${rawRole}`)
  const companyAliases = uniqueStrings([
    ...expandAliases(rawCompany, COMPANY_ALIAS_RULES),
    rawCompany.length < 2 ? '大厂' : ''
  ], 4)
  const roleAliases = uniqueStrings([
    ...expandAliases(rawRole, ROLE_ALIAS_RULES),
    ...expandAliases(strippedRole, ROLE_ALIAS_RULES),
    strippedRole,
    rawRole.length < 2 ? '实习' : ''
  ], 8)
  const typeAliases = buildTypeAliases(interviewType)
  const primaryCompany = firstChinese(companyAliases) || companyAliases[0] || '大厂'
  const primaryRole = firstChinese(roleAliases) || roleAliases[0] || '实习'
  const shortRole = roleAliases.find((item) => /^(BD|PM)$/i.test(item) || /商务拓展|商业拓展|产品运营|产品经理|市场|营销|战略|数据分析/.test(item)) || primaryRole
  const hasIntern = detectIntern(rawRole)
  const roleVariants = uniqueStrings([
    primaryRole,
    hasIntern && !/实习/.test(primaryRole) ? `${primaryRole}实习` : '',
    hasIntern && !/实习生/.test(primaryRole) ? `${primaryRole}实习生` : '',
    shortRole,
    hasIntern && /^(BD|PM)$/i.test(shortRole) ? `${shortRole}实习` : ''
  ], 5)
  const primaryType = firstChinese(typeAliases) || typeAliases[0] || ''
  const warnings = []

  if (rawCompany.length < 2) warnings.push('company-too-short')
  if (rawRole.length < 2) warnings.push('role-too-short')

  const nowcoderQueries = uniqueStrings([
    `${primaryCompany} ${roleVariants[0] || primaryRole} 面经`,
    `${primaryCompany} ${primaryRole} 一面 二面`,
    `${primaryCompany} ${shortRole} 面试`,
    primaryType ? `${primaryCompany} ${primaryRole} ${primaryType}` : '',
    `${primaryCompany} ${primaryRole} 牛客`,
    originalQuery
  ], 5)

  const xiaohongshuQueries = uniqueStrings([
    `${primaryCompany} ${roleVariants[0] || primaryRole} 面经`,
    `${primaryCompany} ${shortRole} 面试`,
    `${primaryCompany} ${primaryRole} 复盘`,
    primaryType ? `${primaryCompany} ${primaryRole} ${primaryType}` : '',
    `${primaryCompany} ${primaryRole} 小红书`,
    originalQuery
  ], 5)

  const sourcePlans = {
    Nowcoder: {
      source: 'Nowcoder',
      sourceLanguage: CHINESE_SOURCES.has('Nowcoder') ? 'zh' : inputLanguage,
      inputLanguage,
      originalQuery,
      normalizedQueries: nowcoderQueries,
      displayQuery: nowcoderQueries[0] || originalQuery,
      usedQueryRewrite: CHINESE_SOURCES.has('Nowcoder') && normalizeKey(nowcoderQueries[0] || '') !== normalizeKey(originalQuery || '')
    },
    Xiaohongshu: {
      source: 'Xiaohongshu',
      sourceLanguage: CHINESE_SOURCES.has('Xiaohongshu') ? 'zh' : inputLanguage,
      inputLanguage,
      originalQuery,
      normalizedQueries: xiaohongshuQueries,
      displayQuery: xiaohongshuQueries[0] || originalQuery,
      usedQueryRewrite: CHINESE_SOURCES.has('Xiaohongshu') && normalizeKey(xiaohongshuQueries[0] || '') !== normalizeKey(originalQuery || '')
    }
  }

  return {
    rawInput: { company: rawCompany, role: rawRole, interviewType: normalizeSpace(interviewType), originalQuery },
    inputLanguage,
    companyAliases,
    roleAliases,
    typeAliases,
    primaryCompany,
    primaryRole,
    keywordsBySource: {
      Nowcoder: nowcoderQueries,
      Xiaohongshu: xiaohongshuQueries
    },
    sourcePlans,
    warnings
  }
}

function aliasHits(haystack, aliases = []) {
  const text = normalizeKey(haystack)
  return uniqueStrings(aliases.filter((alias) => normalizeKey(alias) && text.includes(normalizeKey(alias))), 8)
}

function titleHits(title, aliases = []) {
  return aliasHits(title, aliases).length > 0
}

function detectPageType(url = '', source = '') {
  const normalizedUrl = normalizeKey(url)
  const normalizedSource = canonicalSource(source)

  if (normalizedSource === 'Xiaohongshu' && /xiaohongshu\.com\/(explore|discovery\/item)/.test(normalizedUrl)) {
    return 'post'
  }

  if (normalizedSource === 'Nowcoder' && /nowcoder\.com\/(discuss|discussion)\//.test(normalizedUrl)) {
    return 'discussion'
  }

  if (normalizedSource === 'Nowcoder' && /nowcoder\.com\/feed\/main\/detail/.test(normalizedUrl)) {
    return 'detail'
  }

  if (/detail|post|note|article|thread/.test(normalizedUrl)) {
    return 'detail'
  }

  return 'unknown'
}

function rankCandidate(candidate, searchPlan) {
  const source = canonicalSource(candidate.source)
  const title = normalizeSpace(candidate.title || candidate.url)
  const url = normalizeSpace(candidate.url)
  const snippet = normalizeSpace(candidate.snippet || '')
  const searchQuery = normalizeSpace(candidate.searchQuery || '')
  const searchUrl = normalizeSpace(candidate.searchUrl || buildSourceSearchUrl(source, searchQuery))
  const pageType = detectPageType(url, source)
  const haystack = `${title} ${snippet} ${url}`.toLowerCase()
  const companyHits = aliasHits(haystack, searchPlan.companyAliases)
  const roleHits = aliasHits(haystack, searchPlan.roleAliases)
  const typeHits = aliasHits(haystack, searchPlan.typeAliases)
  const semanticHits = aliasHits(haystack, INTERVIEW_TERMS)
  const contentHits = aliasHits(haystack, CONTENT_TERMS)
  const roundHits = aliasHits(haystack, ROUND_TERMS)
  const matchedKeywords = uniqueStrings([
    ...companyHits,
    ...roleHits,
    ...typeHits,
    ...semanticHits,
    ...roundHits
  ], 10)
  const rejectReasons = []
  const why = []
  let score = 0

  for (const rule of REJECT_URL_RULES) {
    if (rule.pattern.test(url)) rejectReasons.push(rule.reason)
  }

  for (const rule of REJECT_TITLE_RULES) {
    if (rule.pattern.test(title)) rejectReasons.push(rule.reason)
  }

  if (source === 'Nowcoder') score += 8
  if (source === 'Xiaohongshu') score += 7

  if (companyHits.length) {
    score += titleHits(title, searchPlan.companyAliases) ? 20 : 12
    why.push('命中公司关键词')
  }

  if (roleHits.length) {
    score += titleHits(title, searchPlan.roleAliases) ? 18 : 10
    why.push('命中岗位别名')
  }

  if (semanticHits.length) {
    score += titleHits(title, INTERVIEW_TERMS) ? 18 : 10
    why.push('包含真实面试语义')
  }

  if (roundHits.length) {
    score += 8
    why.push('包含轮次信息')
  }

  if (typeHits.length) {
    score += 6
    why.push('与面试类型相关')
  }

  if (contentHits.length) {
    score += 10
    why.push('摘要提到流程或问题')
  }

  if (DETAIL_PAGE_TYPES.has(pageType)) {
    score += 14
    why.push(`URL 更像${pageType}详情页`)
  }

  if (source === 'Nowcoder' && /nowcoder\.com\/(discuss|discussion|feed\/main\/detail)/i.test(url)) score += 6
  if (source === 'Xiaohongshu' && /xiaohongshu\.com\/(explore|discovery\/item)/i.test(url)) score += 6
  if ((companyHits.length || roleHits.length) && (companyHits.some(containsChinese) || roleHits.some(containsChinese))) score += 4

  if (!companyHits.length && !roleHits.length) rejectReasons.push('missing-company-or-role-signal')
  if (!semanticHits.length && !roundHits.length) rejectReasons.push('missing-interview-semantic')
  if (!DETAIL_PAGE_TYPES.has(pageType)) rejectReasons.push('not-detail-page')

  const uniqueRejectReasons = uniqueStrings(rejectReasons, 6)
  const whyMatched = uniqueStrings(why, 3).join('；')
  const isHighQuality = !uniqueRejectReasons.length && score >= HIGH_QUALITY_SCORE

  return {
    source,
    title,
    url,
    snippet,
    searchQuery,
    searchUrl,
    matchedKeywords,
    score,
    pageType,
    whyMatched,
    rejectReasons: uniqueRejectReasons,
    isHighQuality,
    kind: 'direct'
  }
}

function dedupeCandidates(items = []) {
  const seen = new Set()
  const output = []

  for (const item of items) {
    const urlKey = normalizeKey(item.url)
    const titleKey = `${canonicalSource(item.source)}::${normalizeKey(item.title)}`
    const key = urlKey || titleKey
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

function summarizeExcluded(items = []) {
  return items.slice(0, MAX_EXCLUDED).map((item) => ({
    source: item.source,
    title: item.title,
    url: item.url,
    pageType: item.pageType,
    searchQuery: item.searchQuery,
    reasons: item.rejectReasons
  }))
}

function inferCookieValidity(cookieConfigured, diagnostics) {
  if (!cookieConfigured) return 'false'
  if (!diagnostics) return 'unknown'
  if (diagnostics.loginDetected) return 'false'
  if (diagnostics.authenticatedLikely) return 'true'
  if (diagnostics.antiBotDetected) return 'unknown'
  return 'unknown'
}

function updateRuntimeStatus(source, config, diagnostics = null, errorMessage = '') {
  const runtime = runtimeState[source] || {
    source,
    cookieValid: 'unknown',
    lastError: '',
    lastCheckedAt: '',
    authenticatedLikely: false,
    cookieInjectedLastRun: false,
    searchRewriteEnabled: true
  }

  runtimeState[source] = {
    ...runtime,
    lastCheckedAt: new Date().toISOString(),
    lastError: sanitizePublicError(errorMessage || diagnostics?.lastError || ''),
    lastErrorCode: classifyScrapeError(errorMessage || diagnostics?.lastError || '').code || '',
    authenticatedLikely: Boolean(diagnostics?.authenticatedLikely),
    cookieInjectedLastRun: Boolean(diagnostics?.cookieInjected),
    cookieValid: diagnostics ? inferCookieValidity(source === 'Nowcoder' ? config.hasNowcoderCookie : config.hasXiaohongshuCookie, diagnostics) : runtime.cookieValid,
    searchRewriteEnabled: CHINESE_SOURCES.has(source),
    candidateCount: Number(diagnostics?.candidateCount || 0),
    loginDetected: Boolean(diagnostics?.loginDetected),
    antiBotDetected: Boolean(diagnostics?.antiBotDetected)
  }
}

function buildStatus({ config, warnings = [], rawCandidateCount = 0, highQualityCount = 0, excluded = [], sourceDiagnostics = [] }) {
  const lowerWarnings = warnings.map((item) => normalizeKey(item))

  if (!config.enabled) return 'disabled'
  if (!config.browserRuntimeReady) return 'browser-unavailable'
  if (lowerWarnings.some((item) => item.includes('browser not installed') || item.includes('browser runtime'))) return 'browser-unavailable'
  if (lowerWarnings.some((item) => item.includes('anti-bot') || item.includes('captcha') || item.includes('验证'))) return 'anti-bot'
  if (lowerWarnings.some((item) => item.includes('timeout'))) return 'timeout'
  if (sourceDiagnostics.some((item) => item?.loginDetected) && !highQualityCount) return 'cookie-invalid'
  if (highQualityCount) return 'ok'
  if (!config.hasNowcoderCookie && !config.hasXiaohongshuCookie) return 'cookie-missing'
  if (!config.hasNowcoderCookie || !config.hasXiaohongshuCookie) return 'cookie-partial'
  if (!rawCandidateCount) return 'no-candidates'
  if (!highQualityCount) {
    const navigationOnly = excluded.some((item) => item.rejectReasons.some((reason) => ['interview-center-page', 'ai-interview-page', 'product-page', 'search-results-page', 'landing-or-product-title'].includes(reason)))
    return navigationOnly ? 'only-navigation-pages' : 'no-high-quality-detail'
  }
  return 'ok'
}

export function buildScrapeNextStep(result) {
  switch (result.status) {
    case 'disabled':
      return 'ALLOW_LIVE_SCRAPE 还是 false，请先打开实时抓取。'
    case 'browser-unavailable':
      return '服务端浏览器运行环境还没准备好。先确认 Render build 阶段已执行 playwright install chromium，并检查 crawler status 里的 browserRuntimeReady / browserExecutableFound。'
    case 'cookie-missing':
      return '两个中文站点的 cookie 都没有读到，请重新复制浏览器里完整 Cookie 到环境变量。'
    case 'cookie-partial':
      return '至少有一个中文站点还没有可用 cookie。先看 crawler status，确认是缺失还是已失效。'
    case 'cookie-invalid':
      return 'Cookie 已读取，但站点仍然出现登录提示。优先刷新登录态，并在 debug.sourceDiagnostics 里确认是哪个 source 失效。'
    case 'anti-bot':
      return '站点很可能触发了反爬或登录校验，先刷新 Cookie，再尝试 PLAYWRIGHT_HEADLESS=false 本地调试。'
    case 'timeout':
      return '页面超时了，先提高 SCRAPE_TIMEOUT_MS，或在本地关闭 headless 观察页面是否卡在验证环节。'
    case 'only-navigation-pages':
      return '当前关键词只打到了导航页或搜索页，优先检查 debug.keywords 和 excludedTop，调整中文岗位 alias。'
    case 'no-high-quality-detail':
      return '抓到了候选，但没有足够高分的帖子详情页。优先看 excludedTop 的过滤原因和 sourceDiagnostics。'
    case 'no-candidates':
      return '当前搜索词没有抓到候选结果，请优先检查关键词是否过短、Cookie 是否失效、站点是否改版。'
    default:
      return '已经拿到高质量详情页，可以继续走 /generate，并优先引用 results 里的直链证据。'
  }
}

export function isHighQualityEvidence(item = {}) {
  return DETAIL_PAGE_TYPES.has(item.pageType) && Number(item.score || 0) >= HIGH_QUALITY_SCORE && Boolean(item.url || item.referenceUrl)
}

export function getScrapeConfig() {
  const browserRuntime = getBrowserRuntime()
  return {
    enabled: process.env.ALLOW_LIVE_SCRAPE === 'true',
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    timeoutMs: toNumber(process.env.SCRAPE_TIMEOUT_MS, 15000),
    hasNowcoderCookie: Boolean(process.env.NOWCODER_COOKIE),
    hasXiaohongshuCookie: Boolean(process.env.XIAOHONGSHU_COOKIE),
    chineseQueryRewriteEnabled: true,
    playwrightInstalled: browserRuntime.playwrightInstalled,
    browserExecutableFound: browserRuntime.browserExecutableFound,
    browserRuntimeReady: browserRuntime.browserRuntimeReady,
    browserPath: browserRuntime.browserPath,
    browserIssue: browserRuntime.browserIssue || '',
    browserIssueCode: classifyScrapeError(browserRuntime.browserIssue || '').code || '',
    liveScrapeAvailable: process.env.ALLOW_LIVE_SCRAPE === 'true' && browserRuntime.browserRuntimeReady
  }
}

export function getCrawlerStatus() {
  const config = getScrapeConfig()
  const sources = [
    {
      key: 'nowcoder',
      source: 'Nowcoder',
      crawlerEnabled: config.enabled,
      cookieConfigured: config.hasNowcoderCookie,
      cookieValid: config.hasNowcoderCookie ? runtimeState.Nowcoder.cookieValid : 'false',
      cookieInjectedLastRun: runtimeState.Nowcoder.cookieInjectedLastRun,
      authenticatedLikely: runtimeState.Nowcoder.authenticatedLikely,
      loginDetected: Boolean(runtimeState.Nowcoder.loginDetected),
      antiBotDetected: Boolean(runtimeState.Nowcoder.antiBotDetected),
      candidateCount: Number(runtimeState.Nowcoder.candidateCount || 0),
      lastError: runtimeState.Nowcoder.lastError,
      lastErrorCode: runtimeState.Nowcoder.lastErrorCode,
      lastCheckedAt: runtimeState.Nowcoder.lastCheckedAt,
      searchRewriteEnabled: true,
      liveScrapeAvailable: config.liveScrapeAvailable
    },
    {
      key: 'xiaohongshu',
      source: 'Xiaohongshu',
      crawlerEnabled: config.enabled,
      cookieConfigured: config.hasXiaohongshuCookie,
      cookieValid: config.hasXiaohongshuCookie ? runtimeState.Xiaohongshu.cookieValid : 'false',
      cookieInjectedLastRun: runtimeState.Xiaohongshu.cookieInjectedLastRun,
      authenticatedLikely: runtimeState.Xiaohongshu.authenticatedLikely,
      loginDetected: Boolean(runtimeState.Xiaohongshu.loginDetected),
      antiBotDetected: Boolean(runtimeState.Xiaohongshu.antiBotDetected),
      candidateCount: Number(runtimeState.Xiaohongshu.candidateCount || 0),
      lastError: runtimeState.Xiaohongshu.lastError,
      lastErrorCode: runtimeState.Xiaohongshu.lastErrorCode,
      lastCheckedAt: runtimeState.Xiaohongshu.lastCheckedAt,
      searchRewriteEnabled: true,
      liveScrapeAvailable: config.liveScrapeAvailable
    }
  ]

  return {
    crawlerEnabled: config.enabled,
    chineseQueryRewriteEnabled: true,
    playwrightInstalled: config.playwrightInstalled,
    browserExecutableFound: config.browserExecutableFound,
    browserRuntimeReady: config.browserRuntimeReady,
    browserPath: config.browserPath,
    browserIssue: config.browserIssue,
    browserIssueCode: config.browserIssueCode,
    liveScrapeAvailable: config.liveScrapeAvailable,
    sources
  }
}

function logSourcePlan(searchPlan) {
  for (const source of Object.keys(searchPlan.sourcePlans || {})) {
    const plan = searchPlan.sourcePlans[source]
    console.info(
      `[scrape] source=${source} inputLanguage=${plan.inputLanguage} original="${plan.originalQuery}" normalized="${(plan.normalizedQueries || []).join(' | ')}" rewrite=${plan.usedQueryRewrite}`
    )
  }
}

export async function runLiveScrape({ company = '', role = '', interviewType = '' }) {
  const config = getScrapeConfig()
  const searchPlan = buildSearchPlan({ company, role, interviewType })
  const initialWarnings = [...searchPlan.warnings]

  if (!config.enabled) {
    const result = {
      enabled: false,
      config,
      status: 'disabled',
      searchPlan,
      results: [],
      rawCandidateCount: 0,
      filteredCount: 0,
      warnings: ['ALLOW_LIVE_SCRAPE is false', ...initialWarnings],
      debug: {
        keywords: searchPlan.keywordsBySource,
        rawCandidateCount: 0,
        filteredCount: 0,
        excludedTop: [],
        sourceDiagnostics: []
      },
      crawlerStatus: getCrawlerStatus()
    }
    result.debug.nextStep = buildScrapeNextStep(result)
    return result
  }

  if (!config.hasNowcoderCookie) initialWarnings.push('Nowcoder cookie missing')
  if (!config.hasXiaohongshuCookie) initialWarnings.push('Xiaohongshu cookie missing')
  if (!config.browserRuntimeReady) initialWarnings.push(config.browserIssue || 'Browser not installed on server')

  if (!config.browserRuntimeReady) {
    const result = {
      enabled: true,
      config,
      status: 'browser-unavailable',
      searchPlan,
      results: [],
      rawCandidateCount: 0,
      filteredCount: 0,
      warnings: sanitizeWarnings(initialWarnings),
      debug: {
        keywords: searchPlan.keywordsBySource,
        rawCandidateCount: 0,
        filteredCount: 0,
        excludedTop: [],
        sourceDiagnostics: [],
        qualityThreshold: HIGH_QUALITY_SCORE
      },
      crawlerStatus: getCrawlerStatus()
    }
    result.debug.nextStep = buildScrapeNextStep(result)
    return result
  }

  logSourcePlan(searchPlan)

  const [nowcoder, xiaohongshu] = await Promise.allSettled([
    scrapeNowcoder({
      company,
      role,
      queries: searchPlan.keywordsBySource.Nowcoder,
      cookie: process.env.NOWCODER_COOKIE || '',
      headless: config.headless,
      timeoutMs: config.timeoutMs
    }),
    scrapeXiaohongshu({
      company,
      role,
      queries: searchPlan.keywordsBySource.Xiaohongshu,
      cookie: process.env.XIAOHONGSHU_COOKIE || '',
      headless: config.headless,
      timeoutMs: config.timeoutMs
    })
  ])

  const warnings = [...initialWarnings]
  const rawResults = []
  const sourceDiagnostics = []

  for (const settled of [nowcoder, xiaohongshu]) {
    if (settled.status === 'fulfilled') {
      rawResults.push(...(settled.value.results || []))
      if (settled.value.diagnostics) {
        sourceDiagnostics.push(sanitizeDiagnostics(settled.value.diagnostics))
        updateRuntimeStatus(settled.value.diagnostics.source, config, settled.value.diagnostics)
      }
      if (Array.isArray(settled.value.diagnostics?.warnings)) warnings.push(...settled.value.diagnostics.warnings)
    } else {
      const message = settled.reason?.message || 'unknown error'
      const source = settled.reason?.source || 'Scraper'
      console.warn(`[scrape] ${source} failed: ${message}`)
      warnings.push(`${source} ${sanitizePublicError(message)}`)
      updateRuntimeStatus(source, config, settled.reason?.diagnostics, message)
      if (settled.reason?.diagnostics) sourceDiagnostics.push(sanitizeDiagnostics(settled.reason.diagnostics))
    }
  }

  const ranked = dedupeCandidates(rawResults).map((item) => rankCandidate(item, searchPlan))
  const included = ranked
    .filter((item) => item.isHighQuality)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
  const excluded = ranked.filter((item) => !item.isHighQuality)
  const status = buildStatus({
    config,
    warnings,
    rawCandidateCount: ranked.length,
    highQualityCount: included.length,
    excluded,
    sourceDiagnostics
  })

  const result = {
    enabled: true,
    config,
    status,
    searchPlan,
    results: included,
    rawCandidateCount: ranked.length,
    filteredCount: included.length,
    warnings: sanitizeWarnings(warnings),
    debug: {
      keywords: searchPlan.keywordsBySource,
      rawCandidateCount: ranked.length,
      filteredCount: included.length,
      excludedTop: summarizeExcluded(excluded),
      sourceDiagnostics,
      qualityThreshold: HIGH_QUALITY_SCORE
    },
    crawlerStatus: getCrawlerStatus()
  }

  result.debug.nextStep = buildScrapeNextStep(result)
  return result
}
