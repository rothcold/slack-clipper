# Slack Clipper

Use the npm scripts in `package.json`. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npm run lint:firefox`. The Chinese [README](README.md) covers loading and manual checks.

Keep extraction in `src/page.ts` isolated from the settings store and transport. Do not use real webhook credentials or contact Slack in tests. Browser QA requires a new disposable profile. Never add retries or a send-on-save path.

Revise this file when meaningful changes affect the project structure, checks, or safety constraints.
