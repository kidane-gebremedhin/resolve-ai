# 14 — Testing Strategy

## Overview

Three-tier testing pyramid: **unit → integration → end-to-end (E2E)**. All tests are required to pass in CI before merge. Coverage target: 80% for backend services, 70% for frontend components.

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
