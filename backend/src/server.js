import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import interviewRoutes from './routes/interviewRoutes.js'
import { getCrawlerStatus } from './services/scrapeService.js'
import { getStorageStatus } from './utils/storage.js'

const app = express()

const allowedOrigin = process.env.ALLOWED_ORIGIN || '*'
app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin }))
app.use(express.json({ limit: '1mb' }))

app.get('/', async (_, res) => {
  const storage = await getStorageStatus()
  res.json({ ok: true, product: 'Interview Navigator API', storage, crawlerStatus: getCrawlerStatus() })
})

app.get('/api/health', async (_, res) => {
  const storage = await getStorageStatus()
  res.json({ ok: true, product: 'Interview Navigator API', storage, crawlerStatus: getCrawlerStatus() })
})

app.use('/api/interview', interviewRoutes)

const port = process.env.PORT || 8787
app.listen(port, () => {
  console.log(`Interview Navigator API running on http://localhost:${port}`)
})
