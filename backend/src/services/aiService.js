import OpenAI from 'openai'
import { buildInterviewPrompt } from './promptBuilder.js'
import { parseResumeText } from './resumeService.js'

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const preferredModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

const EN_STOP = new Set(['and', 'with', 'for', 'the', 'your', 'from', 'that', 'this', 'into', 'about', 'role', 'job', 'work', 'team', 'teams', 'support', 'good', 'strong'])
const METRIC_PATTERN = /(\d|%|kpi|roi|ctr|cvr|gmv|dau|mau|arr|revenue|增长|提升|降低|节省|转化|留存|gmv|roi)/i
const OWNERSHIP_PATTERN = /(led|owned|drove|built|launched|managed|created|designed|implemented|analyzed|coordinated|executed|delivered|负责|主导|推动|搭建|制定|优化|分析|协调|执行|落地)/i
const BUSINESS_PATTERN = /(client|customer|merchant|market|campaign|analysis|data|stakeholder|sales|operations|business|crm|research|用户|客户|商户|市场|活动|分析|数据|业务|增长|运营|合作)/i

function isZh(language = 'zh') {
  return language === 'zh'
}

function txt(language = 'zh', zh, en) {
  return isZh(language) ? zh : en
}

function normalizeLine(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function uniqueStrings(values = [], limit = 8) {
  return [...new Set(values.map((value) => normalizeLine(value)).filter(Boolean))].slice(0, limit)
}

function splitSegments(text = '') {
  return String(text)
    .split(/\n|•|·|;|；|,|，|\. |。|\//)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function extractKeywordPhrases(text = '') {
  const segments = splitSegments(text)
  const candidates = []

  for (const segment of segments) {
    if (/^[\x00-\x7F]+$/.test(segment) && /[a-zA-Z]/.test(segment)) {
      const cleaned = segment.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
      const phrase = cleaned.split(/\s+/).filter((word) => word && !EN_STOP.has(word)).join(' ').trim()
      if (phrase.length >= 4 && phrase.length <= 48) candidates.push(phrase)
    } else if (segment.length >= 2 && segment.length <= 24) {
      candidates.push(segment)
    }
  }

  return uniqueStrings(candidates, 8)
}

function tokenSet(text = '') {
  const set = new Set()
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .forEach((token) => set.add(token))
  return set
}

function isQuantifiedLine(text = '') {
  return METRIC_PATTERN.test(text)
}

function isOwnershipLine(text = '') {
  return OWNERSHIP_PATTERN.test(text)
}

function isBusinessLine(text = '') {
  return BUSINESS_PATTERN.test(text)
}

function buildResumeEvidencePool(resumeProfile, rawResume = '') {
  const previewItems = (resumeProfile?.previewSections || []).flatMap((section) => section.items || [])
  return uniqueStrings([
    ...(resumeProfile?.recommendedHighlights || []),
    ...previewItems,
    ...(resumeProfile?.skills || []),
    ...splitSegments(rawResume).slice(0, 10)
  ], 20)
}

function bestResumeBullet(keyword, evidencePool = []) {
  if (!evidencePool.length) return ''

  const keywordTokens = tokenSet(keyword)
  let best = evidencePool[0]
  let bestScore = -1

  for (const item of evidencePool) {
    const lower = item.toLowerCase()
    const score = [...keywordTokens].filter((token) => lower.includes(token)).length
      + (lower.includes(keyword.toLowerCase()) ? 2 : 0)
      + (isQuantifiedLine(item) ? 1 : 0)
      + (isOwnershipLine(item) ? 1 : 0)

    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }

  return best
}

function buildKeywordMap(keywords = [], resumeProfile, resume = '') {
  const evidencePool = buildResumeEvidencePool(resumeProfile, resume)
  const resumeTokens = tokenSet(resume)
  const resumeLower = String(resume).toLowerCase()

  return keywords.map((keyword) => {
    const evidence = bestResumeBullet(keyword, evidencePool)
    const keywordTokens = tokenSet(keyword)
    const matched = [...keywordTokens].some((token) => resumeTokens.has(token) || evidence.toLowerCase().includes(token))
      || resumeLower.includes(keyword.toLowerCase())

    return {
      keyword,
      matched,
      evidence: matched ? evidence : ''
    }
  })
}

function evidenceRefs(evidence = [], keyword = '') {
  const lowerKeyword = keyword.toLowerCase()

  return evidence
    .filter((item) => {
      const haystack = `${item.title || ''} ${item.question || ''} ${item.notes || ''}`.toLowerCase()
      return haystack.includes(lowerKeyword)
    })
    .slice(0, 2)
    .map((item) => ({
      label: item.source,
      url: item.referenceUrl || item.referenceSearchUrl || ''
    }))
}

function scoreFitAdvanced(jd, resumeProfile, language = 'zh') {
  const resumeText = resumeProfile?.rawText || ''
  const highlights = resumeProfile?.recommendedHighlights || []
  const improvementSuggestions = resumeProfile?.improvementSuggestions || []
  const keywords = extractKeywordPhrases(jd)
  const keywordMap = buildKeywordMap(keywords, resumeProfile, resumeText)
  const matchedKeywords = keywordMap.filter((item) => item.matched).map((item) => item.keyword)
  const missingKeywords = keywordMap.filter((item) => !item.matched).map((item) => item.keyword)
  const quantifiedCount = highlights.filter(isQuantifiedLine).length
  const ownershipCount = highlights.filter(isOwnershipLine).length
  const businessCount = highlights.filter(isBusinessLine).length
  const keywordScore = keywords.length ? Math.max(36, Math.round((matchedKeywords.length / keywords.length) * 100)) : 60
  const impactScore = highlights.length ? Math.min(92, 42 + quantifiedCount * 16) : 42
  const ownershipScore = highlights.length ? Math.min(90, 42 + ownershipCount * 16) : 44
  const businessScore = highlights.length ? Math.min(88, 46 + businessCount * 12) : 48
  const storyScore = Math.max(38, Math.min(90, 48 + highlights.length * 9 - improvementSuggestions.length * 4))

  const dimensions = [
    {
      label: txt(language, '关键词覆盖', 'Keyword coverage'),
      score: keywordScore,
      reason: txt(
        language,
        `JD 中 ${keywords.length || 0} 个重点能力里，当前能直接对齐 ${matchedKeywords.length} 个。`,
        `You can currently map ${matchedKeywords.length} of the ${keywords.length || 0} core JD signals to resume proof.`
      ),
      evidence: keywordMap.filter((item) => item.matched).slice(0, 2).map((item) => `${item.keyword}: ${item.evidence}`)
    },
    {
      label: txt(language, '量化结果', 'Quantified impact'),
      score: impactScore,
      reason: txt(
        language,
        `筛出的高价值经历里，有 ${quantifiedCount} 条已经带结果或指标。`,
        `${quantifiedCount} of the strongest resume lines already include results or metrics.`
      ),
      evidence: highlights.filter(isQuantifiedLine).slice(0, 2)
    },
    {
      label: txt(language, '个人 owner 证明', 'Ownership proof'),
      score: ownershipScore,
      reason: txt(
        language,
        `有 ${ownershipCount} 条经历能较清楚证明你亲自推动过事情。`,
        `${ownershipCount} strong lines already show what you personally drove.`
      ),
      evidence: highlights.filter(isOwnershipLine).slice(0, 2)
    },
    {
      label: txt(language, '业务贴合', 'Business relevance'),
      score: businessScore,
      reason: txt(
        language,
        `当前最强经历里，有 ${businessCount} 条和业务分析、客户协同或增长执行直接相关。`,
        `${businessCount} of the strongest stories are directly tied to business analysis, stakeholder execution, or growth work.`
      ),
      evidence: highlights.filter(isBusinessLine).slice(0, 2)
    },
    {
      label: txt(language, '答题可迁移性', 'Interview readiness'),
      score: storyScore,
      reason: txt(
        language,
        `已经筛出 ${highlights.length} 条适合展开成 STAR 的经历，但仍有 ${improvementSuggestions.length} 条需要改写。`,
        `You already have ${highlights.length} lines that can become STAR stories, but ${improvementSuggestions.length} still need rewriting.`
      ),
      evidence: highlights.slice(0, 2)
    }
  ]

  const overallScore = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)

  const strengths = uniqueStrings([
    matchedKeywords.length ? txt(language, `已经能对上 ${matchedKeywords.slice(0, 3).join('、')} 这些 JD 关键词。`, `You already have proof for ${matchedKeywords.slice(0, 3).join(', ')}.`) : '',
    quantifiedCount ? txt(language, `已有 ${quantifiedCount} 条经历带结果或指标。`, `${quantifiedCount} resume lines already include metrics or outcomes.`) : '',
    ownershipCount ? txt(language, `已有 ${ownershipCount} 条经历能说明你不是旁观者而是执行者。`, `${ownershipCount} lines already show you as an owner, not a bystander.`) : ''
  ], 3)

  const gaps = uniqueStrings([
    missingKeywords.length ? txt(language, `还缺少 ${missingKeywords.slice(0, 3).join('、')} 的直接证据。`, `You still need direct proof for ${missingKeywords.slice(0, 3).join(', ')}.`) : '',
    improvementSuggestions.length ? txt(language, `有 ${improvementSuggestions.length} 条表述更像职责，需要改成成果式写法。`, `${improvementSuggestions.length} lines still read like responsibilities and should be rewritten as outcomes.`) : '',
    !quantifiedCount ? txt(language, '最强故事里还缺少足够明确的数字结果。', 'Your strongest stories still need clearer numbers and impact.') : ''
  ], 3)

  const nextActions = uniqueStrings([
    missingKeywords.length ? txt(language, `先把 ${missingKeywords.slice(0, 3).join('、')} 各配一条最强经历。`, `Map ${missingKeywords.slice(0, 3).join(', ')} to one concrete resume example each.`) : '',
    improvementSuggestions.length ? txt(language, '优先把待改写 bullet 改成“场景 + 动作 + 结果 + 指标”。', 'Rewrite the weak bullets into context + action + result + metric.') : '',
    txt(language, '把最强的 3 条经历各自准备成 60-90 秒可复述版本。', 'Prepare your 3 strongest stories into 60-90 second rehearsal versions.')
  ], 3)

  return {
    overallScore,
    summary: txt(
      language,
      `当前匹配度约 ${overallScore}/100，结论来自 JD 关键词映射、量化结果、owner 证明和可展开的高价值经历。`,
      `The current fit is about ${overallScore}/100, based on JD keyword mapping, quantified impact, ownership proof, and interview-ready stories.`
    ),
    matchedKeywords,
    missingKeywords,
    keywordMap,
    dimensions,
    strengths,
    gaps,
    nextActions
  }
}

function normalizeEvidence(input, retrieval) {
  const items = [
    ...(retrieval.matches || []).map((item) => ({
      source: item.source,
      title: item.title || item.question,
      question: item.question,
      style: item.style,
      notes: item.notes,
      referenceUrl: item.referenceUrl || '',
      referenceSearchUrl: item.referenceSearchUrl || '',
      isDirectSource: Boolean(item.referenceUrl),
      kind: item.referenceUrl ? 'direct' : 'search'
    })),
    ...((retrieval.liveScrape?.results || []).map((item) => ({
      source: item.source,
      title: item.title,
      question: item.title,
      style: txt(input.language, '实时抓取', 'Live scrape'),
      notes: txt(input.language, '来自站内搜索或帖子直链。', 'Returned from a live site scrape or post result.'),
      referenceUrl: item.url || '',
      referenceSearchUrl: item.url || '',
      isDirectSource: Boolean(item.url),
      kind: 'direct'
    })))
  ]

  const deduped = []
  const seen = new Set()

  for (const item of items) {
    const key = item.referenceUrl || `${item.source}-${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return {
    items: deduped.slice(0, 10),
    meta: {
      directCount: deduped.filter((item) => item.isDirectSource).length,
      searchFallbackCount: deduped.filter((item) => !item.isDirectSource && item.referenceSearchUrl).length,
      liveEnabled: Boolean(retrieval.liveScrape?.enabled),
      warnings: retrieval.liveScrape?.warnings || []
    }
  }
}

function trimSentence(text = '', limit = 160) {
  const normalized = normalizeLine(text)
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 1)}…`
}

function buildSampleAnswer({ keyword, resumeBullet, company, role, language = 'zh', matched = true }) {
  if (isZh(language)) {
    if (!matched) {
      return `虽然我的简历里还没有和「${keyword}」完全同名的经历，但我会用最接近的例子 ${resumeBullet || '来证明可迁移能力'}。回答时我会先讲任务场景，再讲我怎么拆解问题、协调资源和推进结果，最后补充如果放到 ${company} 的 ${role} 里，我会如何把这套方法迁移过去。`
    }

    return `我会围绕「${keyword}」讲最能证明自己的那条经历：${resumeBullet || '补一条最相关经历'}。回答结构会是“背景和目标 - 我具体做了什么 - 遇到什么阻力 - 最后结果如何”，重点强调我自己的判断、推进动作和业务结果，这样能直接对应 ${company} 的 ${role}。`
  }

  if (!matched) {
    return `I do not have a resume line with the exact phrase “${keyword},” so I would anchor on the closest transferable story: ${resumeBullet || 'the nearest relevant example'}. I would explain the context, the way I broke the problem down, how I drove stakeholders, and how that approach transfers into the ${role} role at ${company}.`
  }

  return `I would answer “${keyword}” by anchoring on the strongest relevant story: ${resumeBullet || 'add your closest example'}. I would use a context-goal-action-result structure and make sure the interviewer hears what I personally drove, what trade-offs I made, and what outcome I created for the business.`
}

function buildQuestionPlan(input, fit, evidence, resumeProfile) {
  const language = input.language || 'zh'
  const targets = (fit.keywordMap || []).slice(0, 5)
  const evidencePool = buildResumeEvidencePool(resumeProfile, input.resume)

  return targets.map((target) => {
    const resumeBullet = target.evidence || bestResumeBullet(target.keyword, evidencePool)
    const supportingEvidence = evidenceRefs(evidence, target.keyword)

    return {
      cluster: target.keyword,
      question: target.matched
        ? txt(language, `如果面试官围绕「${target.keyword}」深挖，你会拿哪段经历证明自己？`, `If the interviewer pushes on “${target.keyword},” which story would you use to prove yourself?`)
        : txt(language, `你的简历没有直接写「${target.keyword}」，你会如何证明自己具备可迁移能力？`, `Your resume does not state “${target.keyword}” directly. How would you prove transferable capability?`),
      whyAsked: target.matched
        ? txt(language, '这是 JD 里的直接能力信号，面试官会验证你是否真的做过。', 'This is a direct JD signal and the interviewer wants to know whether you have truly done it before.')
        : txt(language, '这是 JD 的关键要求，但你的简历还没有一条非常直接的证据，因此对方会测试迁移能力。', 'This is a key JD requirement, but your resume does not yet show a clean direct proof, so they will test transferability.'),
      answerStrategy: target.matched
        ? txt(language, '优先讲你最强的那段真实经历，并把动作、结果、协同对象讲清楚。', 'Lead with the strongest real story and make your action, outcome, and stakeholder work very explicit.')
        : txt(language, '先承认不是完全同名经历，再说明相似任务、你的方法论以及如何迁移到目标岗位。', 'Acknowledge that the experience is adjacent, then explain the similar task, your method, and how it transfers to the target role.'),
      sampleAnswer: buildSampleAnswer({
        keyword: target.keyword,
        resumeBullet,
        company: input.company,
        role: input.role,
        language,
        matched: target.matched
      }),
      supportingEvidence
    }
  })
}

function buildResumeRisks(input, resumeProfile) {
  const language = input.language || 'zh'
  const suggestions = resumeProfile?.improvementSuggestions || []

  return suggestions.slice(0, 4).map((item) => ({
    resumePoint: item.original,
    risk: txt(
      language,
      `这句会被继续追问，因为它目前的问题是：${item.issue}。`,
      `This line is likely to trigger follow-up because ${item.issue.toLowerCase()}.`
    ),
    fix: item.rewriteDirection
  }))
}

function buildRoundPlan(input, fit, resumeProfile) {
  const language = input.language || 'zh'
  const topStory = resumeProfile?.recommendedHighlights?.[0] || txt(language, '补一条你最强的实战经历', 'add your strongest practical story')

  return [
    {
      round: input.interviewType === 'hr' ? txt(language, 'HR 轮', 'HR round') : txt(language, '业务 / 专业轮', 'Business / functional round'),
      focus: input.interviewType === 'hr'
        ? txt(language, '重点说明动机、职业逻辑、稳定性以及为什么这份岗位和你契合。', 'Focus on motivation, career logic, stability, and why the role fits your path.')
        : txt(language, '重点说明业务判断、跨团队推进、量化结果和 owner 意识。', 'Focus on business judgment, cross-functional execution, quantified outcomes, and ownership.'),
      questions: [
        txt(language, `如果只能讲一段经历，你会用哪段来说明你适合 ${input.role}？`, `If you could only tell one story, which one best proves your fit for ${input.role}?`),
        txt(language, `针对这段经历 ${trimSentence(topStory, 48)}，最有可能被追问的细节是什么？`, `For the story ${trimSentence(topStory, 48)}, what details are most likely to be challenged?`),
        txt(language, `你如何把自己最强的经历翻译成 ${input.company} 关心的结果？`, `How do you translate your strongest experience into outcomes ${input.company} will care about?`)
      ]
    }
  ]
}

function buildCheatSheet(input, fit, resumeProfile) {
  const language = input.language || 'zh'
  const storyAnchors = uniqueStrings([
    ...(resumeProfile?.recommendedHighlights || []).slice(0, 3),
    ...((fit.keywordMap || []).filter((item) => item.matched).map((item) => `${item.keyword}: ${item.evidence}`))
  ], 4)

  return {
    selfIntro: txt(
      language,
      `60-90 秒自我介绍请按“我是谁 - 我最强的相关经历 - 我为什么适合 ${input.role} - 我为什么想去 ${input.company}”来讲。`,
      `Structure your 60-90 second intro as: who you are, your strongest relevant story, why you fit ${input.role}, and why ${input.company} is the right next step.`
    ),
    mustRemember: uniqueStrings([
      txt(language, '每个答案都尽量落到结果、指标和业务影响。', 'Push every answer toward an outcome, metric, and business impact.'),
      txt(language, '不要停留在“团队做了什么”，要明确你自己做了什么。', 'Do not stop at what the team did; clarify what you personally drove.'),
      fit.missingKeywords.length ? txt(language, `优先补上 ${fit.missingKeywords.slice(0, 2).join('、')} 的直接证据。`, `Prioritize direct proof for ${fit.missingKeywords.slice(0, 2).join(', ')}.`) : ''
    ], 4),
    storyAnchors,
    closingQuestions: uniqueStrings([
      txt(language, '这个岗位入职后 90 天最关键的交付是什么？', 'What are the most important deliverables in the first 90 days of this role?'),
      txt(language, '团队会用哪些指标判断这个岗位做得好？', 'Which metrics define strong performance for this role?')
    ], 3)
  }
}

function fallbackResponse(input, retrieval, resumeProfile = parseResumeText(input.resume, input.language)) {
  const language = input.language || 'zh'
  const fit = scoreFitAdvanced(input.jd, resumeProfile, language)
  const normalizedEvidence = normalizeEvidence(input, retrieval)

  return {
    meta: {
      company: input.company,
      role: input.role,
      interviewType: input.interviewType,
      language,
      generatedWith: 'fallback-strategy-engine'
    },
    fitReview: fit,
    evidence: {
      styleSummary: normalizedEvidence.items.length
        ? normalizedEvidence.items.map((item) => item.style).filter(Boolean).slice(0, 2).join(' / ')
        : txt(language, '暂无足够面经风格信号，先按结构化准备。', 'There is not enough style evidence yet, so use a structured prep baseline.'),
      items: normalizedEvidence.items,
      meta: normalizedEvidence.meta
    },
    answerDrafts: buildQuestionPlan(input, fit, normalizedEvidence.items, resumeProfile),
    resumeRisks: buildResumeRisks(input, resumeProfile),
    roundPlan: buildRoundPlan(input, fit, resumeProfile),
    cheatSheet: buildCheatSheet(input, fit, resumeProfile),
    resumeProfile
  }
}

function normalizeDimensions(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const items = value
    .map((item) => ({
      label: normalizeLine(item?.label || ''),
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
      reason: normalizeLine(item?.reason || ''),
      evidence: uniqueStrings(Array.isArray(item?.evidence) ? item.evidence : [], 3)
    }))
    .filter((item) => item.label && item.score !== null && item.reason)

  return items.length ? items : fallback
}

function normalizeKeywordMap(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const items = value
    .map((item) => ({
      keyword: normalizeLine(item?.keyword || ''),
      matched: Boolean(item?.matched),
      evidence: normalizeLine(item?.evidence || '')
    }))
    .filter((item) => item.keyword)

  return items.length ? items : fallback
}

function normalizeEvidenceItems(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const items = value
    .map((item) => ({
      source: normalizeLine(item?.source || ''),
      title: normalizeLine(item?.title || item?.question || ''),
      question: normalizeLine(item?.question || item?.title || ''),
      style: normalizeLine(item?.style || ''),
      notes: normalizeLine(item?.notes || ''),
      referenceUrl: normalizeLine(item?.referenceUrl || ''),
      referenceSearchUrl: normalizeLine(item?.referenceSearchUrl || ''),
      isDirectSource: Boolean(item?.isDirectSource || item?.referenceUrl),
      kind: item?.kind === 'direct' ? 'direct' : (item?.referenceUrl ? 'direct' : 'search')
    }))
    .filter((item) => item.source && item.title)

  return items.length ? items : fallback
}

function normalizePack(candidate, fallback) {
  return {
    meta: {
      ...fallback.meta,
      ...(candidate?.meta || {})
    },
    fitReview: {
      ...fallback.fitReview,
      ...(candidate?.fitReview || {}),
      matchedKeywords: uniqueStrings(candidate?.fitReview?.matchedKeywords || fallback.fitReview.matchedKeywords, 8),
      missingKeywords: uniqueStrings(candidate?.fitReview?.missingKeywords || fallback.fitReview.missingKeywords, 8),
      keywordMap: normalizeKeywordMap(candidate?.fitReview?.keywordMap, fallback.fitReview.keywordMap),
      dimensions: normalizeDimensions(candidate?.fitReview?.dimensions, fallback.fitReview.dimensions),
      strengths: uniqueStrings(candidate?.fitReview?.strengths || fallback.fitReview.strengths, 4),
      gaps: uniqueStrings(candidate?.fitReview?.gaps || fallback.fitReview.gaps, 4),
      nextActions: uniqueStrings(candidate?.fitReview?.nextActions || fallback.fitReview.nextActions, 4)
    },
    evidence: {
      ...fallback.evidence,
      ...(candidate?.evidence || {}),
      items: normalizeEvidenceItems(candidate?.evidence?.items, fallback.evidence.items),
      meta: {
        ...fallback.evidence.meta,
        ...(candidate?.evidence?.meta || {})
      }
    },
    answerDrafts: Array.isArray(candidate?.answerDrafts) && candidate.answerDrafts.length
      ? candidate.answerDrafts.map((item) => ({
        cluster: normalizeLine(item?.cluster || ''),
        question: normalizeLine(item?.question || ''),
        whyAsked: normalizeLine(item?.whyAsked || ''),
        answerStrategy: normalizeLine(item?.answerStrategy || ''),
        sampleAnswer: normalizeLine(item?.sampleAnswer || ''),
        supportingEvidence: Array.isArray(item?.supportingEvidence) ? item.supportingEvidence : []
      })).filter((item) => item.cluster && item.question)
      : fallback.answerDrafts,
    resumeRisks: Array.isArray(candidate?.resumeRisks) && candidate.resumeRisks.length
      ? candidate.resumeRisks.map((item) => ({
        resumePoint: normalizeLine(item?.resumePoint || ''),
        risk: normalizeLine(item?.risk || ''),
        fix: normalizeLine(item?.fix || '')
      })).filter((item) => item.resumePoint && item.risk && item.fix)
      : fallback.resumeRisks,
    roundPlan: Array.isArray(candidate?.roundPlan) && candidate.roundPlan.length
      ? candidate.roundPlan.map((item) => ({
        round: normalizeLine(item?.round || ''),
        focus: normalizeLine(item?.focus || ''),
        questions: uniqueStrings(item?.questions || [], 4)
      })).filter((item) => item.round && item.focus)
      : fallback.roundPlan,
    cheatSheet: {
      ...fallback.cheatSheet,
      ...(candidate?.cheatSheet || {}),
      mustRemember: uniqueStrings(candidate?.cheatSheet?.mustRemember || fallback.cheatSheet.mustRemember, 4),
      storyAnchors: uniqueStrings(candidate?.cheatSheet?.storyAnchors || fallback.cheatSheet.storyAnchors, 4),
      closingQuestions: uniqueStrings(candidate?.cheatSheet?.closingQuestions || fallback.cheatSheet.closingQuestions, 3)
    },
    resumeProfile: fallback.resumeProfile
  }
}

export async function generateInterviewPack(input, retrieval, resumeProfile = parseResumeText(input.resume, input.language)) {
  const fallback = fallbackResponse(input, retrieval, resumeProfile)

  if (!client) {
    return fallback
  }

  try {
    const prompt = buildInterviewPrompt(input, retrieval, resumeProfile)
    const response = await client.responses.create({
      model: preferredModel,
      input: prompt,
      text: { format: { type: 'json_object' } }
    })

    const content = response.output_text || '{}'
    const parsed = JSON.parse(content)
    return normalizePack(parsed, fallback)
  } catch {
    return fallback
  }
}
