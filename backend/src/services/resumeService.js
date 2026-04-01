import mammoth from 'mammoth'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'

const aiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const analysisModel = process.env.RESUME_ANALYSIS_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'

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

const METRIC_PATTERN = /(\d|%|kpi|roi|ctr|cvr|gmv|dau|mau|arr|revenue|增长|提升|降低|节省|转化|留存|gmv|roi)/i
const ACTION_PATTERN = /(led|owned|drove|built|launched|managed|created|designed|implemented|analyzed|coordinated|executed|delivered|improved|optimized|supported|负责|主导|推动|搭建|制定|优化|分析|协调|执行|落地|复盘)/i
const RESULT_PATTERN = /(increase|improve|grow|reduce|save|deliver|achieve|expand|win|launched|optimized|提升|增长|优化|实现|降低|达成|推动|促成|落地)/i
const BUSINESS_PATTERN = /(client|customer|merchant|market|campaign|analysis|data|stakeholder|sales|operations|business|crm|research|用户|客户|商户|市场|活动|分析|数据|业务|增长|运营|合作)/i
const EDUCATION_PATTERN = /(university|college|school|bachelor|master|degree|major|minor|gpa|education|学院|大学|学校|硕士|本科|专业|绩点)/i
const COURSEWORK_PATTERN = /(coursework|relevant coursework|major coursework|课程|核心课程)/i
const SKILL_LINE_PATTERN = /(skills?|technical skills|proficient|familiar|tools?|技术栈|熟悉|擅长|技能)/i
const CONTACT_PATTERN = /(@|linkedin|github|portfolio|wechat|phone|tel|邮箱|电话|手机号|邮箱地址)/i
const DATE_LOCATION_PATTERN = /(\b(19|20)\d{2}\b|present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|至今|年|月|singapore|china|beijing|shanghai|guangzhou|shenzhen|hong kong)/i

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

function isDateOrLocationLine(line = '') {
  return DATE_LOCATION_PATTERN.test(line) && line.length < 64 && !ACTION_PATTERN.test(line) && !RESULT_PATTERN.test(line)
}

function isLowValueMetaLine(line = '', sectionType = 'general') {
  return isContactLine(line)
    || isEducationLine(line, sectionType)
    || isCourseworkLine(line)
    || isSkillLine(line, sectionType)
    || isDateOrLocationLine(line)
}

function uniqueStrings(values = [], limit = 8) {
  return [...new Set(
    values
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )].slice(0, limit)
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
  if (/\b(supported|assisted|helped)\b|协助|参与/.test(line) && !METRIC_PATTERN.test(line)) score -= 4

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

function buildRewriteDirection(language = 'zh', missingMetrics, weakOwnership, weakOutcome) {
  const priorities = []
  if (missingMetrics) priorities.push(txt(language, '补结果和指标', 'add the result and metric'))
  if (weakOwnership) priorities.push(txt(language, '说清你亲自做了什么', 'clarify what you personally drove'))
  if (weakOutcome) priorities.push(txt(language, '从职责改成成果表达', 'turn responsibility wording into outcome wording'))

  return txt(
    language,
    `把这句改成“场景 + 目标 + 你的动作 + ${priorities.join(' + ')}”。原句保留事实，但一定要落到结果。`,
    `Rewrite this into “context + goal + your action + ${priorities.join(' + ')}.” Keep the facts, but land the sentence on an outcome.`
  )
}

function buildImprovementSuggestions(sections = [], language = 'zh') {
  const suggestions = []

  for (const section of sections) {
    if (!['experience', 'project', 'leadership', 'general'].includes(section.type)) continue

    for (const line of section.items) {
      if (line.length < 20 || isLowValueMetaLine(line, section.type)) continue

      const missingMetrics = !METRIC_PATTERN.test(line)
      const weakOwnership = !ACTION_PATTERN.test(line) || /\b(supported|assisted|helped)\b|协助|参与/.test(line)
      const weakOutcome = !RESULT_PATTERN.test(line)

      if (!missingMetrics && !weakOwnership && !weakOutcome) continue

      const issueParts = [
        missingMetrics ? txt(language, '缺少结果或指标', 'Missing metrics or outcomes') : '',
        weakOwnership ? txt(language, '个人动作不够清楚', 'Personal ownership is not clear') : '',
        weakOutcome ? txt(language, '更像职责描述，不像成果', 'Reads more like responsibility than outcome') : ''
      ].filter(Boolean)

      suggestions.push({
        original: line,
        issue: issueParts.join(txt(language, '；', '; ')),
        rewriteDirection: buildRewriteDirection(language, missingMetrics, weakOwnership, weakOutcome),
        severity: issueParts.length + (missingMetrics ? 1 : 0) + (weakOwnership ? 1 : 0)
      })
    }
  }

  const unique = []
  const seen = new Set()

  for (const suggestion of suggestions.sort((a, b) => b.severity - a.severity || b.original.length - a.original.length)) {
    if (seen.has(suggestion.original)) continue
    seen.add(suggestion.original)
    unique.push(suggestion)
    if (unique.length >= 4) break
  }

  return unique
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

function buildFallbackProfile(text = '', language = 'zh', meta = {}) {
  const sections = buildSections(text, language)
  const storyCandidates = collectStoryCandidates(sections)
  const recommendedHighlights = uniqueStrings(storyCandidates.map((item) => item.text), 5)
  const improvementSuggestions = buildImprovementSuggestions(sections, language)
  const riskLines = uniqueStrings(improvementSuggestions.map((item) => item.original), 4)
  const skills = extractSkills(text, sections)

  return {
    rawText: text,
    detectedLanguage: meta.detectedLanguage || (hasChinese(text) ? 'zh' : 'en'),
    fileName: meta.fileName || '',
    skills,
    achievementLines: recommendedHighlights,
    riskLines,
    recommendedHighlights,
    improvementSuggestions,
    interviewSignals: recommendedHighlights.slice(0, 3),
    previewSections: derivePreviewSections(sections, language),
    stats: {
      sectionCount: sections.length,
      skillCount: skills.length,
      highlightCount: recommendedHighlights.length,
      rewriteCount: improvementSuggestions.length
    },
    summary: txt(
      language,
      `识别出 ${sections.length} 个简历版块，筛出 ${recommendedHighlights.length} 条适合直接答题的经历，${improvementSuggestions.length} 条优先改写项，以及 ${skills.length} 个技能信号。`,
      `Detected ${sections.length} resume sections, found ${recommendedHighlights.length} interview-ready story lines, ${improvementSuggestions.length} priority rewrite items, and ${skills.length} skill signals.`
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
      rewriteDirection: normalizeLine(item?.rewriteDirection || '')
    }))
    .filter((item) => item.original && item.issue && item.rewriteDirection)

  return items.length ? items.slice(0, 4) : fallback
}

function normalizeProfileShape(candidate, fallback, text, meta = {}) {
  const skills = uniqueStrings(candidate?.skills || fallback.skills, 14)
  const recommendedHighlights = uniqueStrings(candidate?.recommendedHighlights || fallback.recommendedHighlights, 5)
  const improvementSuggestions = sanitizeImprovements(candidate?.improvementSuggestions, fallback.improvementSuggestions)

  return {
    ...fallback,
    rawText: text,
    detectedLanguage: meta.detectedLanguage || fallback.detectedLanguage,
    fileName: meta.fileName || fallback.fileName || '',
    summary: normalizeLine(candidate?.summary || '') || fallback.summary,
    skills,
    recommendedHighlights,
    achievementLines: recommendedHighlights,
    riskLines: uniqueStrings(candidate?.riskLines || improvementSuggestions.map((item) => item.original) || fallback.riskLines, 4),
    improvementSuggestions,
    interviewSignals: uniqueStrings(candidate?.interviewSignals || recommendedHighlights, 3),
    previewSections: sanitizeSections(candidate?.previewSections, fallback.previewSections),
    stats: {
      ...fallback.stats,
      skillCount: skills.length,
      highlightCount: recommendedHighlights.length,
      rewriteCount: improvementSuggestions.length
    }
  }
}

async function analyzeResumeWithAI(text = '', language = 'zh') {
  if (!aiClient || !text.trim()) return null

  const prompt = `
You are a resume strategist inspired by VMock-style review logic.
Return JSON only.
Target language: ${language === 'zh' ? 'Chinese' : 'English'}.

Analyze the resume below for interview preparation.
Critical rules:
- Do NOT mark contact details, school names, degree names, GPA, locations, or coursework lists as weak bullets unless they are truly malformed.
- Focus weak-line feedback on experience, project, leadership, or achievement statements.
- Prefer evidence that can actually be rehearsed in an interview.
- Keep all output concise and product-ready.

Resume text:
${text.slice(0, 14000)}

Required JSON shape:
{
  "summary": string,
  "skills": string[],
  "recommendedHighlights": string[],
  "riskLines": string[],
  "improvementSuggestions": [
    {"original": string, "issue": string, "rewriteDirection": string}
  ],
  "interviewSignals": string[],
  "previewSections": [
    {"title": string, "items": string[]}
  ]
}
`

  const response = await aiClient.responses.create({
    model: analysisModel,
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
