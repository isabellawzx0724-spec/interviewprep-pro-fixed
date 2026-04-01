# Interview Navigator v4

A more productized SaaS-style interview-prep workspace with:

- multi-page app structure (dashboard / resume upload / prep builder / evidence / review)
- resume upload and parsing (PDF / DOCX / TXT)
- stronger fit analysis with multiple scoring dimensions
- tailored answer drafts tied to JD keywords and resume evidence
- evidence library prepared for direct source URLs when crawlers succeed
- post-interview feedback loop and recent-session history

## Important note about Xiaohongshu / Nowcoder crawling

This codebase includes a live-scrape connector layer and URL fields for direct post links, but you still need to enable and validate those connectors yourself in deployment.

Why this is not “guaranteed live” out of the box:

- these sites may require cookies, anti-bot handling, and ongoing maintenance
- site rules / terms may restrict automated access
- crawler behavior depends on your deployment environment and credentials

So this package is honest about the current state:

- if a scraper returns a real page URL, the UI shows an **Open source** button
- if the system only has retrieval/query evidence, it shows **Search source** instead of pretending there is a direct link

## Deploying on your current project

Your existing repo has this structure:

```text
interview_fix/
  backend/
  frontend/
```

Replace the contents of `interview_fix/backend` and `interview_fix/frontend` with the folders from this package, then let Render and Vercel redeploy.
