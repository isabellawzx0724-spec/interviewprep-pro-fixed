import mammoth from 'mammoth'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const resumeProvider = String(
  process.env.RESUME_AI_PROVIDER
  || process.env.AI_PROVIDER
  || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai')
).toLowerCase()
const openaiAnalysisModel = process.env.RESUME_ANALYSIS_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const anthropicAnalysisModel = process.env.RESUME_ANALYSIS_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest'

const SKILL_BANK = [
  'sql', 'python', 'r', 'tableau', 'excel', 'spss', 'power bi', 'looker', 'pandas', 'spark',
  'stakeholder management', 'cross-team coordination', 'project management', 'market research',
  'merchant coordination', 'offline inspection', 'analysis', 'communication', 'ownership',
  'client management', 'business development', 'data analysis', 'risk control', 'due diligence',
  'anti-fraud', 'reporting', 'crm', 'a/b testing', 'attribution', 'consumer insights'
]

const SECTION_MATCHERS = [
  ['education', /^(education|educational background|education background|学历|教育背景)$/i],
  ['experience', /^(experience|work experience|professional experience|employment|internships?|实习经历|工作经历|经历)$/i],
  ['project', /^(projects?|project experience|项目经历)$/i],
  ['leadership', /^(leadership|activities|extracurricular|campus|校园经历|社团经历)$/i],
  ['skills', /^(skills?|technical skills|toolkit|技能|技能证书|工具)$/i]
]

const METRIC_PATTERN = /(\d|%|kpi|roi|ctr|cvr|gmv|dau|mau|arr|revenue|增长|提升|降低|节省|转化|留存|成交|金额|客户数|人次)/i
const ACTION_PATTERN = /(led|owned|drove|built|launched|managed|created|designed|implemented|analyzed|coordinated|executed|delivered|improved|optimized|supported|负责|主导|推动|搭建|制定|优化|分析|协调|执行|落地|复盘|推进|谈判|完成)/i
const RESULT_PATTERN = /(increase|improve|grow|reduce|save|deliver|achieve|expand|win|launched|optimized|提升|增长|优化|实现|降低|达成|推动|促成|落地|完成|沉淀)/i
const BUSINESS_PATTERN = /(client|customer|merchant|market|campaign|analysis|data|stakeholder|sales|operations|business|crm|research|用户|客户|商户|市场|活动|分析|数据|业务|增长|运营|合作|产品)/i
const EDUCATION_PATTERN = /(university|college|school|bachelor|master|degree|major|minor|gpa|education|学院|大学|学校|硕士|本科|专业|绩点)/i
const COURSEWORK_PATTERN = /(coursework|relevant coursework|major coursework|课程|核心课程)/i
const SKILL_LINE_PATTERN = /(skills?|technical skills|proficient|familiar|tools?|技术栈|熟悉|擅长|技能)/i
const CONTACT_PATTERN = /(@|linkedin|github|portfolio|wechat|phone|tel|邮箱|电话|手机号|邮箱地址)/i
const LANGUAGE_LINE_PATTERN = /(languages?|language proficiency|language skills|english|mandarin|cantonese|toefl|ielts|gre|gmat|语言能力|英文|英语|普通话)/i
const DATE_LOCATION_PATTERN = /(\b(19|20)\d{2}\b|present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|至今|年|月|singapore|china|beijing|shanghai|guangzhou|shenzhen|hong kong|zhuhai)/i
const LIGHT_ACTION_PATTERN = /(supported|assisted|helped|参与|协助|配合)/i
const ENTITY_PATTERN = /(inc\.?|ltd\.?|corporation|company|group|bank|school|university|大学|学院|公司|集团|银行|商学院)/i

function txt(language = 'zh', zh, en) {
  return language === 'zh' ? zh : en
}

function hasChinese(text = '') {
  return /[\u4e00-\u9fff]/.test(text)
}

function normalizeLine(line = '') {
  return String(line)
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[•▪◦●]/g, '•')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitRawLines(text = '') {
  return String(text)
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(normalizeLine)
    .filter(Boolean)
}

function detectSectionType(line = '') {
  return SECTION_MATCHERS.find(([, pattern]) => pattern.test(line))?.[0] || ''
}

function sectionLabel(type, language = 'zh') {
  const map = {
    general: txt(language, '简历概览', 'Resume overview'),
    education: txt(language, '教育背景', 'Education'),
    experience: txt(language, '经历', 'Experience'),
    project: txt(language, '项目', 'Projects'),
    leadership: txt(language, '校园 / 领导力', 'Leadership'),
    skills: txt(language, '技能', 'Skills')
  }

  return map[type] || map.general
}

function isBulletLike(line = '') {
  return /^[-*•]\s*/.test(line)
}

function shouldMerge(previous = '', current = '') {
  if (!previous || !current) return false
  if (detectSectionType(current) || isBulletLike(current)) return false
  if (/[:,;/-]$/.test(previous) && current.length < 90) return true
  if (/^[a-z(]/.test(current) && previous.length < 140) return true
  if (/^[\u4e00-\u9fff]/.test(current) && previous.length < 24 && !/[。！？.!?]$/.test(previous)) return true
  return false
}

function buildLogicalLines(text = '') {
  const logical = []

  for (const raw of splitRawLines(text)) {
    const cleaned = raw.replace(/^[-*•]\s*/, '').trim()
    if (!cleaned) continue

    if (!logical.length) {
      logical.push(cleaned)
      continue
    }

    const previous = logical[logical.length - 1]
    if (shouldMerge(previous, cleaned)) {
      logical[logical.length - 1] = `${previous} ${cleaned}`.replace(/\s+/g, ' ').trim()
      continue
    }

    logical.push(cleaned)
  }

  return logical
}

function buildSections(text = '', language = 'zh') {
  const sections = []
  let current = { type: 'general', title: sectionLabel('general', language), items: [] }
  sections.push(current)

  for (const line of buildLogicalLines(text)) {
    const type = detectSectionType(line)
    if (type) {
      current = { type, title: sectionLabel(type, language), items: [] }
      sections.push(current)
      continue
    }

    current.items.push(line)
  }

  return sections.filter((section) => section.items.length)
}

function isContactLine(line = '') {
  return CONTACT_PATTERN.test(line) || /\+?\d[\d\s\-()]{7,}/.test(line)
}

function isEducationLine(line = '', sectionType = 'general') {
  return sectionType === 'education' || EDUCATION_PATTERN.test(line)
}

function isCourseworkLine(line = '') {
  return COURSEWORK_PATTERN.test(line)
}

function isSkillLine(line = '', sectionType = 'general') {
  return sectionType === 'skills' || SKILL_LINE_PATTERN.test(line)
}

function isLanguageLine(line = '') {
  return LANGUAGE_LINE_PATTERN.test(line) && line.length < 120 && !ACTION_PATTERN.test(line)
}

function isEntityHeadingLine(line = '', sectionType = 'general') {
  if (sectionType === 'education') return true
  if (ACTION_PATTERN.test(line) || RESULT_PATTERN.test(line)) return false
  if (line.length > 80) return false
  if (DATE_LOCATION_PATTERN.test(line)) return true
  return ENTITY_PATTERN.test(line) && !METRIC_PATTERN.test(line)
}

function isDateOrLocationLine(line = '') {
  return DATE_LOCATION_PATTERN.test(line) && line.length < 64 && !ACTION_PATTERN.test(line) && !RESULT_PATTERN.test(line)
}

function isLowValueMetaLine(line = '', sectionType = 'general') {
  return isContactLine(line)
    || isEducationLine(line, sectionType)
    || isCourseworkLine(line)
    || isSkillLine(line, sectionType)
    || isLanguageLine(line)
    || isEntityHeadingLine(line, sectionType)
    || isDateOrLocationLine(line)
}

function uniqueStrings(values = [], limit = 8) {
  return [...new Set(
    values
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )].slice(0, limit)
}

function truncateText(text = '', limit = 220) {
  const normalized = normalizeLine(text)
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 1)}…`
}

function extractSkills(text = '', sections = []) {
  const lower = text.toLowerCase()
  const directHits = SKILL_BANK.filter((skill) => lower.includes(skill))
  const inlineHits = []

  for (const section of sections) {
    if (section.type !== 'skills' && !section.items.some((item) => SKILL_LINE_PATTERN.test(item))) continue

    for (const item of section.items) {
      const parts = item
        .split(/[,，/|、:：]+/)
        .map((part) => normalizeLine(part))
        .filter((part) => part && part.length <= 32 && !ACTION_PATTERN.test(part))

      inlineHits.push(...parts)
    }
  }

  return uniqueStrings([...directHits, ...inlineHits], 14)
}

function scoreStoryLine(line = '', sectionType = 'general') {
  if (isLowValueMetaLine(line, sectionType)) return -100

  let score = 0
  if (sectionType === 'experience') score += 18
  if (sectionType === 'project') score += 16
  if (sectionType === 'leadership') score += 12
  if (sectionType === 'general') score += 6
  if (METRIC_PATTERN.test(line)) score += 14
  if (ACTION_PATTERN.test(line)) score += 10
  if (RESULT_PATTERN.test(line)) score += 8
  if (BUSINESS_PATTERN.test(line)) score += 5
  if (line.length >= 34) score += 3
  if (LIGHT_ACTION_PATTERN.test(line) && !METRIC_PATTERN.test(line)) score -= 4

  return score
}

function collectStoryCandidates(sections = []) {
  const candidates = []

  for (const section of sections) {
    for (const item of section.items) {
      if (item.length < 18) continue

      const score = scoreStoryLine(item, section.type)
      if (score < 10) continue

      candidates.push({
        text: item,
        sectionType: section.type,
        score,
        quantified: METRIC_PATTERN.test(item),
        ownership: ACTION_PATTERN.test(item)
      })
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

function buildRewriteDirection(language = 'zh', flags = {}) {
  const priorities = []
  if (flags.missingContext) priorities.push(txt(language, '先补场景和目标', 'add the context and goal first'))
  if (flags.missingOwnership) priorities.push(txt(language, '说清你亲自推进了什么', 'clarify what you personally drove'))
  if (flags.missingOutcome) priorities.push(txt(language, '把职责改成结果表达', 'turn responsibility wording into an outcome'))
  if (flags.missingMetric) priorities.push(txt(language, '补上可量化结果或范围', 'add a measurable result or scale'))

  return txt(
    language,
    `建议改成“场景 / 目标 + 你的动作 + 结果”，优先 ${priorities.join('，')}。如果暂时没有精确数字，也至少补范围、对象或影响。`,
    `Rewrite it into “context / goal + your action + outcome,” and prioritize ${priorities.join(', ')}. If exact metrics are unavailable, add scale, scope, or business impact.`
  )
}

function buildKeepReason(line = '', language = 'zh') {
  const hasMetric = METRIC_PATTERN.test(line)
  const hasAction = ACTION_PATTERN.test(line)
  const hasResult = RESULT_PATTERN.test(line)

  if (hasMetric && hasAction && hasResult) {
    return txt(language, '动作、结果和量化都比较完整，已经是较强 bullet。', 'The action, outcome, and quantified impact are already strong.')
  }

  if (hasAction && (hasResult || hasMetric)) {
    return txt(language, '主语和结果基本清楚，只需要视岗位再做轻微对齐。', 'The ownership and outcome are already clear, so only light tuning may be needed.')
  }

  return txt(language, '这条信息对面试可用，建议保留原事实表达。', 'This is interview-usable as is and should largely be kept.')
}

function classifyLine(line = '', sectionType = 'general', language = 'zh') {
  if (line.length < 20 || isLowValueMetaLine(line, sectionType)) return null

  const hasMetric = METRIC_PATTERN.test(line)
  const hasAction = ACTION_PATTERN.test(line)
  const hasResult = RESULT_PATTERN.test(line)
  const weakSupportWord = LIGHT_ACTION_PATTERN.test(line)
  const missingContext = line.length < 30
  const missingOwnership = !hasAction || weakSupportWord
  const missingOutcome = !hasResult && !hasMetric
  const missingMetric = !hasMetric && (hasAction || hasResult)
  const strongLine = hasAction && (hasResult || hasMetric) && !weakSupportWord

  if (strongLine) {
    return {
      tier: 'keep',
      severity: 0,
      original: line,
      issue: txt(language, '结构已较强', 'Already strong'),
      reason: buildKeepReason(line, language),
      rewriteDirection: txt(language, '建议保留，最多只做岗位词汇微调。', 'Keep it as is, with only minor wording alignment if needed.'),
      verdict: txt(language, '可保留', 'Keep')
    }
  }

  const issueParts = []
  if (missingContext) issueParts.push(txt(language, '场景不够清楚', 'Context is too thin'))
  if (missingOwnership) issueParts.push(txt(language, '个人动作不够清楚', 'Personal ownership is not clear'))
  if (missingOutcome) issueParts.push(txt(language, '结果表达不够清楚', 'Outcome is not clear'))
  if (missingMetric && !missingOutcome) issueParts.push(txt(language, '可以补量化结果', 'Could add measurable impact'))

  if (!issueParts.length) {
    return {
      tier: 'keep',
      severity: 0,
      original: line,
      issue: txt(language, '基本可用', 'Usable as is'),
      reason: buildKeepReason(line, language),
      rewriteDirection: txt(language, '建议保留原句，只在投递特定岗位时再轻微对齐关键词。', 'Keep the line and only lightly tune keywords for a specific role.'),
      verdict: txt(language, '可保留', 'Keep')
    }
  }

  const severity = issueParts.length + (missingContext ? 1 : 0) + (missingOwnership ? 1 : 0) + (missingOutcome ? 1 : 0)
  const tier = (missingOwnership && missingOutcome) || (missingContext && missingOutcome) ? 'priority' : 'polish'

  return {
    tier,
    severity,
    original: line,
    issue: issueParts.join(txt(language, '；', '; ')),
    reason: txt(
      language,
      tier === 'priority'
        ? '这条经历的追问价值很高，但当前写法还不足以支撑面试深挖。'
        : '这条经历本身有价值，只是表达上还可以更完整。',
      tier === 'priority'
        ? 'This line has strong interview potential, but the current wording is not ready for deep follow-up.'
        : 'This line is valuable, but the wording could be more complete.'
    ),
    rewriteDirection: buildRewriteDirection(language, { missingContext, missingOwnership, missingOutcome, missingMetric }),
    verdict: tier === 'priority' ? txt(language, '优先改写', 'Priority rewrite') : txt(language, '仅微调', 'Polish')
  }
}

function dedupeByOriginal(items = [], limit = 4) {
  const output = []
  const seen = new Set()

  for (const item of items) {
    if (!item?.original || seen.has(item.original)) continue
    seen.add(item.original)
    output.push(item)
    if (output.length >= limit) break
  }

  return output
}

function buildCoachBuckets(sections = [], language = 'zh') {
  const priority = []
  const polish = []
  const keep = []

  for (const section of sections) {
    if (!['experience', 'project', 'leadership', 'general'].includes(section.type)) continue

    for (const line of section.items) {
      const assessment = classifyLine(line, section.type, language)
      if (!assessment) continue

      if (assessment.tier === 'priority') priority.push(assessment)
      if (assessment.tier === 'polish') polish.push(assessment)
      if (assessment.tier === 'keep') keep.push(assessment)
    }
  }

  return {
    priority: dedupeByOriginal(priority.sort((a, b) => b.severity - a.severity || b.original.length - a.original.length), 5),
    polish: dedupeByOriginal(polish.sort((a, b) => b.severity - a.severity || b.original.length - a.original.length), 4),
    keep: dedupeByOriginal(keep.sort((a, b) => b.original.length - a.original.length), 4)
  }
}

function derivePreviewSections(sections = [], language = 'zh') {
  const priority = ['experience', 'project', 'education', 'skills', 'leadership', 'general']

  return sections
    .sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))
    .slice(0, 4)
    .map((section) => ({
      title: section.title || sectionLabel(section.type, language),
      items: section.items.slice(0, section.type === 'skills' ? 4 : 3)
    }))
}

function storyFitLabel(sectionType = 'general', language = 'zh') {
  if (sectionType === 'experience') return txt(language, '适合回答：项目推进、跨团队协作、结果复盘', 'Best for: execution, cross-functional work, and impact questions')
  if (sectionType === 'project') return txt(language, '适合回答：项目拆解、分析方法、问题解决', 'Best for: project breakdown, analysis method, and problem solving')
  if (sectionType === 'leadership') return txt(language, '适合回答：沟通协调、影响力、冲突处理', 'Best for: communication, influence, and conflict handling')
  return txt(language, '适合回答：自我介绍、亮点概览、转行动机', 'Best for: self-intro, highlights, and motivation')
}

function buildStoryGap(candidate, language = 'zh') {
  if (!candidate.quantified && !candidate.ownership) {
    return txt(language, '需要补：你亲自做了什么，以及结果怎么衡量。', 'Need to add: what you personally drove and how the outcome was measured.')
  }
  if (!candidate.quantified) {
    return txt(language, '需要补：结果数字、影响范围或业务变化。', 'Need to add: a metric, scope, or business impact.')
  }
  if (!candidate.ownership) {
    return txt(language, '需要补：你在团队里具体负责的动作和判断。', 'Need to add: your specific ownership and decisions.')
  }
  return txt(language, '需要准备：关键取舍、阻力点、为什么这么做。', 'Be ready to explain the trade-offs, blockers, and why you made those choices.')
}

function buildStoryFollowUp(candidate, language = 'zh') {
  return candidate.quantified && candidate.ownership
    ? txt(language, '高概率被追问：你怎么定义目标、怎么推进资源、结果为什么成立。', 'Likely follow-up: how you set the goal, aligned stakeholders, and proved the result.')
    : txt(language, '高概率被追问：你的具体职责、执行过程、最后结果。', 'Likely follow-up: your exact ownership, process, and final outcome.')
}

function buildStoryBank(storyCandidates = [], language = 'zh') {
  return storyCandidates.slice(0, 4).map((item) => ({
    title: item.text.length > 42 ? `${item.text.slice(0, 41)}…` : item.text,
    anchor: item.text,
    goodFor: storyFitLabel(item.sectionType, language),
    likelyFollowUp: buildStoryFollowUp(item, language),
    detailGap: buildStoryGap(item, language)
  }))
}

function buildFallbackProfile(text = '', language = 'zh', meta = {}) {
  const sections = buildSections(text, language)
  const storyCandidates = collectStoryCandidates(sections)
  const recommendedHighlights = uniqueStrings(storyCandidates.map((item) => item.text), 5)
  const coaching = buildCoachBuckets(sections, language)
  const storyBank = buildStoryBank(storyCandidates, language)
  const skills = extractSkills(text, sections)

  return {
    rawText: text,
    detectedLanguage: meta.detectedLanguage || (hasChinese(text) ? 'zh' : 'en'),
    fileName: meta.fileName || '',
    skills,
    achievementLines: recommendedHighlights,
    riskLines: uniqueStrings(coaching.priority.map((item) => item.original), 5),
    recommendedHighlights,
    improvementSuggestions: coaching.priority,
    polishSuggestions: coaching.polish,
    keepSuggestions: coaching.keep,
    storyBank,
    interviewSignals: storyBank.map((item) => item.title).slice(0, 3),
    previewSections: derivePreviewSections(sections, language),
    stats: {
      sectionCount: sections.length,
      skillCount: skills.length,
      highlightCount: recommendedHighlights.length,
      rewriteCount: coaching.priority.length,
      polishCount: coaching.polish.length,
      keepCount: coaching.keep.length
    },
    summary: txt(
      language,
      `识别出 ${sections.length} 个简历版块，筛出 ${recommendedHighlights.length} 条适合直接答题的经历，${coaching.priority.length} 条真正需要优先改写的 bullet，以及 ${skills.length} 个技能信号。`,
      `Detected ${sections.length} resume sections, found ${recommendedHighlights.length} interview-ready stories, ${coaching.priority.length} true priority rewrite bullets, and ${skills.length} skill signals.`
    )
  }
}

function sanitizeSections(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const sections = value
    .map((section) => ({
      title: normalizeLine(section?.title || ''),
      items: uniqueStrings(Array.isArray(section?.items) ? section.items : [], 4)
    }))
    .filter((section) => section.title && section.items.length)

  return sections.length ? sections.slice(0, 4) : fallback
}

function sanitizeImprovements(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const items = value
    .map((item) => ({
      original: normalizeLine(item?.original || ''),
      issue: normalizeLine(item?.issue || ''),
      reason: normalizeLine(item?.reason || item?.issue || ''),
      rewriteDirection: normalizeLine(item?.rewriteDirection || ''),
      verdict: normalizeLine(item?.verdict || ''),
      severity: Number(item?.severity || 0)
    }))
    .filter((item) => item.original && item.issue && item.rewriteDirection)
    .filter((item) => !isLowValueMetaLine(item.original))

  return items.length ? items.slice(0, 5) : fallback
}

function sanitizeKeepSuggestions(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const items = value
    .map((item) => ({
      original: normalizeLine(item?.original || ''),
      reason: normalizeLine(item?.reason || ''),
      verdict: normalizeLine(item?.verdict || '') || 'Keep'
    }))
    .filter((item) => item.original && item.reason)

  return items.length ? items.slice(0, 4) : fallback
}

function sanitizeStoryBank(value, fallback = []) {
  if (!Array.isArray(value)) return fallback

  const items = value
    .map((item) => ({
      title: normalizeLine(item?.title || ''),
      anchor: normalizeLine(item?.anchor || item?.title || ''),
      goodFor: normalizeLine(item?.goodFor || ''),
      likelyFollowUp: normalizeLine(item?.likelyFollowUp || ''),
      detailGap: normalizeLine(item?.detailGap || '')
    }))
    .filter((item) => item.title && item.anchor)

  return items.length ? items.slice(0, 4) : fallback
}

function normalizeProfileShape(candidate, fallback, text, meta = {}) {
  const skills = uniqueStrings(candidate?.skills || fallback.skills, 14)
  const recommendedHighlights = uniqueStrings(candidate?.recommendedHighlights || fallback.recommendedHighlights, 5)
  const improvementSuggestions = sanitizeImprovements(candidate?.improvementSuggestions, fallback.improvementSuggestions)
  const polishSuggestions = sanitizeImprovements(candidate?.polishSuggestions, fallback.polishSuggestions)
  const keepSuggestions = sanitizeKeepSuggestions(candidate?.keepSuggestions, fallback.keepSuggestions)
  const storyBank = sanitizeStoryBank(candidate?.storyBank, fallback.storyBank)

  return {
    ...fallback,
    rawText: text,
    detectedLanguage: meta.detectedLanguage || fallback.detectedLanguage,
    fileName: meta.fileName || fallback.fileName || '',
    summary: normalizeLine(candidate?.summary || '') || fallback.summary,
    skills,
    recommendedHighlights,
    achievementLines: recommendedHighlights,
    riskLines: uniqueStrings(candidate?.riskLines || improvementSuggestions.map((item) => item.original) || fallback.riskLines, 5),
    improvementSuggestions,
    polishSuggestions,
    keepSuggestions,
    storyBank,
    interviewSignals: uniqueStrings(candidate?.interviewSignals || storyBank.map((item) => item.title) || fallback.interviewSignals, 3),
    previewSections: sanitizeSections(candidate?.previewSections, fallback.previewSections),
    stats: {
      ...fallback.stats,
      skillCount: skills.length,
      highlightCount: recommendedHighlights.length,
      rewriteCount: improvementSuggestions.length,
      polishCount: polishSuggestions.length,
      keepCount: keepSuggestions.length
    }
  }
}

async function analyzeResumeWithAI(text = '', language = 'zh') {
  if (!text.trim()) return null

  const prompt = `
You are a professional big-tech HR coach with deep resume rewriting expertise.
Return JSON only.
Target language: ${language === 'zh' ? 'Chinese' : 'English'}.

Analyze the resume below for interview preparation.
Critical rules:
- Be conservative. If a bullet already has clear STAR structure, mark it as keep.
- Rewrite suggestions must follow STAR logic: Situation/Task + Action + Result.
- Do NOT put school names, degrees, GPA, language abilities, locations, contact lines, or coursework into high-priority rewrites.
- High-priority rewrites should only target experience/project/leadership/achievement bullets with weak STAR expression.
- Avoid generic fluff. Give practical rewrite direction the user can apply directly.
- Keep output concise and product-ready.

Resume text:
${text.slice(0, 14000)}

Required JSON shape:
{
  "summary": string,
  "skills": string[],
  "recommendedHighlights": string[],
  "riskLines": string[],
  "improvementSuggestions": [
    {"original": string, "issue": string, "reason": string, "rewriteDirection": string, "verdict": string}
  ],
  "polishSuggestions": [
    {"original": string, "issue": string, "reason": string, "rewriteDirection": string, "verdict": string}
  ],
  "keepSuggestions": [
    {"original": string, "reason": string, "verdict": string}
  ],
  "storyBank": [
    {"title": string, "anchor": string, "goodFor": string, "likelyFollowUp": string, "detailGap": string}
  ],
  "interviewSignals": string[],
  "previewSections": [
    {"title": string, "items": string[]}
  ]
}
`
  if (resumeProvider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: anthropicAnalysisModel,
        max_tokens: 2200,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Resume AI (Anthropic) failed: ${truncateText(text, 180)}`)
    }

    const payload = await response.json()
    const content = Array.isArray(payload?.content)
      ? payload.content.map((item) => item?.text || '').join('\n').trim()
      : '{}'
    return JSON.parse(content || '{}')
  }

  if (!openaiClient) return null

  const response = await openaiClient.responses.create({
    model: openaiAnalysisModel,
    input: prompt,
    text: { format: { type: 'json_object' } }
  })

  return JSON.parse(response.output_text || '{}')
}

export function parseResumeText(text, language = 'zh') {
  return buildFallbackProfile(text, language)
}

export async function analyzeResumeText(text, language = 'zh', meta = {}) {
  const fallback = buildFallbackProfile(text, language, meta)

  try {
    const aiProfile = await analyzeResumeWithAI(text, language)
    if (!aiProfile) return fallback
    return normalizeProfileShape(aiProfile, fallback, text, meta)
  } catch {
    return fallback
  }
}

export async function parseResumeFile(file, language = 'zh') {
  if (!file) throw new Error(language === 'zh' ? '未收到简历文件。' : 'No resume file was received.')

  const mimetype = file.mimetype || ''
  const original = file.originalname || ''
  let text = ''

  if (mimetype.includes('pdf') || original.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdfParse(file.buffer)
    text = parsed.text || ''
  } else if (mimetype.includes('word') || original.toLowerCase().endsWith('.docx')) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer })
    text = parsed.value || ''
  } else {
    text = file.buffer.toString('utf-8')
  }

  const detectedLanguage = hasChinese(text) ? 'zh' : 'en'
  return analyzeResumeText(text, language, {
    fileName: original,
    detectedLanguage
  })
}
