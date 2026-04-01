import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'

const root = path.resolve(process.cwd(), '..')
const feedbackPath = path.join(root, 'feedback-store.json')
const sessionPath = path.join(root, 'session-store.json')
const storageMode = process.env.DATABASE_URL ? 'database' : 'file'

let pool = null
let dbReady = false

function readJson(targetPath) {
  if (!fs.existsSync(targetPath)) return []
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8'))
  } catch {
    return []
  }
}

function writeJson(targetPath, items) {
  fs.writeFileSync(targetPath, JSON.stringify(items, null, 2), 'utf-8')
}

function getPool() {
  if (!process.env.DATABASE_URL) return null
  if (pool) return pool

  const ssl = process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl
  })

  return pool
}

async function ensureTables() {
  if (storageMode !== 'database' || dbReady) return

  const db = getPool()
  if (!db) return

  await db.query(`
    CREATE TABLE IF NOT EXISTS interview_feedback (
      id BIGSERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      interview_type TEXT NOT NULL,
      asked_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      style TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id BIGSERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      interview_type TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'zh',
      fit_score INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  dbReady = true
}

function normalizeLimit(value, fallback) {
  const limit = Number(value)
  if (!Number.isFinite(limit) || limit <= 0) return fallback
  return Math.min(limit, 200)
}

async function listFeedbackFromFile({ company = '', role = '', limit = 50 } = {}) {
  return readJson(feedbackPath)
    .filter((item) => {
      const companyMatch = !company || String(item.company || '').toLowerCase().includes(String(company).toLowerCase())
      const roleMatch = !role || String(item.role || '').toLowerCase().includes(String(role).toLowerCase())
      return companyMatch && roleMatch
    })
    .slice(0, normalizeLimit(limit, 50))
}

async function listSessionsFromFile({ limit = 8 } = {}) {
  return readJson(sessionPath).slice(0, normalizeLimit(limit, 8))
}

async function countFeedbackFromFile() {
  return readJson(feedbackPath).length
}

async function saveFeedbackToFile(entry) {
  const current = readJson(feedbackPath)
  const next = [{ ...entry, createdAt: entry.createdAt || new Date().toISOString() }, ...current].slice(0, 200)
  writeJson(feedbackPath, next)
  return next[0]
}

async function saveSessionToFile(entry) {
  const current = readJson(sessionPath)
  const next = [{ ...entry, createdAt: entry.createdAt || new Date().toISOString() }, ...current].slice(0, 30)
  writeJson(sessionPath, next)
  return next[0]
}

export async function listFeedback({ company = '', role = '', limit = 50 } = {}) {
  if (storageMode !== 'database') {
    return listFeedbackFromFile({ company, role, limit })
  }

  await ensureTables()
  const db = getPool()
  const values = []
  const conditions = []

  if (company) {
    values.push(`%${company}%`)
    conditions.push(`LOWER(company) LIKE LOWER($${values.length})`)
  }

  if (role) {
    values.push(`%${role}%`)
    conditions.push(`LOWER(role) LIKE LOWER($${values.length})`)
  }

  values.push(normalizeLimit(limit, 50))
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const query = `
    SELECT company, role, interview_type AS "interviewType", asked_questions AS "askedQuestions", style, difficulty, notes, created_at AS "createdAt"
    FROM interview_feedback
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${values.length}
  `

  const result = await db.query(query, values)
  return result.rows
}

export async function countFeedback() {
  if (storageMode !== 'database') {
    return countFeedbackFromFile()
  }

  await ensureTables()
  const db = getPool()
  const result = await db.query('SELECT COUNT(*)::int AS count FROM interview_feedback')
  return result.rows[0]?.count || 0
}

export async function saveFeedback(entry) {
  const payload = {
    company: entry.company || '',
    role: entry.role || '',
    interviewType: entry.interviewType || '',
    askedQuestions: Array.isArray(entry.askedQuestions) ? entry.askedQuestions : [],
    style: entry.style || '',
    difficulty: entry.difficulty || '',
    notes: entry.notes || '',
    createdAt: entry.createdAt || new Date().toISOString()
  }

  if (storageMode !== 'database') {
    return saveFeedbackToFile(payload)
  }

  await ensureTables()
  const db = getPool()
  const result = await db.query(
    `
      INSERT INTO interview_feedback (company, role, interview_type, asked_questions, style, difficulty, notes, created_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
      RETURNING company, role, interview_type AS "interviewType", asked_questions AS "askedQuestions", style, difficulty, notes, created_at AS "createdAt"
    `,
    [
      payload.company,
      payload.role,
      payload.interviewType,
      JSON.stringify(payload.askedQuestions),
      payload.style,
      payload.difficulty,
      payload.notes,
      payload.createdAt
    ]
  )

  return result.rows[0]
}

export async function listSessions({ limit = 8 } = {}) {
  if (storageMode !== 'database') {
    return listSessionsFromFile({ limit })
  }

  await ensureTables()
  const db = getPool()
  const result = await db.query(
    `
      SELECT company, role, interview_type AS "interviewType", language, fit_score AS "fitScore", created_at AS "createdAt"
      FROM interview_sessions
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [normalizeLimit(limit, 8)]
  )

  return result.rows
}

export async function saveSession(entry) {
  const payload = {
    company: entry.company || '',
    role: entry.role || '',
    interviewType: entry.interviewType || '',
    language: entry.language || 'zh',
    fitScore: Number.isFinite(Number(entry.fitScore)) ? Number(entry.fitScore) : null,
    createdAt: entry.createdAt || new Date().toISOString()
  }

  if (storageMode !== 'database') {
    return saveSessionToFile(payload)
  }

  await ensureTables()
  const db = getPool()
  const result = await db.query(
    `
      INSERT INTO interview_sessions (company, role, interview_type, language, fit_score, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING company, role, interview_type AS "interviewType", language, fit_score AS "fitScore", created_at AS "createdAt"
    `,
    [payload.company, payload.role, payload.interviewType, payload.language, payload.fitScore, payload.createdAt]
  )

  return result.rows[0]
}

export async function getStorageStatus() {
  if (storageMode !== 'database') {
    return { mode: 'file', ready: true }
  }

  try {
    await ensureTables()
    await getPool().query('SELECT 1')
    return { mode: 'database', ready: true }
  } catch (error) {
    return { mode: 'database', ready: false, error: error.message }
  }
}
