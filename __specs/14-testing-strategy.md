# 14 — Testing Strategy

## Overview

Three-tier testing pyramid: **unit → integration → end-to-end (E2E)**. All tests are required to pass in CI before merge. Coverage target: 80% for backend services, 70% for frontend components.

---

## 0. No test may call a third party

**Tests cost nothing and pass with the network unplugged.** This is enforced,
not asked for: `apps/api/src/test/no-external-calls.ts`, installed by both
suites' setup files before any other module loads.

### Why it needs enforcing

`config/env.ts` does `import "dotenv/config"`, and `apps/api/.env` is a symlink
to the repository root `.env`. A developer's **real** OpenRouter, embedding,
Pinecone and Firecrawl keys are therefore present under vitest. Nothing warned
about this, and the consequences were already live:

- `knowledge-conflict.test.ts`'s two integration cases reached OpenRouter on
  every run. They passed on a good day and failed when a balance ran out — and
  the failure read as a conflict-detection bug, not a billing one.
- Every ingestion test embedded through the real provider.
- A `402 requires more credits` was, for a while, indistinguishable from a
  genuine regression.

### The two layers

**1. Scrub the credentials.** Every provider in this codebase already has a
no-key path — pseudo-embeddings, a no-op Pinecone index, a disabled crawler, a
mailer that skips. Removing the keys makes the suite take those paths.

Order matters and is easy to get wrong: dotenv only fills in variables that are
**absent**, so deleting a key *before* dotenv loads simply invites dotenv to put
it back. The guard imports `dotenv/config` itself first, which makes
`config/env.ts`'s later import a module-cache no-op.

Deleted rather than blanked, because several call sites read
`process.env.X ?? "fallback"`: an empty string is not nullish and would be sent
as the key.

**2. Guard the socket anyway.** Layer 1 rests on every current *and future*
service checking for its key first. That is a convention, and a convention is
not what a test suite should rest on when the failure mode is a bill. `fetch` is
wrapped; anything bound for a host other than the loopback throws
`ExternalCallInTestError` naming the URL and how to stub it.

### What is scrubbed

LLM and embeddings (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
`EMBEDDING_API_KEY`), the vector store (`PINECONE_API_KEY`, `PINECONE_INDEX`),
crawling (`FIRECRAWL_API_KEY`), voice (`TTS_API_KEY`, `STT_API_KEY`), billing
(`PADDLE_API_KEY`), object storage (`MINIO_*`, `AWS_*`), mail (`SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS`), telemetry that phones home (`SENTRY_DSN`,
`LANGSMITH_API_KEY`), messaging (`TWILIO_AUTH_TOKEN`), and `REDIS_URL`.

`PADDLE_WEBHOOK_SECRET` is deliberately **kept**: it signs payloads locally,
reaches no network, and the billing tests need it.

### Writing a test that needs a provider

Inject or mock. In order of preference:

1. **Inject the dependency.** `understoodSearch` accepts a `reranker` and
   `conflictDeps`; `checkForConflict` accepts `deps.invoke`; `clusterGaps`
   accepts `deps.embed`. This is the pattern to extend — it makes the test
   hermetic by design rather than by interception.
2. **Mock the module.**

   ```ts
   vi.mock("../services/ai/llm/chat-model.js", () => ({ createChatModel: () => stub }));
   vi.mock("../config/pinecone.js", () => ({ getPineconeIndex: () => fakeIndex }));
   vi.mock("../services/ai/embedding.service.js", () => ({ embed: async (t) => t.map(...) }));
   ```

A stand-in should **derive** its verdict from its input where it can, rather
than returning a constant: the conflict judge in `knowledge-conflict.test.ts`
reads the day counts out of the passages it is shown, so a fixture that stops
containing a contradiction stops being flagged as one.

### The guard checks itself

`apps/api/src/__tests__/no-external-calls.test.ts` and the matching file in
`packages/rag-eval` assert that representative provider URLs are refused, that
the error message is actionable, that the loopback still works, that **every**
guarded credential is absent, and that the no-key paths actually function
(embeddings return deterministic vectors; the Pinecone index is a no-op).

A guarantee nothing checks is a comment.

---

## 1. Unit Tests

### Backend (`apps/api`)

**Framework**: Jest + ts-jest  
**Run**: `pnpm --filter api test:unit`

| Module | What to Test | Mocking |
|--------|-------------|---------|
| **Joi schemas** | Valid/invalid payloads for every route | None (pure functions) |
| **Auth service** | Password hash/verify, JWT sign/verify, token expiry | bcrypt, jsonwebtoken (real logic, mock DB) |
| **Org context middleware** | Attaches `req.orgId`, rejects missing org | Mock `req`, `res`, `next` |
| **Conversation service** | Status transitions (active→escalated→resolved), reopen logic | Mock Mongoose models |
| **Message service** | Create message, update conversation metadata | Mock Mongoose models |
| **Contact session service** | Create session, validate token, expiry check, contact update | Mock Mongoose models |
| **KB service** | Content hash generation, dedup check, MIME validation | Mock Mongoose, Pinecone client |
| **Chunking service** | Text splitting (overlap, max chunk size) | None (pure function) |
| **Enhancement service** | Prompt construction, response parsing | Mock LLM client |
| **AI agent service** | Tool call detection, system prompt assembly, streaming | Mock LLM client |
| **Rate limit middleware** | Correct headers, 429 on exceeded | Mock express-rate-limit store |
| **File parsers** | PDF→text, DOCX→text, CSV→text, HTML→Markdown | Mock file buffers |

### Frontend (`apps/web`)

**Framework**: Vitest + React Testing Library  
**Run**: `pnpm --filter web test:unit`

| Component | What to Test |
|-----------|-------------|
| **Auth forms** | Validation, error display, submit handlers |
| **Inbox list** | Render conversations, status badges, filter controls |
| **Thread view** | Message rendering (customer/AI/operator/system), auto-scroll |
| **Enhance button** | Toggle enhanced/original text, loading state |
| **KB upload form** | File type validation, size check, progress indicator |
| **Widget settings form** | Color picker, position selector, live preview data flow |
| **Sidebar** | Active link highlighting, unread badge, no "Live Chat" link |
| **Workspace switcher** | Dropdown renders websites, selection updates context |

### Widget (`apps/widget`)

**Framework**: Vitest + React Testing Library  
**Run**: `pnpm --filter widget test:unit`

| Component | What to Test |
|-----------|-------------|
| **WidgetShell** | State machine transitions (loading → pre-chat → chat → contact → resolved) |
| **ChatWindow** | Message list rendering, auto-scroll behavior |
| **Composer** | Text input, emoji picker toggle, file attachment trigger |
| **ContactForm** | Validation, submit, skip/dismiss |
| **SessionManager** | localStorage read/write, expiry detection |

---

## 2. Integration Tests

### Backend API Integration

**Framework**: Jest + Supertest  
**Database**: MongoDB in-memory (`mongodb-memory-server`)  
**Run**: `pnpm --filter api test:integration`

#### Test Suites

| Suite | Description | Key Scenarios |
|-------|-------------|---------------|
| **Auth flow** | Register → login → JWT → protected route | Register creates org + membership; login returns valid JWT; expired JWT returns 401 |
| **Conversation lifecycle** | Create → message → escalate → resolve → reopen | Full status transition chain; system messages on status change |
| **Widget session flow** | Create session → start conversation → send/receive messages | Session creation, token validation, 24h expiry simulation |
| **Contact update** | Session → message → update contact info | Contact info stored on session; available in inbox contact sidebar |
| **KB CRUD + Pinecone** | Create text KB → verify hash → update → re-hash → delete → verify vector cleanup | ContentHash dedup (409 on duplicate); Pinecone vectors created/deleted |
| **Org RLS isolation** | Two orgs, verify no cross-access | Org A cannot read Org B's conversations, KB, messages, or sessions |
| **Role authorization** | Viewer cannot delete KB; agent cannot invite members | Each role tested against forbidden operations |
| **WebSocket events** | Message creation → Socket.io emission | Verify `message:new` and `conversation:status` events fire correctly |
| **Enhancement LLM** | Send draft + context → enhanced response | Verify previous messages included; enhanced text returned |
| **Paddle webhooks** | Simulate `subscription.created` → verify DB update | Plan updated on org; subscription record created |
| **File upload** | Upload PDF → text extracted → hash generated | Verify file stored, text extracted, embedding queued |
| **Rate limiting** | Exceed limit → 429 | Widget and dashboard limits tested separately |

#### Multi-Org RLS Test Pattern

```typescript
describe('Organization Isolation', () => {
  let orgA, orgB, userA, userB, tokenA, tokenB;
  
  beforeAll(async () => {
    // Create two separate orgs with users
    orgA = await createOrg('Org A');
    orgB = await createOrg('Org B');
    userA = await createUser(orgA);
    userB = await createUser(orgB);
    tokenA = signJwt(userA);
    tokenB = signJwt(userB);
    
    // Seed data in both orgs
    await seedConversation(orgA);
    await seedKnowledgeBase(orgA);
  });
  
  it('User B cannot access Org A conversations', async () => {
    const res = await request(app)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.body.conversations).toHaveLength(0);
  });
  
  it('User B cannot access Org A KB sources', async () => {
    const res = await request(app)
      .get('/api/v1/knowledge')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.body.sources).toHaveLength(0);
  });
  
  // ... more isolation tests
});
```

---

## 3. End-to-End (E2E) Tests

### Framework

- **Tool**: Playwright
- **Run**: `pnpm test:e2e`
- **Requirements**: All 4 apps running (`pnpm dev`), MongoDB seeded

### Critical User Journeys

#### Journey 1: Customer Chat Flow (Widget)

```
1. Load page with embed script
2. Click floating widget button → widget opens
3. Type first message → send
4. AI response appears in real time
5. Contact form slides in after first AI response
6. Enter email + name → submit
7. Continue conversation with AI
8. AI calls resolveConversation tool → "Resolved" screen appears
9. Refresh page → session token still in localStorage → conversation history loads
10. After 24h (simulated) → session expired → new session on next visit
```

#### Journey 2: Operator Inbox Flow (Dashboard)

```
1. Login with credentials (or Google OAuth)
2. Navigate to /app/inbox
3. See customer conversation from Journey 1
4. Click conversation → thread view opens
5. Read full message history (customer + AI messages)
6. Type reply → click "✨ Enhance" → preview enhanced text → accept
7. Send enhanced message → appears in widget in real time
8. Click "Resolve" → conversation marked resolved → system message shown
9. Customer sends new message → conversation reopens → notification in inbox
```

#### Journey 3: Knowledge Base CRUD (Dashboard)

```
1. Navigate to /app/knowledge
2. Click "Add Source" → select "Text" → enter content → save
3. Verify source appears in list with "Synced" badge
4. Upload same text again → "Duplicate content" error (contentHash dedup)
5. Upload PDF file → source appears with "Processing" badge → eventually "Synced"
6. Edit text source → content changes → embedding re-synced
7. Delete source → confirm → source removed → verify Pinecone vectors deleted
8. Enter website URL → click "Crawl" → pages ingested → source appears
9. Start conversation in widget → ask question about KB content → AI returns relevant answer
```

#### Journey 4: Session Identity (Widget)

```
1. Open widget → start conversation → receive AI response
2. Provide email + name in contact form
3. Close widget → reopen → conversation history still there (same session)
4. Refresh page → same session token → same conversation
5. Clear localStorage → reopen widget → new session → no old conversation history
6. Start new conversation → distinct from previous
7. VERIFY: old conversation is NOT loaded by email lookup
```

#### Journey 5: Workspace Filtering (Dashboard)

```
1. Login → create 2 websites (Website A, Website B)
2. Start widget conversation on Website A
3. Start widget conversation on Website B
4. Dashboard inbox (all websites) → shows both conversations
5. Select "Website A" in workspace switcher → only Website A conversations shown
6. Analytics filtered to Website A only
7. Switch back to "All websites" → both visible again
```

---

## 4. Performance Tests (Phase 4)

| Test | Tool | Target |
|------|------|--------|
| API response time | k6 / Artillery | p95 < 200ms for CRUD; p95 < 2s for AI response |
| Widget load time | Lighthouse | First Contentful Paint < 1.5s |
| Socket.io concurrent connections | k6 WebSocket | 500 concurrent connections per instance |
| KB ingestion throughput | Custom script | 100 pages crawled in < 5 minutes |
| Embed script size | Bundlesize | `widget.js` < 15 KB gzipped |

---

## 5. CI Pipeline

```yaml
# .github/workflows/ci.yml (conceptual)
stages:
  - lint:        pnpm lint (ESLint + Prettier)
  - type-check:  pnpm type-check (TypeScript)
  - unit:        pnpm test:unit (Jest/Vitest, all apps)
  - integration: pnpm --filter api test:integration (MongoDB in-memory)
  - build:       pnpm build (Turborepo, all apps)
  - e2e:         pnpm test:e2e (Playwright, requires running apps)
  - audit:       pnpm audit --audit-level=high
```

### CI Requirements

| Check | Blocking? | Notes |
|-------|-----------|-------|
| ESLint | ✅ | Zero warnings in strict mode |
| TypeScript | ✅ | Zero errors across all apps/packages |
| Unit tests | ✅ | 100% pass rate |
| Integration tests | ✅ | 100% pass rate |
| Build | ✅ | All apps build successfully |
| E2E tests | ✅ | All critical journeys pass |
| Audit | ⚠️ | Warning on high/critical vulns; blocking at maintainer discretion |
| Coverage | ⚠️ | Report generated; 80% backend / 70% frontend target |

---

## 6. QA Manual Script (Pre-Release)

Execute before every production deployment:

```
[ ] Register new account (email/password) → org created
[ ] Login with Google OAuth → same org accessible
[ ] Create website → configure allowed origins
[ ] Start widget conversation → type message → AI responds
[ ] Contact form appears → provide email + name → submit
[ ] Session persists across page refresh (localStorage token)
[ ] Session does NOT load conversation by email (verify: different session, same email → separate conversations)
[ ] Operator opens inbox → sees conversation
[ ] Operator replies → message appears in widget instantly (Socket.io)
[ ] Operator clicks Enhance → text polished → sends enhanced message
[ ] Operator resolves conversation → widget shows resolved state
[ ] Customer sends new message → conversation reopens
[ ] Upload text KB source → verify in Pinecone
[ ] Upload duplicate content → 409 error shown
[ ] Upload PDF → processing → synced
[ ] Delete KB source → Pinecone vectors removed
[ ] Crawl website URL → pages ingested
[ ] Ask AI question about KB content → correct answer with sources
[ ] Ask AI question about non-KB content → honest answer(I don't know) with an option for human escalation.
[ ] Workspace filter: switch between websites → inbox/analytics filtered
[ ] Billing: initiate Paddle checkout → subscription created (sandbox)
[ ] Settings: update org name → reflected across dashboard
[ ] Team: invite member → accept invitation → verify access
[ ] Admin: platform admin views all organizations
[ ] Widget embed script works on external HTML page
```

---

## 7. MCP-Driven Production Readiness Audit

For the full autonomous QA workflow using **chrome-devtools-mcp**, **PaddleMCP**, and **MongoMCP**, see [§16 — Production Readiness Audit](./16-production-readiness-audit.md). That spec covers:

- Continuous test → diagnose → fix → retest protocol
- Frontend page-by-page inspection (console errors, network, hydration, performance, accessibility, responsive)
- Database schema/index/integrity verification via MongoMCP
- Billing flow verification via PaddleMCP
- Security and performance audit checklists
- Structured deliverable format for the audit report
