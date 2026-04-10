import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { retrieveInterviewSignals } from '../services/retrievalService.js'
import { generateAnswerBatch, generateInterviewPack, generatePersonalizedAnswer, getAiRuntimeStatus } from '../services/aiService.js'
import { buildScrapeNextStep, getCrawlerStatus, getScrapeConfig, runLiveScrape } from '../services/scrapeService.js'
import { analyzeResumeText, parseResumeFile, parseResumeText } from '../services/resumeService.js'
import { countFeedback, getStorageStatus, listSessions, saveFeedback, saveSession } from '../utils/storage.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

const interviewSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  jd: z.string().min(1),
  resume: z.string().min(1),
  interviewType: z.string().min(1),
  language: z.enum(['zh', 'en']).default('zh')
})

const evidenceItemSchema = z.object({
  source: z.string().default(''),
  title: z.string().default(''),
  question: z.string().default(''),
  notes: z.string().default(''),
  snippet: z.string().default(''),
  whyMatched: z.string().default(''),
  referenceUrl: z.string().default(''),
  referenceSearchUrl: z.string().default(''),
  url: z.string().default(''),
  kind: z.string().default(''),
  pageType: z.string().default(''),
  score: z.number().optional()
}).passthrough()

const questionPlanSchema = z.object({
  cluster: z.string().default(''),
  question: z.string().min(1),
  whyAsked: z.string().default(''),
  answerStrategy: z.string().default(''),
  sampleAnswer: z.string().default(''),
  supportingEvidence: z.array(z.object({
    label: z.string().default(''),
    url: z.string().default('')
  })).default([])
}).passthrough()

router.post('/generate', async (req, res) => {
  try {
    const input = interviewSchema.parse(req.body)
    const scrape = await runLiveScrape(input)
    const retrieval = await retrieveInterviewSignals({ ...input, liveScrape: scrape })
    const resumeProfile = await analyzeResumeText(input.resume, input.language)
    const result = await generateInterviewPack(input, {
      ...retrieval,
      liveScrape: scrape
    }, resumeProfile)

    await saveSession({
      company: input.company,
      role: input.role,
      interviewType: input.interviewType,
      language: input.language,
      createdAt: new Date().toISOString(),
      fitScore: result.fitReview?.overallScore ?? null
    })

    res.json({
      ok: true,
      data: result,
      retrieval,
      scrape,
      resumeProfile,
      aiStatus: getAiRuntimeStatus()
    })
  } catch (error) {
    console.error('[interview/generate] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.post('/answers/generate', async (req, res) => {
  try {
    const schema = interviewSchema.extend({
      question: z.string().min(1),
      questionPlan: questionPlanSchema.optional(),
      evidence: z.array(evidenceItemSchema).default([]),
      answerLanguage: z.enum(['zh', 'en']).optional(),
      answerLength: z.enum(['short', 'standard', 'deep']).optional().default('standard'),
      tone: z.enum(['natural', 'confident', 'formal']).optional().default('natural')
    })

    const input = schema.parse(req.body)
    const resumeProfile = parseResumeText(input.resume, input.answerLanguage || input.language)
    const answer = await generatePersonalizedAnswer(input, {
      question: input.question,
      answerLanguage: input.answerLanguage || input.language,
      answerLength: input.answerLength,
      tone: input.tone,
      questionPlan: input.questionPlan || { question: input.question },
      evidence: input.evidence || []
    }, resumeProfile)

    res.json({
      ok: true,
      data: answer,
      aiStatus: getAiRuntimeStatus()
    })
  } catch (error) {
    console.error('[interview/answers-generate] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.post('/answers/batch', async (req, res) => {
  try {
    const schema = interviewSchema.extend({
      questions: z.array(questionPlanSchema).min(1),
      evidence: z.array(evidenceItemSchema).default([]),
      answerLanguage: z.enum(['zh', 'en']).optional(),
      answerLength: z.enum(['short', 'standard', 'deep']).optional().default('standard'),
      tone: z.enum(['natural', 'confident', 'formal']).optional().default('natural')
    })

    const input = schema.parse(req.body)
    const resumeProfile = parseResumeText(input.resume, input.answerLanguage || input.language)
    const batch = await generateAnswerBatch(input, {
      questions: input.questions,
      answerLanguage: input.answerLanguage || input.language,
      answerLength: input.answerLength,
      tone: input.tone,
      evidence: input.evidence || []
    }, resumeProfile)

    res.json({
      ok: true,
      data: batch,
      aiStatus: getAiRuntimeStatus()
    })
  } catch (error) {
    console.error('[interview/answers-batch] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.get('/insights', async (req, res) => {
  try {
    const { company = '', role = '', interviewType = '', language = 'zh' } = req.query
    const retrieval = await retrieveInterviewSignals({ company, role, interviewType, language })
    res.json({ ok: true, data: retrieval })
  } catch (error) {
    console.error('[interview/insights] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.get('/crawler/status', async (_, res) => {
  try {
    res.json({
      ok: true,
      data: getCrawlerStatus()
    })
  } catch (error) {
    console.error('[interview/crawler-status] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.get('/scrape/debug', async (req, res) => {
  try {
    const schema = z.object({
      company: z.string().min(1),
      role: z.string().min(1),
      interviewType: z.string().optional().default('')
    })

    const input = schema.parse(req.query)
    const result = await runLiveScrape(input)

    res.json({
      ok: true,
      data: result,
      guidance: {
        config: getScrapeConfig(),
        status: result.status,
        nextStep: buildScrapeNextStep(result)
      }
    })
  } catch (error) {
    console.error('[interview/scrape-debug] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.post('/resume/parse', upload.single('resume'), async (req, res) => {
  try {
    const language = req.body.language === 'en' ? 'en' : 'zh'
    if (req.file) {
      const parsed = await parseResumeFile(req.file, language)
      return res.json({ ok: true, data: parsed })
    }

    if (req.body.text) {
      const parsed = await analyzeResumeText(req.body.text, language)
      return res.json({ ok: true, data: parsed })
    }

    return res.status(400).json({ ok: false, message: language === 'zh' ? '请上传文件或提供文本。' : 'Please upload a file or provide text.' })
  } catch (error) {
    console.error('[interview/resume-parse] failed:', error.message)
    return res.status(400).json({ ok: false, message: error.message })
  }
})

router.get('/workspace/bootstrap', async (req, res) => {
  try {
    const [feedbackCount, recentSessions, storage] = await Promise.all([
      countFeedback(),
      listSessions({ limit: 8 }),
      getStorageStatus()
    ])

    res.json({
      ok: true,
      data: {
        feedbackCount,
        recentSessions,
        storage,
        crawlerStatus: getCrawlerStatus(),
        aiStatus: getAiRuntimeStatus()
      }
    })
  } catch (error) {
    console.error('[interview/workspace-bootstrap] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

router.post('/feedback', async (req, res) => {
  try {
    const schema = z.object({
      company: z.string(),
      role: z.string(),
      interviewType: z.string(),
      askedQuestions: z.array(z.string()).default([]),
      style: z.string().default(''),
      difficulty: z.string().default(''),
      notes: z.string().default('')
    })

    const payload = schema.parse(req.body)
    await saveFeedback({ ...payload, createdAt: new Date().toISOString() })
    const feedbackCount = await countFeedback()
    res.json({ ok: true, count: feedbackCount })
  } catch (error) {
    console.error('[interview/feedback] failed:', error.message)
    res.status(400).json({ ok: false, message: error.message })
  }
})

export default router
