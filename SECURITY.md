# Security

- The Gemini API key lives only in server environment variables (Vercel → Settings → Environment Variables). It is sent to Google in a request header, never in a URL, and never reaches the browser. `.env` is git-ignored.
- Every request is validated on the server: dates, hours, subject names, up to 8 subjects, syllabus up to 2,000 characters, and a 32 KB body limit (96 KB for re-planning). Bad input gets a clear 400 message.
- Prompt-injection defence: the syllabus is wrapped in `<<< >>>` and the system prompt says to treat it as data only; the delimiter characters are rejected in input.
- The AI can only act through four tools. Every tool argument is cleaned and clamped (topic hours 0.5–8, unknown subjects dropped, at most 4 schedule builds), and dates are always computed by the scheduler, never by the AI.
- Strict Content Security Policy (no inline scripts, no third-party hosts, no framing) plus HSTS, nosniff, Referrer-Policy and Permissions-Policy headers on every response.
- The browser only renders AI text with `textContent` (checked by a test).
- A per-IP rate limit (8 plans a minute) protects the free AI quota.
- No accounts and no database: the plan is stored only in the student's own browser (localStorage).

Found a problem? Please contact the author through https://github.com/omshiva24.
