function slimEvidenceItems(items = []) {
  return items.slice(0, 8).map((item) => ({
    source: item.source,
    title: item.title,
    question: item.question,
    notes: item.notes,
    snippet: item.snippet || '',
    referenceUrl: item.referenceUrl || item.url || '',
    referenceSearchUrl: item.referenceSearchUrl || item.searchUrl || '',
    isDirectSource: Boolean(item.isDirectSource || item.referenceUrl || item.url),
    matchedKeywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords : [],
    score: Number(item.score || 0),
    pageType: item.pageType || 'unknown',
    whyMatched: item.whyMatched || '',
    kind: item.kind || (item.referenceUrl || item.url ? 'direct' : 'search')
  }))
}

function slimRetrieval(retrieval = {}) {
  return {
    matches: slimEvidenceItems(retrieval.matches || []),
    liveEvidence: slimEvidenceItems(retrieval.liveEvidence || []),
    feedback: (retrieval.feedback || []).slice(0, 8),
    meta: retrieval.meta || {},
    liveScrape: retrieval.liveScrape
      ? {
        enabled: Boolean(retrieval.liveScrape.enabled),
        status: retrieval.liveScrape.status || '',
        warnings: retrieval.liveScrape.warnings || [],
        results: slimEvidenceItems(retrieval.liveScrape.results || [])
      }
      : null
  }
}

export function buildInterviewPrompt(input, retrieval, resumeProfile) {
  const { company, role, jd, resume, interviewType, language = 'zh' } = input
  const retrievalSummary = slimRetrieval(retrieval)

  return `
You are building a serious consumer SaaS interview-preparation output.
Return JSON only.
Target language: ${language === 'zh' ? 'Chinese' : 'English'}.
Every user-visible string must be fully in the target language. Never mix Chinese and English in the same sentence unless a company name, role title, platform name, or URL requires it.

Candidate context:
- Company: ${company}
- Role: ${role}
- Interview type: ${interviewType}
- JD:\n${jd}
- Resume raw text:\n${resume}
- Resume parsed profile:\n${JSON.stringify(resumeProfile, null, 2)}

Retrieved interview evidence:
${JSON.stringify(retrievalSummary, null, 2)}

Required output shape:
{
  "meta": {"company": string, "role": string, "interviewType": string, "language": string, "generatedWith": string},
  "fitReview": {
    "overallScore": number,
    "summary": string,
    "matchedKeywords": string[],
    "missingKeywords": string[],
    "keywordMap": [{"keyword": string, "matched": boolean, "evidence": string}],
    "dimensions": [{"label": string, "score": number, "reason": string, "evidence": string[]}],
    "strengths": string[],
    "gaps": string[],
    "nextActions": string[]
  },
  "evidence": {
    "styleSummary": string,
    "items": [{"source": string, "title": string, "question": string, "style": string, "notes": string, "snippet": string, "referenceUrl": string, "referenceSearchUrl": string, "isDirectSource": boolean, "matchedKeywords": string[], "score": number, "pageType": string, "whyMatched": string, "kind": string}],
    "meta": {"directCount": number, "searchFallbackCount": number, "liveEnabled": boolean, "warnings": string[]}
  },
  "answerDrafts": [{
    "cluster": string,
    "question": string,
    "whyAsked": string,
    "answerStrategy": string,
    "sampleAnswer": string,
    "supportingEvidence": [{"label": string, "url": string}]
  }],
  "resumeRisks": [{"resumePoint": string, "risk": string, "fix": string}],
  "roundPlan": [{"round": string, "focus": string, "questions": string[]}],
  "cheatSheet": {
    "selfIntro": string,
    "mustRemember": string[],
    "storyAnchors": string[],
    "closingQuestions": string[]
  }
}

Rules:
- This must feel more useful than a generic AI response.
- Suggested answers must reference the user's actual resume evidence and the JD.
- The sample answers should be concise, but concrete enough to rehearse from.
- If there is no direct referenceUrl, keep it empty. Do not invent URLs.
- Do not treat email, phone, school name, degree title, GPA, coursework list, or city as a weak resume line unless malformed.
- Resume risks should focus on experience, project, leadership, or achievement statements that are likely to trigger follow-up.
- Organize questions logically. Avoid dumping many disconnected questions.
- Prioritize depth over quantity.
- Prefer direct evidence sources whose pageType is post/detail/discussion and whose score is high.
- If there is a direct post/detail URL, cite that first. Only use referenceSearchUrl when there is no trustworthy direct evidence page.
- Do not cite landing pages, product pages, interview centers, AI mock pages, or generic search pages as interview evidence.
`
}

function slimAnswerEvidence(items = []) {
  return items.slice(0, 4).map((item) => ({
    source: item.source,
    title: item.title || item.question || '',
    snippet: item.snippet || item.notes || '',
    whyMatched: item.whyMatched || '',
    referenceUrl: item.referenceUrl || item.url || '',
    referenceSearchUrl: item.referenceSearchUrl || item.searchUrl || '',
    pageType: item.pageType || 'unknown',
    score: Number(item.score || 0),
    kind: item.kind || (item.referenceUrl || item.url ? 'direct' : 'search')
  }))
}

export function buildAnswerPrompt(input, {
  question,
  answerLanguage = input.language || 'zh',
  answerLength = 'standard',
  tone = 'natural',
  resumeProfile = {},
  questionPlan = {},
  evidence = []
} = {}) {
  const languageName = answerLanguage === 'zh' ? 'Chinese' : 'English'
  const answerEvidence = slimAnswerEvidence(evidence)

  return `
You are an interview answer coach for a serious consumer SaaS product.
Return JSON only.
Target language: ${languageName}.
Tone: ${tone}.
Target answer length: ${answerLength}.

Candidate context:
- Company: ${input.company}
- Role: ${input.role}
- Interview type: ${input.interviewType}
- Output language: ${answerLanguage}
- JD:\n${input.jd}
- Resume raw text:\n${input.resume}
- Resume parsed profile:\n${JSON.stringify(resumeProfile, null, 2)}

Interview question:
${JSON.stringify({
  question,
  questionPlan
}, null, 2)}

Supporting evidence:
${JSON.stringify(answerEvidence, null, 2)}

Return this exact shape:
{
  "question": string,
  "language": string,
  "tone": string,
  "fullAnswer": string,
  "shortAnswer": string,
  "answerStructure": string[],
  "followUps": string[],
  "risks": string[],
  "evidenceUsed": [{"label": string, "url": string, "kind": string}],
  "notes": string
}

Rules:
- Use only facts grounded in the user's resume, JD, and supporting evidence.
- Never invent employers, projects, metrics, ownership, or tools that are not supported by the provided context.
- If the evidence is thin, use cautious wording and explicitly note what detail should be clarified.
- The full answer should sound like a spoken interview answer, not a written essay.
- The short answer should be a crisp 30-60 second version.
- The answer structure should help the user memorize the flow, not repeat the full answer sentence by sentence.
- Follow-ups should be realistic interviewer follow-up angles.
- Risks should be concrete and honest. If there is no major risk, return one short reassuring line instead of fabricating problems.
- Prefer direct evidence URLs when available. Only fall back to search URLs when no direct source is available.
`
}
