import { scrapeNowcoder } from '../scrapers/nowcoderScraper.js'
import { scrapeXiaohongshu } from '../scrapers/xiaohongshuScraper.js'

const HIGH_QUALITY_SCORE = 38
const MAX_RESULTS = 8
const MAX_EXCLUDED = 8
const DETAIL_PAGE_TYPES = new Set(['post', 'discussion', 'detail'])
const INTERVIEW_TERMS = ['面经', '面试', '一面', '二面', '三面', 'hr面', '业务面', '终面', 'offer', '总结', '复盘']
const ROUND_TERMS = ['一面', '二面', '三面', '四面', 'hr面', '业务面', '专业面', '交叉面', '终面', '群面', '无领导']
const CONTENT_TERMS = ['问了', '问题', '回答', '流程', '自我介绍', '深挖', '追问', 'case', '反问', '笔试', '群面', '终面']

const COMPANY_ALIAS_RULES = [
  { test: /tencent|腾讯/i, aliases: ['腾讯', 'Tencent'] }
]

const ROLE_ALIAS_RULES = [
  {
    test: /business development|商务拓展|商务发展|\bbd\b/i,
    aliases: ['商务拓展', 'BD', '商务拓展实习', '商务拓展实习生', 'BD实习', 'Business Development']
  },
  {
    test: /product operations|产品运营/i,
    aliases: ['产品运营', '产品运营实习', 'Product Operations']
  },
  {
    test: /product manager|产品经理|\bpm\b/i,
    aliases: ['产品经理', 'PM', '产品经理实习', 'Product Manager']
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
    .replace(/\b(intern(ship)?|summer|full[- ]?time)\b/ig, '')
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
  const rawCompany = normalizeSpace(company)
  const rawRole = normalizeSpace(role)
  const strippedRole = stripRoleDecorators(rawRole)
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
  const shortRole = roleAliases.find((item) => /^(BD|PM)$/i.test(item) || /商务拓展|产品运营|产品经理|市场|营销|战略|数据分析/.test(item)) || primaryRole
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
    rawCompany && rawRole ? `${rawCompany} ${rawRole} interview` : ''
  ], 6)

  const xiaohongshuQueries = uniqueStrings([
    `${primaryCompany} ${roleVariants[0] || primaryRole} 面经`,
    `${primaryCompany} ${shortRole} 面试`,
    `${primaryCompany} ${primaryRole} 复盘`,
    primaryType ? `${primaryCompany} ${primaryRole} ${primaryType}` : '',
    `${primaryCompany} ${primaryRole} 小红书`,
    rawCompany && rawRole ? `${rawCompany} ${rawRole} interview` : ''
  ], 6)

  return {
    companyAliases,
    roleAliases,
    typeAliases,
    primaryCompany,
    primaryRole,
    keywordsBySource: {
      Nowcoder: nowcoderQueries,
      Xiaohongshu: xiaohongshuQueries
    },
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

  if (source === 'Nowcoder' && /nowcoder\.com\/(discuss|discussion|feed\/main\/detail)/i.test(url)) {
    score += 6
  }

  if (source === 'Xiaohongshu' && /xiaohongshu\.com\/(explore|discovery\/item)/i.test(url)) {
    score += 6
  }

  if ((companyHits.length || roleHits.length) && (companyHits.some(containsChinese) || roleHits.some(containsChinese))) {
    score += 4
  }

  if (!companyHits.length && !roleHits.length) {
    rejectReasons.push('missing-company-or-role-signal')
  }

  if (!semanticHits.length && !roundHits.length) {
    rejectReasons.push('missing-interview-semantic')
  }

  if (!DETAIL_PAGE_TYPES.has(pageType)) {
    rejectReasons.push('not-detail-page')
  }

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
    isHighQuality
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

function buildStatus({ config, warnings = [], rawCandidateCount = 0, highQualityCount = 0, excluded = [] }) {
  const lowerWarnings = warnings.map((item) => normalizeKey(item))

  if (!config.enabled) return 'disabled'
  if (!config.hasNowcoderCookie || !config.hasXiaohongshuCookie) return 'cookie-missing'
  if (lowerWarnings.some((item) => item.includes('anti-bot') || item.includes('captcha') || item.includes('验证'))) return 'anti-bot'
  if (lowerWarnings.some((item) => item.includes('timeout'))) return 'timeout'
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
    case 'cookie-missing':
      return '至少有一个站点的 cookie 没读到，请重新复制浏览器里完整 Cookie 到环境变量。'
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
  return {
    enabled: process.env.ALLOW_LIVE_SCRAPE === 'true',
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    timeoutMs: toNumber(process.env.SCRAPE_TIMEOUT_MS, 15000),
    hasNowcoderCookie: Boolean(process.env.NOWCODER_COOKIE),
    hasXiaohongshuCookie: Boolean(process.env.XIAOHONGSHU_COOKIE)
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
      }
    }
    result.debug.nextStep = buildScrapeNextStep(result)
    return result
  }

  if (!config.hasNowcoderCookie) initialWarnings.push('Nowcoder cookie missing')
  if (!config.hasXiaohongshuCookie) initialWarnings.push('Xiaohongshu cookie missing')

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
      if (settled.value.diagnostics) sourceDiagnostics.push(settled.value.diagnostics)
      if (Array.isArray(settled.value.diagnostics?.warnings)) warnings.push(...settled.value.diagnostics.warnings)
    } else {
      const message = settled.reason?.message || 'unknown error'
      const source = settled.reason?.source || 'Scraper'
      console.warn(`[scrape] ${source} failed: ${message}`)
      warnings.push(`${source} scrape failed: ${message}`)
      if (settled.reason?.diagnostics) sourceDiagnostics.push(settled.reason.diagnostics)
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
    excluded
  })

  const result = {
    enabled: true,
    config,
    status,
    searchPlan,
    results: included,
    rawCandidateCount: ranked.length,
    filteredCount: included.length,
    warnings: uniqueStrings(warnings, 12),
    debug: {
      keywords: searchPlan.keywordsBySource,
      rawCandidateCount: ranked.length,
      filteredCount: included.length,
      excludedTop: summarizeExcluded(excluded),
      sourceDiagnostics,
      qualityThreshold: HIGH_QUALITY_SCORE
    }
  }

  result.debug.nextStep = buildScrapeNextStep(result)
  return result
}
