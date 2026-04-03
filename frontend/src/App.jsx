import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { copy } from './lib/i18n'
import { apiUrl } from './lib/api'

const defaultForm = {
  company: '',
  role: '',
  interviewType: 'professional',
  jd: '',
  resume: '',
  language: 'zh'
}

const defaultFeedback = {
  company: '',
  role: '',
  interviewType: 'professional',
  askedQuestions: '',
  style: '',
  difficulty: '',
  notes: ''
}

const defaultBootstrap = {
  feedbackCount: 0,
  recentSessions: [],
  storage: null,
  crawlerStatus: null
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildDocList(items = []) {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
}

function buildCheatSheetDoc({ form, pack, resumeProfile }) {
  const title = `${form.company || 'Interview'}-${form.role || 'Prep'}-cheatsheet`
  const html = `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #1d2738; margin: 32px; line-height: 1.6; }
        h1, h2, h3 { color: #13284b; }
        .muted { color: #66748f; }
        .section { margin-top: 28px; }
        .card { border: 1px solid #d9e2ef; border-radius: 12px; padding: 16px; margin-top: 12px; }
        ul { padding-left: 20px; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(form.company || 'Interview Prep')} / ${escapeHtml(form.role || 'Target Role')}</h1>
      <p class="muted">Generated from Interview Navigator</p>

      <div class="section">
        <h2>Fit Summary</h2>
        <div class="card">
          <strong>${escapeHtml(String(pack?.fitReview?.overallScore ?? '—'))}/100</strong>
          <p>${escapeHtml(pack?.fitReview?.summary || '')}</p>
        </div>
      </div>

      <div class="section">
        <h2>Self Intro</h2>
        <div class="card">${escapeHtml(pack?.cheatSheet?.selfIntro || '')}</div>
      </div>

      <div class="section">
        <h2>Story Anchors</h2>
        <ul>${buildDocList(pack?.cheatSheet?.storyAnchors || resumeProfile?.recommendedHighlights || [])}</ul>
      </div>

      <div class="section">
        <h2>Must Remember</h2>
        <ul>${buildDocList(pack?.cheatSheet?.mustRemember || [])}</ul>
      </div>

      <div class="section">
        <h2>Targeted Questions</h2>
        ${(pack?.answerDrafts || []).map((item) => `
          <div class="card">
            <h3>${escapeHtml(item.cluster || '')}</h3>
            <p><strong>Question:</strong> ${escapeHtml(item.question || '')}</p>
            <p><strong>Why asked:</strong> ${escapeHtml(item.whyAsked || '')}</p>
            <p><strong>Strategy:</strong> ${escapeHtml(item.answerStrategy || '')}</p>
            <p><strong>Draft:</strong> ${escapeHtml(item.sampleAnswer || '')}</p>
          </div>
        `).join('')}
      </div>

      <div class="section">
        <h2>Resume Rewrite Priorities</h2>
        ${(pack?.resumeRisks || []).map((item) => `
          <div class="card">
            <p><strong>Line:</strong> ${escapeHtml(item.resumePoint || '')}</p>
            <p><strong>Risk:</strong> ${escapeHtml(item.risk || '')}</p>
            <p><strong>Fix:</strong> ${escapeHtml(item.fix || '')}</p>
          </div>
        `).join('')}
      </div>

      <div class="section">
        <h2>Closing Questions</h2>
        <ul>${buildDocList(pack?.cheatSheet?.closingQuestions || [])}</ul>
      </div>
    </body>
  </html>
  `

  return {
    fileName: `${slugify(title) || 'interview-cheatsheet'}.doc`,
    html
  }
}

function downloadCheatSheetDoc({ form, pack, resumeProfile }) {
  if (!pack) return
  const { fileName, html } = buildCheatSheetDoc({ form, pack, resumeProfile })
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function formatTime(value, language = 'zh') {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
  } catch {
    return value
  }
}

function buildRewriteRows(scrapeState) {
  return Object.values(scrapeState?.searchPlan?.sourcePlans || {})
    .filter((plan) => plan?.displayQuery)
    .map((plan) => ({
      source: plan.source,
      original: plan.originalQuery || '',
      rewritten: plan.displayQuery || '',
      usedQueryRewrite: Boolean(plan.usedQueryRewrite)
    }))
    .filter((item) => item.original || item.rewritten)
}

function describeCrawlerSource(source, t) {
  if (!source?.crawlerEnabled) {
    return {
      tone: 'warning',
      headline: t.evidencePage.crawlerDisabled,
      helper: t.prepPage.scrapeDisabled
    }
  }

  if (!source.cookieConfigured) {
    return {
      tone: 'warning',
      headline: t.evidencePage.cookieMissing,
      helper: t.evidencePage.fallbackMode
    }
  }

  if (source.cookieValid === 'true') {
    return {
      tone: 'success',
      headline: t.evidencePage.cookieReady,
      helper: t.evidencePage.crawlerEnabled
    }
  }

  if (source.cookieValid === 'false') {
    return {
      tone: 'danger',
      headline: t.evidencePage.cookieInvalid,
      helper: source.lastError || t.evidencePage.fallbackMode
    }
  }

  return {
    tone: 'warning',
    headline: t.evidencePage.cookieUnknown,
    helper: source.antiBotDetected ? 'anti-bot detected' : t.evidencePage.fallbackMode
  }
}

function ShellCard({ title, subtitle, children, actions }) {
  return (
    <section className="shell-card">
      <div className="shell-card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="shell-card-body">{children}</div>
    </section>
  )
}

function StatCard({ label, value, helper }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="mini-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Field({ label, children, full }) {
  return (
    <label className={full ? 'field full' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function PageNav({ t }) {
  const items = [
    ['/dashboard', t.pages.dashboard],
    ['/resume', t.pages.resume],
    ['/prep', t.pages.prep],
    ['/evidence', t.pages.evidence],
    ['/review', t.pages.review]
  ]

  return (
    <nav className="sidebar-nav">
      {items.map(([to, label]) => (
        <NavLink key={to} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} to={to}>{label}</NavLink>
      ))}
    </nav>
  )
}

function LanguageSwitch({ language, onChange, t }) {
  return (
    <div className="lang-switch compact">
      <span>{t.language}</span>
      <button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => onChange('zh')}>中文</button>
      <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => onChange('en')}>EN</button>
    </div>
  )
}

function ResumePreview({ t, resumeProfile, compact = false }) {
  if (!resumeProfile?.previewSections?.length) {
    return <p className="empty-copy">{t.resumePage.previewEmpty}</p>
  }

  return (
    <div className={compact ? 'preview-stack compact' : 'preview-stack'}>
      {resumeProfile.previewSections.map((section) => (
        <div key={section.title} className="preview-card">
          <h4>{section.title}</h4>
          <ul className="bullet-list preview-list">
            {section.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function SourceStatusCard({ source, t, language }) {
  const meta = describeCrawlerSource(source, t)

  return (
    <article className={`source-status-card ${meta.tone}`}>
      <div className="source-status-top">
        <strong>{source.source}</strong>
        <span className={`pill ${meta.tone === 'success' ? 'solid' : meta.tone === 'danger' ? 'danger' : 'subtle'}`}>{meta.headline}</span>
      </div>
      <p>{meta.helper}</p>
      <div className="source-status-meta">
        <span>{t.evidencePage.sourceCount}: {source.candidateCount ?? 0}</span>
        <span>{t.evidencePage.lastChecked}: {formatTime(source.lastCheckedAt, language)}</span>
      </div>
      {source.lastError ? <small>{t.evidencePage.lastError}: {source.lastError}</small> : null}
    </article>
  )
}

function RewriteNote({ rows, t }) {
  if (!rows.length) return null

  return (
    <div className="rewrite-panel">
      <h5>{t.evidencePage.searchRewriteTitle}</h5>
      <div className="rewrite-list">
        {rows.map((row) => (
          <article key={row.source} className="rewrite-item">
            <div className="rewrite-item-head">
              <strong>{row.source}</strong>
              {row.usedQueryRewrite ? <span className="pill solid">ZH</span> : <span className="pill subtle">raw</span>}
            </div>
            <p><span className="mini-label">{t.evidencePage.originalQuery}</span>{row.original || '—'}</p>
            <p><span className="mini-label">{t.evidencePage.rewrittenQuery}</span>{row.rewritten || row.original || '—'}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

function DashboardPage({ t, pack, insights, bootstrap }) {
  const fitScore = pack?.fitReview?.overallScore ?? '—'

  return (
    <div className="page-grid one-column">
      <ShellCard title={t.dashboard.title} subtitle={t.dashboard.subtitle}>
        <div className="stats-grid">
          <StatCard label={t.dashboard.cards.fit} value={fitScore} helper={pack?.fitReview?.summary} />
          <StatCard label={t.dashboard.cards.evidence} value={insights.length} helper={pack?.evidence?.meta?.directCount ? `${pack.evidence.meta.directCount} ${t.prepPage.evidenceDirect}` : ''} />
          <StatCard label={t.dashboard.cards.sessions} value={bootstrap.recentSessions.length} />
          <StatCard label={t.dashboard.cards.feedback} value={bootstrap.feedbackCount} />
        </div>
      </ShellCard>

      <ShellCard title={t.dashboard.nextTitle}>
        {pack?.fitReview?.nextActions?.length ? (
          <ul className="bullet-list">
            {pack.fitReview.nextActions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : <p className="empty-copy">{t.noPack}</p>}
      </ShellCard>

      <ShellCard title={t.pages.dashboard} subtitle="Recent activity">
        <div className="session-list">
          {bootstrap.recentSessions.length ? bootstrap.recentSessions.map((session, index) => (
            <div className="session-item" key={`${session.company}-${index}`}>
              <div>
                <strong>{session.company || '—'}</strong>
                <span>{session.role || '—'}</span>
              </div>
              <div>
                <strong>{session.fitScore ?? '—'}</strong>
                <span>{new Date(session.createdAt).toLocaleString()}</span>
              </div>
            </div>
          )) : <p className="empty-copy">No recent sessions yet.</p>}
        </div>
      </ShellCard>
    </div>
  )
}

function ResumePage({ t, form, setForm, resumeProfile, setResumeProfile, resumePaste, setResumePaste, parseError, setParseError }) {
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function uploadFile(file) {
    if (!file) return
    setUploading(true)
    setParseError('')

    try {
      const data = new FormData()
      data.append('resume', file)
      data.append('language', form.language)
      const res = await fetch(apiUrl('/api/interview/resume/parse'), { method: 'POST', body: data })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.message || t.errors.parse)
      setResumeProfile(json.data)
      setForm((prev) => ({ ...prev, resume: json.data.rawText || prev.resume }))
      setResumePaste(json.data.rawText || '')
    } catch (error) {
      setParseError(error.message || t.errors.parse)
    } finally {
      setUploading(false)
      setDragging(false)
    }
  }

  async function parseText() {
    if (!resumePaste.trim()) return
    setUploading(true)
    setParseError('')

    try {
      const res = await fetch(apiUrl('/api/interview/resume/parse'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: resumePaste, language: form.language })
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.message || t.errors.parse)
      setResumeProfile(json.data)
      setForm((prev) => ({ ...prev, resume: json.data.rawText || resumePaste || prev.resume }))
    } catch (error) {
      setParseError(error.message || t.errors.parse)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="page-grid one-column">
      <div className="resume-shell">
        <div className="resume-main">
          <ShellCard title={t.resumePage.title} subtitle={t.resumePage.subtitle}>
            <div className="resume-intake">
              <label
                className={`upload-box hero-upload ${dragging ? 'dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  uploadFile(event.dataTransfer.files?.[0])
                }}
              >
                <span>{resumeProfile ? t.resumePage.replaceResume : t.uploadResume}</span>
                <small>{t.helperUpload}</small>
                <strong className="upload-hint">{t.resumePage.dragHint}</strong>
                <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={(e) => uploadFile(e.target.files?.[0])} />
              </label>

              {resumeProfile ? (
                <div className="file-summary-grid">
                  <div className="surface-panel compact-panel">
                    <span className="mini-label">{t.resumePage.fileName}</span>
                    <strong>{resumeProfile.fileName || '—'}</strong>
                  </div>
                  <div className="surface-panel compact-panel">
                    <span className="mini-label">{t.resumePage.detectedLanguage}</span>
                    <strong>{resumeProfile.detectedLanguage || '—'}</strong>
                  </div>
                  <div className="surface-panel compact-panel">
                    <span className="mini-label">{t.resumePage.summary}</span>
                    <strong>{resumeProfile.summary}</strong>
                  </div>
                </div>
              ) : null}

              {parseError ? <div className="status-banner error">{parseError}</div> : null}
            </div>
          </ShellCard>

          <ShellCard title={t.resumePage.previewTitle} subtitle={resumeProfile?.summary || t.resumePage.previewEmpty}>
            {resumeProfile ? (
              <>
                <div className="mini-stats-grid">
                  <MiniStat label={t.resumePage.statsSkills} value={resumeProfile.stats?.skillCount ?? resumeProfile.skills?.length ?? 0} />
                  <MiniStat label={t.resumePage.statsHighlights} value={resumeProfile.stats?.highlightCount ?? resumeProfile.recommendedHighlights?.length ?? 0} />
                  <MiniStat label={t.resumePage.statsRewrite} value={resumeProfile.stats?.rewriteCount ?? resumeProfile.improvementSuggestions?.length ?? 0} />
                </div>
                <ResumePreview t={t} resumeProfile={resumeProfile} />
              </>
            ) : <p className="empty-copy">{t.resumePage.previewEmpty}</p>}
          </ShellCard>

          <ShellCard title={t.resumePage.storyBankTitle} subtitle={resumeProfile?.storyBank?.length ? t.resumePage.interviewSignals : t.resumePage.noStoryBank}>
            {resumeProfile?.storyBank?.length ? (
              <div className="story-grid">
                {resumeProfile.storyBank.map((item) => (
                  <article className="story-card" key={item.title}>
                    <h4>{item.title}</h4>
                    <p>{item.anchor}</p>
                    <small><span className="mini-label">{t.resumePage.storyGoodFor}</span>{item.goodFor}</small>
                    <small><span className="mini-label">{t.resumePage.storyFollowUp}</span>{item.likelyFollowUp}</small>
                    <small><span className="mini-label">{t.resumePage.storyGap}</span>{item.detailGap}</small>
                  </article>
                ))}
              </div>
            ) : <p className="empty-copy">{t.resumePage.noStoryBank}</p>}
          </ShellCard>

          <ShellCard title={t.resumePage.rawPreview} subtitle={t.resumePage.manualHint}>
            <div className="surface-panel raw-preview-panel">
              <pre className="raw-preview">{resumeProfile?.rawText || resumePaste || ''}</pre>
            </div>
            <details className="details-panel">
              <summary>{t.resumePage.manualTitle}</summary>
              <p className="mini-note">{t.resumePage.manualHint}</p>
              <textarea rows="10" value={resumePaste} onChange={(e) => setResumePaste(e.target.value)} placeholder="Paste resume text here…" />
              <div className="actions-row details-actions">
                <button type="button" className="secondary-button" onClick={parseText} disabled={uploading || !resumePaste.trim()}>{t.parseResume}</button>
              </div>
            </details>
          </ShellCard>
        </div>

        <aside className="resume-rail">
          <div className="resume-rail-sticky">
            <ShellCard title={t.resumePage.diagnosisTitle} subtitle={t.resumePage.coachSummary}>
              {resumeProfile ? (
                <div className="resume-rail-scroll">
                  <div className="resume-diagnosis-group">
                    <h4>{t.resumePage.topFixes}</h4>
                    {(resumeProfile.improvementSuggestions || []).length ? (
                      (resumeProfile.improvementSuggestions || []).map((item) => (
                        <article className="coach-item" key={item.original}>
                          <span className="pill danger">{item.verdict || t.resumePage.risks}</span>
                          <strong>{item.original}</strong>
                          <p><span className="mini-label">{t.resumePage.improveIssue}</span>{item.reason || item.issue}</p>
                          <p><span className="mini-label">{t.resumePage.improveDirection}</span>{item.rewriteDirection}</p>
                        </article>
                      ))
                    ) : <p className="empty-copy">{t.resumePage.noCoachItems}</p>}
                  </div>

                  <div className="resume-diagnosis-group">
                    <h4>{t.resumePage.polishTitle}</h4>
                    {(resumeProfile.polishSuggestions || []).length ? (
                      (resumeProfile.polishSuggestions || []).map((item) => (
                        <article className="coach-item subtle" key={item.original}>
                          <span className="pill subtle">{item.verdict || t.resumePage.polishTitle}</span>
                          <strong>{item.original}</strong>
                          <p><span className="mini-label">{t.resumePage.improveIssue}</span>{item.reason || item.issue}</p>
                          <p><span className="mini-label">{t.resumePage.improveDirection}</span>{item.rewriteDirection}</p>
                        </article>
                      ))
                    ) : <p className="empty-copy">{t.resumePage.noCoachItems}</p>}
                  </div>

                  <div className="resume-diagnosis-group">
                    <h4>{t.resumePage.keepTitle}</h4>
                    {(resumeProfile.keepSuggestions || []).length ? (
                      (resumeProfile.keepSuggestions || []).map((item) => (
                        <article className="coach-item keep" key={item.original}>
                          <span className="pill solid">{item.verdict || t.resumePage.keepTitle}</span>
                          <strong>{item.original}</strong>
                          <p>{item.reason}</p>
                        </article>
                      ))
                    ) : <p className="empty-copy">{t.resumePage.noCoachItems}</p>}
                  </div>
                </div>
              ) : <p className="empty-copy">{t.noPack}</p>}
            </ShellCard>
          </div>
        </aside>
      </div>
    </div>
  )
}

function PrepPage({ t, form, setForm, resumeProfile, pack, insights, scrapeState, crawlerStatus, loading, generateError, onGenerate, onDownloadDoc }) {
  const evidenceMeta = pack?.evidence?.meta
  const currentCrawlerStatus = scrapeState?.crawlerStatus || crawlerStatus
  const rewriteRows = buildRewriteRows(scrapeState)

  return (
    <div className="page-grid two-column">
      <ShellCard title={t.prepPage.title} subtitle={t.prepPage.subtitle}>
        <form className="form-grid" onSubmit={onGenerate}>
          <Field label={t.company}><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
          <Field label={t.role}><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
          <Field label={t.interviewType}>
            <select value={form.interviewType} onChange={(e) => setForm({ ...form, interviewType: e.target.value })}>
              {Object.entries(t.types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label={t.languageOutput}>
            <div className="inline-toggle">
              <button type="button" className={form.language === 'zh' ? 'active' : ''} onClick={() => setForm({ ...form, language: 'zh' })}>中文</button>
              <button type="button" className={form.language === 'en' ? 'active' : ''} onClick={() => setForm({ ...form, language: 'en' })}>EN</button>
            </div>
          </Field>
          <Field label={t.jd} full><textarea rows="8" value={form.jd} onChange={(e) => setForm({ ...form, jd: e.target.value })} /></Field>
          <Field label={t.prepPage.resumeBasis} full>
            <div className="surface-panel snapshot-panel">
              {resumeProfile ? (
                <>
                  <div className="surface-panel-head">
                    <strong>{resumeProfile.summary}</strong>
                  </div>
                  <ResumePreview t={t} resumeProfile={resumeProfile} compact />
                </>
              ) : <p className="empty-copy">{t.prepPage.resumeMissing}</p>}
            </div>
          </Field>
          <details className="details-panel full">
            <summary>{t.prepPage.manualResumeEdit}</summary>
            <textarea rows="8" value={form.resume} onChange={(e) => setForm({ ...form, resume: e.target.value })} />
          </details>
          <div className="actions-row full">
            <button className="primary-button" disabled={loading || !form.company.trim() || !form.role.trim() || !form.jd.trim() || !form.resume.trim()}>{loading ? t.generating : t.generate}</button>
            <p className="helper-line">{t.helperGenerate}</p>
          </div>
          {generateError ? <div className="status-banner error full">{generateError}</div> : null}
        </form>
      </ShellCard>

      <ShellCard
        title={t.prepPage.outputTitle}
        subtitle={pack?.fitReview?.summary || t.noPack}
        actions={pack ? <button type="button" className="secondary-button" onClick={onDownloadDoc}>{t.prepPage.downloadDoc}</button> : null}
      >
        {!pack ? <p className="empty-copy">{t.noPack}</p> : (
          <div className="stacked-sections">
            {(currentCrawlerStatus?.sources || []).length ? (
              <div className="section-block">
                <h4>{t.prepPage.sourceStatus}</h4>
                <div className="source-status-grid compact-grid">
                  {currentCrawlerStatus.sources.map((source) => <SourceStatusCard key={source.key || source.source} source={source} t={t} language={form.language} />)}
                </div>
              </div>
            ) : null}

            {rewriteRows.length ? (
              <div className="section-block">
                <h4>{t.prepPage.searchRewrite}</h4>
                <RewriteNote rows={rewriteRows} t={t} />
              </div>
            ) : null}

            <div className="section-block">
              <h4>{t.prepPage.fitTitle}</h4>
              <div className="score-strip">
                <strong>{pack.fitReview?.overallScore ?? '—'}</strong>
                <span>{pack.fitReview?.summary}</span>
              </div>

              <div className="keyword-grid">
                <div className="keyword-block">
                  <h5>{t.prepPage.matchedKeywords}</h5>
                  <div className="pill-row">
                    {(pack.fitReview?.matchedKeywords || []).map((item) => <span key={item} className="pill solid">{item}</span>)}
                  </div>
                </div>
                <div className="keyword-block">
                  <h5>{t.prepPage.missingKeywords}</h5>
                  <div className="pill-row">
                    {(pack.fitReview?.missingKeywords || []).map((item) => <span key={item} className="pill danger">{item}</span>)}
                  </div>
                </div>
              </div>

              <div className="two-lists">
                <div>
                  <h5>{t.prepPage.strengths}</h5>
                  <ul className="bullet-list">{pack.fitReview?.strengths?.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <h5>{t.prepPage.gaps}</h5>
                  <ul className="bullet-list">{pack.fitReview?.gaps?.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>

              <div>
                <h5>{t.prepPage.dimensions}</h5>
                <div className="dimension-list">{pack.fitReview?.dimensions?.map((item) => (
                  <div key={item.label} className="dimension-item">
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.reason}</span>
                      {item.evidence?.length ? <div className="pill-row evidence-inline">{item.evidence.map((evidence) => <span key={evidence} className="pill subtle">{evidence}</span>)}</div> : null}
                    </div>
                    <b>{item.score}</b>
                  </div>
                ))}</div>
              </div>

              {!evidenceMeta?.preferredDirectCount && evidenceMeta?.searchFallbackCount ? <div className="status-banner warning">{t.prepPage.scrapeDisabled}</div> : null}
              {evidenceMeta?.warnings?.length ? <div className="status-banner warning">{t.prepPage.scrapeWarnings}: {evidenceMeta.warnings.join(' | ')}</div> : null}
            </div>

            <div className="section-block">
              <h4>{t.prepPage.questionsTitle}</h4>
              <div className="qa-list">{pack.answerDrafts?.map((item, index) => (
                <article className="qa-item" key={`${item.cluster}-${index}`}>
                  <div className="qa-head">
                    <span className="pill solid">{item.cluster}</span>
                    {item.supportingEvidence?.length ? <span className="mini-note">{item.supportingEvidence.length} evidence matched</span> : null}
                  </div>
                  <h5>{item.question}</h5>
                  <p><strong>{t.prepPage.whyAsked}:</strong> {item.whyAsked}</p>
                  <p><strong>{t.prepPage.strategy}:</strong> {item.answerStrategy}</p>
                  <div className="answer-box">
                    <strong>{t.prepPage.sampleAnswer}</strong>
                    <p>{item.sampleAnswer}</p>
                  </div>
                  <div className="link-row">
                    {item.supportingEvidence?.map((ref, idx) => ref.url ? <a className="link-pill" key={`${ref.label}-${idx}`} href={ref.url} target="_blank" rel="noreferrer">{ref.label}</a> : null)}
                  </div>
                </article>
              ))}</div>
            </div>

            <div className="section-block">
              <h4>{t.prepPage.risksTitle}</h4>
              <div className="risk-list">{pack.resumeRisks?.map((item, index) => (
                <article className="risk-item" key={`${item.resumePoint}-${index}`}>
                  <strong>{item.resumePoint}</strong>
                  <p>{item.risk}</p>
                  <small>{item.fix}</small>
                </article>
              ))}</div>
            </div>

            <div className="section-block">
              <h4>{t.prepPage.roundTitle}</h4>
              {pack.roundPlan?.map((round) => (
                <article className="round-card" key={round.round}>
                  <strong>{round.round}</strong>
                  <p>{round.focus}</p>
                  <ul className="bullet-list">{round.questions?.map((question) => <li key={question}>{question}</li>)}</ul>
                </article>
              ))}
            </div>

            <div className="section-block">
              <h4>{t.prepPage.cheatTitle}</h4>
              <div className="info-card emphasis-card">
                <strong>{pack.cheatSheet?.selfIntro}</strong>
              </div>
              <div className="content-grid two-up">
                <article className="info-card">
                  <h5>{t.prepPage.storyAnchors}</h5>
                  <ul className="bullet-list">{pack.cheatSheet?.storyAnchors?.map((item) => <li key={item}>{item}</li>)}</ul>
                </article>
                <article className="info-card">
                  <h5>{t.prepPage.actions}</h5>
                  <ul className="bullet-list">{pack.cheatSheet?.mustRemember?.map((item) => <li key={item}>{item}</li>)}</ul>
                </article>
              </div>
              <div className="info-card">
                <h5>{t.prepPage.summaryLabel}</h5>
                <ul className="bullet-list">{pack.cheatSheet?.closingQuestions?.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
          </div>
        )}
      </ShellCard>
    </div>
  )
}

function EvidencePage({ t, insights, pack, scrapeState, crawlerStatus, language }) {
  const directCount = insights.filter((item) => item.referenceUrl).length
  const fallbackCount = insights.filter((item) => !item.referenceUrl && item.referenceSearchUrl).length
  const rewriteRows = buildRewriteRows(scrapeState)
  const currentCrawlerStatus = scrapeState?.crawlerStatus || crawlerStatus

  return (
    <div className="page-grid one-column">
      <ShellCard title={t.evidencePage.title} subtitle={t.evidencePage.subtitle}>
        {(currentCrawlerStatus?.sources || []).length ? (
          <div className="section-block">
            <h4>{t.evidencePage.statusTitle}</h4>
            <div className="source-status-grid">
              {currentCrawlerStatus.sources.map((source) => <SourceStatusCard key={source.key || source.source} source={source} t={t} language={language} />)}
            </div>
          </div>
        ) : null}

        {rewriteRows.length ? <RewriteNote rows={rewriteRows} t={t} /> : null}

        {pack?.evidence?.meta?.warnings?.length ? <div className="status-banner warning">{t.evidencePage.warnings}: {pack.evidence.meta.warnings.join(' | ')}</div> : null}

        {insights.length ? (
          <>
            <div className="status-row">
              <span className="pill solid">{directCount} {t.evidencePage.directBadge}</span>
              <span className="pill">{fallbackCount} {t.evidencePage.fallbackBadge}</span>
            </div>
            {fallbackCount ? <div className="status-banner warning">{t.evidencePage.fallbackMode}</div> : null}
            <div className="evidence-grid">{insights.map((item, index) => (
              <article className="evidence-card" key={`${item.title || item.question}-${index}`}>
                <div className="evidence-top">
                  <span className="pill solid">{item.source}</span>
                  <span className={`pill ${item.referenceUrl ? 'subtle' : 'danger'}`}>{item.referenceUrl ? t.evidencePage.directBadge : t.evidencePage.fallbackBadge}</span>
                  {item.pageType ? <span className="pill">{t.evidencePage.pageType}: {item.pageType}</span> : null}
                  {item.score ? <span className="pill">{t.evidencePage.score}: {item.score}</span> : null}
                </div>
                <h4>{item.title || item.question}</h4>
                {item.snippet ? <p className="snippet-copy">{item.snippet}</p> : <p>{item.question}</p>}
                {item.whyMatched ? <small><span className="mini-label">{t.evidencePage.whyMatched}</span>{item.whyMatched}</small> : null}
                {item.notes && item.notes !== item.snippet && item.notes !== item.whyMatched ? <small>{item.notes}</small> : null}
                {item.matchedKeywords?.length ? (
                  <div className="pill-row">
                    {item.matchedKeywords.map((keyword) => <span key={keyword} className="pill subtle">{keyword}</span>)}
                  </div>
                ) : null}
                <div className="link-row">
                  {item.referenceUrl ? <a href={item.referenceUrl} target="_blank" rel="noreferrer" className="link-pill">{t.sourceOpen}</a> : null}
                  {item.referenceSearchUrl ? <a href={item.referenceSearchUrl} target="_blank" rel="noreferrer" className="link-pill">{t.sourceSearch}</a> : null}
                </div>
              </article>
            ))}</div>
          </>
        ) : <p className="empty-copy">{t.evidencePage.noData}</p>}
      </ShellCard>
    </div>
  )
}

function ReviewPage({ t, feedback, setFeedback, feedbackState, onSubmit }) {
  return (
    <div className="page-grid one-column">
      <ShellCard title={t.reviewPage.title} subtitle={t.reviewPage.subtitle}>
        <form className="form-grid" onSubmit={onSubmit}>
          <Field label={t.company}><input value={feedback.company} onChange={(e) => setFeedback({ ...feedback, company: e.target.value })} /></Field>
          <Field label={t.role}><input value={feedback.role} onChange={(e) => setFeedback({ ...feedback, role: e.target.value })} /></Field>
          <Field label={t.interviewType}><input value={feedback.interviewType} onChange={(e) => setFeedback({ ...feedback, interviewType: e.target.value })} /></Field>
          <Field label={t.reviewPage.style}><input value={feedback.style} onChange={(e) => setFeedback({ ...feedback, style: e.target.value })} /></Field>
          <Field label={t.reviewPage.difficulty}><input value={feedback.difficulty} onChange={(e) => setFeedback({ ...feedback, difficulty: e.target.value })} /></Field>
          <Field label={t.reviewPage.notes} full><textarea rows="5" value={feedback.notes} onChange={(e) => setFeedback({ ...feedback, notes: e.target.value })} /></Field>
          <Field label={t.reviewPage.askedQuestions} full><textarea rows="10" value={feedback.askedQuestions} onChange={(e) => setFeedback({ ...feedback, askedQuestions: e.target.value })} /></Field>
          <div className="actions-row full">
            <button className="primary-button">{t.reviewPage.submit}</button>
            {feedbackState === 'submitted' ? <span className="status-inline success">{t.feedbackSaved}</span> : null}
            {feedbackState === 'error' ? <span className="status-inline error">{t.feedbackFailed}</span> : null}
          </div>
        </form>
      </ShellCard>
    </div>
  )
}

function AppInner() {
  const [form, setForm] = useState(defaultForm)
  const [resumePaste, setResumePaste] = useState('')
  const [resumeProfile, setResumeProfile] = useState(null)
  const [insights, setInsights] = useState([])
  const [pack, setPack] = useState(null)
  const [scrapeState, setScrapeState] = useState(null)
  const [crawlerStatus, setCrawlerStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [parseError, setParseError] = useState('')
  const [feedback, setFeedback] = useState(defaultFeedback)
  const [feedbackState, setFeedbackState] = useState('')
  const [bootstrap, setBootstrap] = useState(defaultBootstrap)

  const t = useMemo(() => copy[form.language], [form.language])

  async function refreshBootstrap() {
    try {
      const response = await fetch(apiUrl('/api/interview/workspace/bootstrap'))
      const json = await response.json()
      const next = json.data || defaultBootstrap
      setBootstrap(next)
      if (next.crawlerStatus) setCrawlerStatus(next.crawlerStatus)
    } catch {
      setBootstrap(defaultBootstrap)
    }
  }

  async function refreshCrawlerStatus() {
    try {
      const response = await fetch(apiUrl('/api/interview/crawler/status'))
      const json = await response.json()
      if (json.ok) setCrawlerStatus(json.data)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!form.company.trim() || !form.role.trim()) {
      setInsights([])
      return
    }

    fetch(apiUrl(`/api/interview/insights?company=${encodeURIComponent(form.company)}&role=${encodeURIComponent(form.role)}&interviewType=${encodeURIComponent(form.interviewType)}&language=${encodeURIComponent(form.language)}`))
      .then((response) => response.json())
      .then((data) => setInsights(data.data?.matches || []))
      .catch(() => setInsights([]))
  }, [form.company, form.role, form.interviewType, form.language])

  useEffect(() => {
    refreshBootstrap()
    refreshCrawlerStatus()
  }, [])

  async function handleGenerate(event) {
    event.preventDefault()
    setLoading(true)
    setGenerateError('')

    try {
      const payload = {
        ...form,
        resume: form.resume || resumeProfile?.rawText || ''
      }

      const res = await fetch(apiUrl('/api/interview/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const json = await res.json()
      if (!res.ok || !json.ok || !json.data) throw new Error(json.message || t.errors.generate)

      setPack(json.data)
      setScrapeState(json.scrape || null)
      setInsights(json.data?.evidence?.items || json.retrieval?.matches || [])
      if (json.resumeProfile) {
        setResumeProfile(json.resumeProfile)
        setForm((prev) => ({ ...prev, resume: json.resumeProfile.rawText || payload.resume }))
      }
      if (json.scrape?.crawlerStatus) setCrawlerStatus(json.scrape.crawlerStatus)
      setFeedback((prev) => ({ ...prev, company: payload.company, role: payload.role, interviewType: payload.interviewType }))
      await refreshBootstrap()
    } catch (error) {
      setPack(null)
      setGenerateError(error.message || t.errors.generate)
    } finally {
      setLoading(false)
    }
  }

  async function handleFeedbackSubmit(event) {
    event.preventDefault()
    setFeedbackState('submitting')

    try {
      const res = await fetch(apiUrl('/api/interview/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...feedback,
          askedQuestions: feedback.askedQuestions.split('\n').map((question) => question.trim()).filter(Boolean)
        })
      })
      if (!res.ok) throw new Error('Feedback failed')
      setFeedbackState('submitted')
      setFeedback(defaultFeedback)
      await refreshBootstrap()
    } catch {
      setFeedbackState('error')
    }
  }

  function switchLanguage(language) {
    setForm((prev) => ({ ...prev, language }))
    setPack(null)
    setGenerateError('')
    setParseError('')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">IN</div>
          <div>
            <h1>{t.brand}</h1>
            <p>{t.tagline}</p>
          </div>
        </div>
        <PageNav t={t} />
        <LanguageSwitch language={form.language} onChange={switchLanguage} t={t} />
      </aside>

      <div className="content-shell">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage t={t} pack={pack} insights={insights} bootstrap={bootstrap} />} />
          <Route path="/resume" element={<ResumePage t={t} form={form} setForm={setForm} resumeProfile={resumeProfile} setResumeProfile={setResumeProfile} resumePaste={resumePaste} setResumePaste={setResumePaste} parseError={parseError} setParseError={setParseError} />} />
          <Route path="/prep" element={<PrepPage t={t} form={form} setForm={setForm} resumeProfile={resumeProfile} pack={pack} insights={insights} scrapeState={scrapeState} crawlerStatus={crawlerStatus} loading={loading} generateError={generateError} onGenerate={handleGenerate} onDownloadDoc={() => downloadCheatSheetDoc({ form, pack, resumeProfile })} />} />
          <Route path="/evidence" element={<EvidencePage t={t} insights={insights} pack={pack} scrapeState={scrapeState} crawlerStatus={crawlerStatus} language={form.language} />} />
          <Route path="/review" element={<ReviewPage t={t} feedback={feedback} setFeedback={setFeedback} feedbackState={feedbackState} onSubmit={handleFeedbackSubmit} />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}
