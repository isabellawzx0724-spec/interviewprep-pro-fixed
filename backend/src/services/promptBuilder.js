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
