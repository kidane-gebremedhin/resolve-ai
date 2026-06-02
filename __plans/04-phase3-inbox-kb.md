# Phase 3 — Inbox, Knowledge Base, Operator Tools

## Goal

Operators have a working inbox: a real-time conversation list (`/app/inbox`) and a thread view (`/app/inbox/[conversationId]`) with reply composer, ✨ Enhance button, resolve/escalate/reopen, and contact sidebar. The KB pipeline is end-to-end: text / PDF / DOCX / Excel / CSV / HTML / image uploads chunk + embed into Pinecone; Firecrawl ingests entire websites; the AI agent's `search_kb` tool returns real results. Widget Studio (`/app/widget`) wires the template controls to the backend.

## Prerequisites

- Phase 2 green (widget end-to-end, Socket.io)
- Pinecone serverless index created; `PINECONE_API_KEY` + `PINECONE_INDEX` set
- Firecrawl account; `FIRECRAWL_API_KEY` set
- `ENHANCE_MODEL` env var set (defaults to `openai/gpt-4o-mini`)
- File storage destination configured (MinIO/local for dev; S3 for staging+)

## Skills to invoke

- [[__skills/pinecone-kb-pipeline]] — full KB CRUD with Pinecone sync (steps 1–4)
- [[__skills/firecrawl-website-ingestion]] — website crawl bridge (step 5)
- [[__skills/socketio-realtime]] (Phase 2) — inbox + thread real-time (steps 7–8)
- [[__skills/widget-embed-iframe]] (Phase 2) — widget UI now reads real widget-settings (step 9)
- [[__skills/webapp-testing]] (downloaded) — verification

## Work breakdown (ordered)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | KB service layer + file parsers + content hash + chunker + embedding service | `apps/api/src/services/kb/{kb,ingestion,chunker}.service.ts`, `apps/api/src/services/ai/embedding.service.ts`, `apps/api/src/utils/{content-hash,chunker,file-parsers}.ts` | `pinecone-kb-pipeline` | Unit tests pass for content-hash determinism + chunk boundaries |
| 2 | KB routes (`GET`/`POST`/`GET :id`/`PUT :id`/`DELETE :id`/`POST /upload`/`POST /website`) | `apps/api/src/routes/kb.routes.ts`, `apps/api/src/controllers/kb.controller.ts` | `pinecone-kb-pipeline` | All endpoints return correct status; spec §16 §3.7 |
| 3 | Pinecone delete-on-update + delete-on-source-delete | `services/kb/kb.service.ts` | `pinecone-kb-pipeline` | `mongo-mcp` + Pinecone MCP confirm cascade |
| 4 | Reconciliation job for failed embeddings | `apps/api/src/jobs/embedding-sync.job.ts` | `pinecone-kb-pipeline` | After simulating an embed API 500, retry promotes to `synced` |
| 5 | Firecrawl service + `POST /knowledge/website` + polling job + SSRF protection | `apps/api/src/services/kb/firecrawl.service.ts`, `apps/api/src/jobs/firecrawl-ingest.job.ts` | `firecrawl-website-ingestion` | Spec §16 §3.7 acceptance; private IP rejected with 400 |
| 6 | `agent.service.ts` wires `search_kb` tool → Pinecone query in org namespace | `apps/api/src/services/ai/agent.service.ts` | `pinecone-kb-pipeline` | Widget query referencing seeded KB returns AI reply citing source |
| 7 | Operator inbox `/app/inbox`: filters (status / website / assigned), unread badges, search, workspace switcher, Socket.io live updates | `apps/web/src/app/(dashboard)/app/inbox/page.tsx`, `apps/web/src/hooks/{use-inbox,use-workspace}.ts` | `socketio-realtime` (existing) | Spec §11 inbox row + §16 §2.4 inbox row |
| 8 | Thread view `/app/inbox/[conversationId]`: message list (all 4 roles), composer, ✨ Enhance preview/accept/revert, resolve/escalate/reopen, assign, contact sidebar | `apps/web/src/app/(dashboard)/app/inbox/[conversationId]/page.tsx`, `apps/web/src/components/dashboard/inbox/*` | `socketio-realtime` | Spec §16 §2.4 thread row |
| 9 | `POST /messages/enhance` endpoint per spec §06 (separate `ENHANCE_MODEL`, rate-limited 30/op/h) | `apps/api/src/routes/message.routes.ts` (enhance handler), `apps/api/src/services/ai/enhance.service.ts` | `pinecone-kb-pipeline` (similar pattern) | Spec §16 §3.6 enhance test |
| 10 | KB UI `/app/knowledge`: list with type icons + status badges; create text source; upload file; ingest website; edit; delete with confirmation; retry button on failed | `apps/web/src/app/(dashboard)/app/knowledge/page.tsx`, `apps/web/src/components/dashboard/knowledge/*` | `pinecone-kb-pipeline` + `firecrawl-website-ingestion` | Spec §11 KB row |
| 11 | KB detail view `/app/knowledge/[sourceId]`: content preview, chunk list, status, edit/delete | `apps/web/src/app/(dashboard)/app/knowledge/[sourceId]/page.tsx` | `pinecone-kb-pipeline` | Spec §11 KB detail row |
| 12 | Widget Studio `/app/widget` (template page already exists): wire 3-tab controls panel + live preview to `GET/PUT /widget-settings/:agentId` + sections CRUD (`GET/POST /sections/:agentId`, `PATCH/DELETE /sections/:id`) | `apps/web/src/app/(dashboard)/app/widget/page.tsx`, `apps/web/src/components/dashboard-pages/widget-studio-client.tsx`, `apps/api/src/routes/widget-settings.routes.ts`, `apps/api/src/routes/section.routes.ts` | `pinecone-kb-pipeline` (similar pattern for settings CRUD) | Live preview reflects edits; spec §11 widget row. Note: section routes live in `section.routes.ts` (singular), not `sections.routes.ts`. |
| 13 | Leads view `/app/leads`: wire template to `GET /contacts`; filter by website + has-email; link to conversation history | `apps/web/src/app/(dashboard)/app/leads/page.tsx`, `apps/web/src/components/dashboard-pages/leads-client.tsx`, `apps/api/src/routes/contact.routes.ts` | (no skill — straight CRUD using existing patterns) | Spec §11 leads row. Note: there is no `/leads` route; the dashboard page reads `GET /contacts` which returns `ContactSession` docs (email + phone). |
| 14 | Developers page `/app/developers` (new — not in template): embed code snippets (HTML/React/Next.js) with copy-to-clipboard | `apps/web/src/app/(dashboard)/app/developers/page.tsx`, `apps/web/src/components/dashboard/developers/*` | (no skill) | Per spec §11 developers row |

## Verification

- [ ] Upload a 5-page PDF: text extracted → chunked (verify count via API) → vectors in Pinecone (verify via Pinecone MCP) → `embeddingStatus: 'synced'`
- [ ] Re-upload the same PDF → 409 with `code: 'KB_DUPLICATE'`
- [ ] Edit the source's text → old Pinecone vectors removed, new ones upserted
- [ ] Delete the source → Mongo row gone, Pinecone vectors gone, raw file gone
- [ ] Create a website source pointing at `https://docs.<some-real-site>.com` → polling completes; pages ingested; queries return results
- [ ] Cross-org isolation: create the same source in Org B → succeeds (different namespace)
- [ ] Operator opens `/app/inbox`; widget customer sends new message → row appears live, unread badge increments
- [ ] Operator opens thread → sends reply → appears in widget instantly
- [ ] Operator clicks ✨ Enhance → preview pane shows polished text; accept → sends polished version; revert → restores original
- [ ] Operator clicks Resolve → conversation status changes; widget shows resolved screen
- [ ] Widget Studio: change accent color → preview pane updates immediately; save → reload widget on demo page → new color applied
- [ ] `mongo-mcp`: full data integrity audit per spec §16 §5
- [ ] `chrome-devtools-mcp`: zero console errors on `/app/inbox`, `/app/inbox/[id]`, `/app/knowledge`, `/app/widget`, `/app/leads`, `/app/developers`
- [ ] [`webapp-testing`](../__skills/webapp-testing/) Playwright: end-to-end operator workflow (sign in → open inbox → open thread → reply → resolve)
- [ ] [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md) §3.7 (KB) + §2.4 (dashboard pages) — green
- [ ] `csb-staging` Coolify project deployed and smoke-tested (this is the right moment, since most ops features now exist)

## Out of scope (defer to later phase)

- Paddle billing + plan limits (Phase 4)
- Admin panel routes (Phase 4)
- Analytics charts wired to real data (Phase 4)
- Audio notifications + TTS (Phase 4)
- `/app/team` separate route (kept as sub-tab inside Settings — see spec §11)
