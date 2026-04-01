import { mockInterviewCorpus } from '../data/mockInterviews.js'
import { listFeedback } from '../utils/storage.js'
import { buildSearchPlan, buildSourceSearchUrl, isHighQualityEvidence } from './scrapeService.js'

function normalize(value = '') {
  return String(value).toLowerCase().trim()
}

function uniqueStrings(values = [], limit = Infinity) {
  const seen = new Set()
  const output = []

  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    const key = normalize(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
    if (output.length >= limit) break
  }

  return output
}

function canonicalType(value = '') {
  const normalized = normalize(value)
  if (/^hr|human/.test(normalized)) return 'hr'
  if (/professional|business|functional|专业|业务|职能/.test(normalized)) return 'professional'
  if (/one|1v1|single|单面/.test(normalized)) return 'oneOnOne'
  if (/group|群面|无领导/.test(normalized)) return 'group'
  if (/technical|tech|技术/.test(normalized)) return 'technical'
  if (/manager|final|主管|终面/.test(normalized)) return 'manager'
  return normalized
}

function aliasMatches(text = '', aliases = []) {
  const haystack = normalize(text)
  return aliases.filter((alias) => normalize(alias) && haystack.includes(normalize(alias)))
}

function localizeText(zh, en, language = 'zh') {
  return language === 'zh' ? zh : en
}

function buildSearchUrl(item, searchPlan) {
  const source = item.source || 'Nowcoder'
  const preferredQuery = item.referenceQuery
    || searchPlan.keywordsBySource?.[source]?.[0]
    || `${searchPlan.primaryCompany} ${searchPlan.primaryRole} 面经`

  return item.referenceSearchUrl || buildSourceSearchUrl(source, preferredQuery)
}

function scoreEvidence(item, searchPlan, interviewType) {
  const companyMatches = aliasMatches(`${item.company} ${item.titleZh} ${item.titleEn}`, searchPlan.companyAliases)
  const roleMatches = aliasMatches(`${item.role} ${item.titleZh} ${item.titleEn} ${item.questionZh} ${item.questionEn}`, searchPlan.roleAliases)
  const typeMatches = aliasMatches(`${item.interviewType} ${item.titleZh} ${item.questionZh} ${item.titleEn} ${item.questionEn}`, searchPlan.typeAliases)
  let score = 0

  if (companyMatches.length) score += 4
  if (roleMatches.length) score += 4
  if (canonicalType(item.interviewType) === canonicalType(interviewType)) score += 3
  if (typeMatches.length) score += 2
  if (item.referenceUrl) score += 3

  return score
}

function localizeItem(item, language = 'zh', searchPlan, interviewType) {
  const title = language === 'zh' ? item.titleZh : item.titleEn
  const question = language === 'zh' ? item.questionZh : item.questionEn
  const notes = language === 'zh' ? item.notesZh : item.notesEn
  const style = language === 'zh' ? item.styleZh : item.styleEn
  const matchedKeywords = uniqueStrings([
    ...aliasMatches(`${item.company} ${title} ${question}`, searchPlan.companyAliases),
    ...aliasMatches(`${item.role} ${title} ${question}`, searchPlan.roleAliases),
    ...aliasMatches(`${item.interviewType} ${title} ${question}`, searchPlan.typeAliases)
  ], 8)

  return {
    source: item.source,
    company: item.company,
    role: item.role,
    interviewType: canonicalType(item.interviewType),
    title,
    style,
    question,
    notes,
    snippet: notes,
    referenceUrl: item.referenceUrl || '',
    referenceSearchUrl: buildSearchUrl(item, searchPlan),
    isDirectSource: Boolean(item.referenceUrl),
    matchedKeywords,
    score: scoreEvidence(item, searchPlan, interviewType),
    pageType: item.referenceUrl ? 'detail' : 'unknown',
    whyMatched: localizeText(
      '这是与你的公司、岗位或面试类型高度相关的历史面经样本。',
      'This is a historical interview sample that aligns closely with the target company, role, or interview type.',
      language
    ),
    kind: item.referenceUrl ? 'direct' : 'search'
  }
}

function buildLiveEvidenceItem(item, { company, role, interviewType, language = 'zh' }, searchPlan) {
  return {
    source: item.source,
    company,
    role,
    interviewType: canonicalType(interviewType),
    title: item.title,
    style: localizeText('实时抓取', 'Live scrape', language),
    question: item.title,
    notes: item.whyMatched || item.snippet || localizeText('来自实时站内抓取。', 'Captured from a live site scrape.', language),
    snippet: item.snippet || '',
    referenceUrl: item.url || '',
    referenceSearchUrl: item.searchUrl || buildSourceSearchUrl(item.source, item.searchQuery || searchPlan.keywordsBySource?.[item.source]?.[0] || ''),
    isDirectSource: Boolean(item.url),
    matchedKeywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords : [],
    score: Number(item.score || 0),
    pageType: item.pageType || 'unknown',
    whyMatched: item.whyMatched || '',
    kind: 'direct'
  }
}

function buildLiveEvidence(liveScrape, params, searchPlan) {
  return (liveScrape?.results || [])
    .filter((item) => isHighQualityEvidence(item))
    .map((item) => buildLiveEvidenceItem(item, params, searchPlan))
}

export async function retrieveInterviewSignals({ company = '', role = '', interviewType = '', language = 'zh', liveScrape } = {}) {
  const searchPlan = buildSearchPlan({ company, role, interviewType })
  const liveEvidence = buildLiveEvidence(liveScrape, { company, role, interviewType, language }, searchPlan)

  const matches = mockInterviewCorpus
    .filter((item) => {
      const companyMatch = !normalize(company) || aliasMatches(`${item.company} ${item.titleZh} ${item.titleEn}`, searchPlan.companyAliases).length > 0
      const roleMatch = !normalize(role) || aliasMatches(`${item.role} ${item.titleZh} ${item.titleEn} ${item.questionZh} ${item.questionEn}`, searchPlan.roleAliases).length > 0
      const typeMatch = !canonicalType(interviewType)
        || canonicalType(item.interviewType) === canonicalType(interviewType)
        || aliasMatches(`${item.interviewType} ${item.titleZh} ${item.questionZh}`, searchPlan.typeAliases).length > 0

      return companyMatch && roleMatch && typeMatch
    })
    .sort((a, b) => scoreEvidence(b, searchPlan, interviewType) - scoreEvidence(a, searchPlan, interviewType))
    .map((item) => localizeItem(item, language, searchPlan, interviewType))

  const feedback = await listFeedback({ company, role, limit: 12 })
  const combined = [...liveEvidence, ...matches]
  const directLinkCount = combined.filter((item) => item.referenceUrl).length

  return {
    matches: combined.slice(0, 10),
    liveEvidence,
    feedback,
    meta: {
      companyMatchCount: matches.length,
      feedbackCount: feedback.length,
      directLinkCount,
      liveEvidenceCount: liveEvidence.length,
      preferredEvidenceCount: liveEvidence.length,
      searchKeywords: searchPlan.keywordsBySource
    }
  }
}
