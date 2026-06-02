# 16 — Production Readiness Audit (MCP-Driven)

## Overview

This specification defines the **autonomous QA and production readiness workflow** for the multi-tenant AI customer-support SaaS. The audit is executed by an autonomous senior full-stack QA + production readiness engineer using **three mandatory MCP tools** plus standard testing infrastructure.

> **Role**: Autonomous QA Lead + Senior Architect
> **Mode**: Continuous test → diagnose → fix → retest → repeat
> **Exit Criteria**: Zero critical issues; all features production-ready

---

## Mandatory MCP Tools

| MCP | Purpose | When to Use |
|-----|---------|-------------|
| **chrome-devtools-mcp** | Frontend inspection: console errors, network failures, hydration issues, performance, accessibility, responsive/mobile, auth/session, broken UI states | Every page load, every user flow, every component interaction |
| **PaddleMCP** | Billing/subscription verification: products, plans, checkout, lifecycle events, webhooks, cancellations, upgrades, downgrades | All billing-related flows and edge cases |
| **MongoMCP** | Database operations: collection inspection, schema validation, index verification, data consistency, relationship integrity, query safety | All CRUD operations, data integrity checks, migration validation |

---

## 1. Application Launch & Infrastructure Verification

### 1.1 Pre-Launch Checks

```
[ ] All 4 apps start successfully: web (3000), widget (3001), embed (3002), api (4000)
[ ] MongoDB connection established (MongoMCP: verify connection)
[ ] Redis connection established (if configured)
[ ] Pinecone client initialized
[ ] Socket.io server attached to HTTP server
[ ] Environment variables validated (Joi schema, no missing required vars)
[ ] Health check endpoint responds: GET /health → 200
[ ] Docker Compose services running (MongoDB + Redis)
```

### 1.2 Infrastructure Inspection (MongoMCP)

```
[ ] List all collections and verify against spec (§03):
    - organizations, users, memberships, websites, agents
    - contactSessions, conversations, messages
    - knowledgeSources, widgetSettings, subscriptions, sections
[ ] Verify all indexes exist per collection (§03 index specs)
[ ] Verify TTL index on contactSessions.expiresAt
[ ] Verify unique indexes: users.email, organizations.slug, contactSessions.token
[ ] Verify compound indexes for query performance
[ ] Check for orphaned documents (references to non-existent parents)
[ ] Verify organizationId field exists on all org-scoped collections
```

---

## 2. Frontend Page Testing (chrome-devtools-mcp)

### 2.1 General Page Audit (Apply to EVERY page)

For each page visited, use chrome-devtools-mcp to check:

```
[ ] Zero console errors (no uncaught exceptions, no React hydration mismatches)
[ ] Zero network failures (all API calls return expected status codes)
[ ] No hydration warnings ("Text content did not match", "Extra attributes")
[ ] Performance: LCP < 2.5s, FID < 100ms, CLS < 0.1
[ ] Accessibility: proper ARIA labels, keyboard navigation, color contrast
[ ] Responsive: test at 320px, 768px, 1024px, 1440px widths
[ ] No broken images or missing assets
[ ] All interactive elements have unique IDs
[ ] No memory leaks (monitor heap size across page transitions)
```

### 2.2 Marketing / Public Pages

| Page | Route | Checks |
|------|-------|--------|
| Landing | `/` | Loads without errors; demo widget embedded; CTAs link correctly; SEO meta present |
| Pricing | `/pricing` | Plans render correctly; Paddle checkout triggers work; plan comparison accurate |
| Features | `/features` | Content renders; images load; responsive layout |

### 2.3 Auth Pages

| Page | Route | Checks |
|------|-------|--------|
| Login | `/login` | Form validation (Joi rules); error messages display; Google OAuth flow; successful login redirects to `/app`; JWT stored correctly |
| Register | `/register` | Creates user + org + membership (verify via MongoMCP); email validation; password strength check; duplicate email → 409 |
| Forgot Password | `/forgot-password` | Email sent (check API response); reset link works; new password saved (MongoMCP: verify hash changed) |
| Email Verify | `/verify-email` | Token validation; emailVerifiedAt updated (MongoMCP) |

### 2.4 Dashboard Pages (Protected)

| Page | Route | Key Checks |
|------|-------|------------|
| Dashboard Home | `/app` | Overview cards show real data; recent conversations list; analytics summary |
| **Inbox** | `/app/inbox` | Conversation list loads; status filters (active/escalated/resolved); website filter; real-time updates via Socket.io; unread indicators; search works |
| **Thread View** | `/app/inbox/[id]` | Full message history; all message types render (customer/AI/operator/system); reply composer works; ✨ Enhance button → preview → accept/revert; resolve/escalate/reopen buttons; contact sidebar shows session info; auto-scroll on new message |
| **Knowledge Base** | `/app/knowledge` | Source list with type icons and status badges; create text source; upload file (PDF/DOCX/etc); website crawl via Firecrawl; edit; delete with confirmation; embedding status indicator; retry failed embeddings |
| KB Detail | `/app/knowledge/[id]` | Source content preview; chunk list; embedding status; edit/delete actions |
| Widget Settings | `/app/widget` | Color picker; position selector; avatar upload; live preview; save persists to API |
| Websites | `/app/websites` | CRUD; embed code generator; allowed origins; domain validation |
| Analytics | `/app/analytics` | Overview cards accurate; charts render (conversations over time, resolution rate); time period filter; website filter |
| Billing | `/app/billing` | Current plan displayed; usage meters; checkout flow (PaddleMCP); portal link; upgrade/downgrade |
| Settings | `/app/settings` | Org name update; user profile; timezone; danger zone |
| Leads | `/app/leads` | Contact session list; email/phone display; filter by website; filter by has-email; link to conversation. Reads `GET /contacts` (org-scoped via JWT `organizationId`). |
| Team | `/app/team` | Member list; invite (email sent); role change; remove; pending invitations |
| Developers | `/app/developers` | Embed code snippets (HTML/React/Next.js); copy-to-clipboard; API configuration |

### 2.5 Widget Pages (iframe)

| Component | Checks |
|-----------|--------|
| Embed Script | `widget.js` loads from `apps/embed`; creates floating button; button click opens iframe; `data-*` attributes consumed correctly |
| Widget Shell | State machine transitions: loading → pre-chat → chat → contact → resolved (per §09) |
| Pre-Chat Screen | Greeting message renders; suggested questions display; input works |
| Chat Window | Messages render by type; auto-scroll; timestamps |
| Composer | Text input; emoji picker toggle; file attachment trigger |
| Contact Form | Validation; submit updates session (MongoMCP: verify); dismiss works |
| Resolved Screen | Shows when conversation resolved; option to start new |
| Typing Indicator | Animated dots appear during AI processing |
| File Attachment | Upload works; MIME validation; size limits; display in thread |
| Session Persistence | localStorage token survives page refresh; history loads on reopen |
| Session Expiry | After 24h (simulated) → new session → fresh conversation |

### 2.6 Deleted/Removed Items

```
[ ] /app/chat route does NOT exist (returns 404)
[ ] "Live Chat" does NOT appear in sidebar navigation
[ ] "Live Chat" does NOT appear anywhere in the UI
```

---

## 3. Backend API Testing

### 3.1 Authentication Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/auth/register` | POST | Valid registration → 201 + user + org + membership (MongoMCP verify); duplicate email → 409; weak password → 400; missing fields → 400 |
| `/auth/login` | POST | Valid credentials → 200 + JWT; wrong password → 401; non-existent email → 401; missing fields → 400 |
| `/auth/google` | POST | Valid Google token → 200 + user; **new user → auto-creates `Organization` + owner `Membership` so token carries `organizationId`**; existing user → returns existing org. Without this every subsequent protected request 403s with `No organization context in token`. |
| `/auth/refresh` | POST | Valid JWT → new token; expired JWT → 401; malformed JWT → 401 |

### 3.2 Organization Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/orgs/current` | GET | Returns org for authenticated user; no token → 401 |
| `/orgs/current` | PATCH | Owner can update; admin can update; agent → 403; viewer → 403 |
| `/orgs/current/members` | GET | Lists members; respects org scope |
| `/orgs/current/members/invite` | POST | Sends invite; duplicate → 409; invalid role → 400 |
| `/orgs/current/members/:userId` | PATCH | Role change works; owner can't be downgraded by admin |
| `/orgs/current/members/:userId` | DELETE | Owner only; can't remove sole owner |

### 3.3 Website Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/websites` | GET | Lists org websites; org-scoped |
| `/websites` | POST | Creates website; duplicate domain → 409 |
| `/websites/:id` | PATCH | Updates; validates origin format |
| `/websites/:id` | DELETE | Owner only; cascades to conversations |

### 3.4 Agent Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/agents` | GET | Lists org agents; org-scoped |
| `/agents` | POST | Creates agent; validates fields |
| `/agents/:id` | PATCH | Updates config; systemPromptOverride persists |
| `/agents/:id` | DELETE | Owner only |

### 3.5 Conversation Routes (Dashboard)

| Route | Method | Test Cases |
|-------|--------|------------|
| `/conversations` | GET | Lists with pagination; status filter; websiteId filter; assignedTo filter; sort by lastMessageAt |
| `/conversations/:id` | GET | Returns conversation + contact + website; wrong org → 404 |
| `/conversations/:id/status` | PATCH | active→resolved; active→escalated; escalated→resolved; resolved→active (reopen); invalid transition → 400; Socket.io events fire |
| `/conversations/:id/assign` | PATCH | Sets assignedOperatorId; Socket.io event fires |

### 3.6 Message Routes (Dashboard)

| Route | Method | Test Cases |
|-------|--------|------------|
| `/conversations/:id/messages` | GET | Paginated thread; cursor-based `before` filter |
| `/conversations/:id/messages` | POST | Operator message saved; Socket.io `message:new` fires; lastMessageAt updated |
| `/messages/enhance` | POST | Enhancement returns polished text; preserves intent; rate-limited |

### 3.7 Knowledge Base Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/knowledge` | GET | Lists sources; type filter; status filter; org-scoped |
| `/knowledge` | POST | Text source; contentHash generated; duplicate → 409 |
| `/knowledge/upload` | POST | PDF, DOCX, Excel, CSV, Image, HTML; MIME validation via magic bytes; size limit; extraction pipeline |
| `/knowledge/website` | POST | Firecrawl integration; async 202; job tracking |
| `/knowledge/:id` | GET | Source detail; includes chunks if synced |
| `/knowledge/:id` | PUT | Re-hash; delete old vectors; re-embed |
| `/knowledge/:id` | DELETE | MongoDB record + Pinecone vectors + storage file deleted (verify via MongoMCP) |

### 3.8 Widget Routes (Public)

| Route | Method | Test Cases |
|-------|--------|------------|
| `/widget/sessions` | POST | New session → 201 + token; resume with valid token → 200 + conversations; expired token → new session; CORS origin validated |
| `/widget/sessions/:id/contact` | POST | Updates email/name/phone on session (MongoMCP verify); session token required |
| `/widget/conversations` | POST | Creates conversation; saves initial message; triggers AI agent; Socket.io events |
| `/widget/conversations/:id/messages` | GET | Session-scoped; pagination |
| `/widget/conversations/:id/messages` | POST | Customer message saved; AI responds (if status=active); no AI if escalated |
| `/widget/conversations/:id/attachments` | POST | File upload; MIME check; size limit (10MB) |
| `/widget/settings` | GET | Returns widget settings + agent info + sections; public endpoint |

### 3.9 Billing Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/billing/paddle/webhook` | POST | Signature verification; all event types handled (PaddleMCP simulate); idempotency |
| `/billing/subscription` | GET | Returns current plan + usage |
| `/billing/checkout` | POST | Generates checkout URL (PaddleMCP verify) |
| `/billing/portal` | POST | Generates portal URL (PaddleMCP verify) |

### 3.10 Admin Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/admin/organizations` | GET | Platform admin only; non-admin → 403; lists all orgs |
| `/admin/stats` | GET | Platform admin only; returns aggregate stats |

### 3.11 Analytics Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/analytics/overview` | GET | Accurate aggregation; websiteId filter; period filter |
| `/analytics/conversations` | GET | Time-series data; granularity param |

### 3.12 Other Routes

| Route | Method | Test Cases |
|-------|--------|------------|
| `/widget-settings/:agentId` | GET/PUT | CRUD; org-scoped |
| `/sections/:agentId` | GET/POST | CRUD; reorder via `order` field |
| `/sections/:sectionId` | PATCH/DELETE | Update / remove section |
| `/contacts` | GET | Contact sessions with email/phone; `websiteId` + `email` filters (the leads page in the dashboard reads this endpoint) |

---

## 4. Cross-Cutting Concerns

### 4.1 Organization-Level RLS (Row-Level Security)

**Test pattern**: Create 2 orgs (A, B) via MongoMCP or API. Verify zero data leakage.

```
[ ] Org A user cannot see Org B conversations
[ ] Org A user cannot see Org B messages
[ ] Org A user cannot see Org B KB sources
[ ] Org A user cannot see Org B websites
[ ] Org A user cannot see Org B agents
[ ] Org A user cannot see Org B contact sessions
[ ] Org A user cannot see Org B widget settings
[ ] Org A user cannot see Org B subscriptions
[ ] Org A user cannot see Org B sections
[ ] Widget session for Org A cannot access Org B conversation
[ ] Pinecone namespace isolation: Org A search returns zero Org B results
```

### 4.2 Rate Limiting

```
[ ] Dashboard: 100 req/min per user → 429 on exceed
[ ] Widget: 30 req/min per session → 429 on exceed
[ ] Auth: 10 req/min per IP on login/register → 429 on exceed
[ ] Enhancement: 30 per operator per hour → 429 on exceed
[ ] AI messages: per-org monthly cap based on plan → auto-escalate on exceed
```

### 4.3 Socket.io Real-Time Events

```
[ ] message:new fires on customer message → received in widget + dashboard
[ ] message:new fires on AI response → received in widget + dashboard
[ ] message:new fires on operator reply → received in widget
[ ] conversation:status fires on resolve/escalate/reopen
[ ] conversation:updated fires for inbox list updates
[ ] conversation:new fires when new conversation starts
[ ] conversation:assigned fires on operator assignment
[ ] typing:indicator fires on typing start/stop
[ ] contact:updated fires when contact info updated
[ ] Auth: dashboard socket requires valid JWT
[ ] Auth: widget socket requires valid session token
[ ] Reconnection works after network interruption
[ ] Room authorization: cannot join other org's rooms
```

### 4.4 Error Handling

```
[ ] 400 on validation errors (with clear messages)
[ ] 401 on missing/invalid auth tokens
[ ] 403 on insufficient permissions
[ ] 404 on non-existent resources
[ ] 409 on duplicate content (KB hash, email, domain)
[ ] 429 on rate limit exceeded
[ ] 500 on unhandled errors (with requestId for debugging)
[ ] Error response format matches spec: { error: { code, message, details? } }
```

---

## 5. Database Audit (MongoMCP)

### 5.1 Schema Validation

For each collection, verify via MongoMCP:

```
[ ] All required fields present on all documents
[ ] Field types match spec (ObjectId refs, strings, dates, arrays, objects)
[ ] No null/undefined values on required fields
[ ] Enum fields contain only valid values:
    - organizations.plan: free/starter/pro/enterprise
    - memberships.role: owner/admin/agent/viewer
    - memberships.status: active/pending/revoked
    - conversations.status: active/escalated/resolved/expired
    - messages.role: customer/ai/operator/system
    - messages.senderType: contact/user/ai/system
    - knowledgeSources.type: text/pdf/docx/excel/csv/image/html/website
    - knowledgeSources.embeddingStatus: pending/processing/synced/error/deleting
    - subscriptions.status: active/trialing/past_due/canceled/paused
```

### 5.2 Index Verification

```
[ ] organizations: { slug: 1 } unique; { paddleCustomerId: 1 } unique sparse
[ ] users: { email: 1 } unique; { provider: 1, providerId: 1 } unique sparse
[ ] memberships: { userId: 1, organizationId: 1 } unique; { organizationId: 1, role: 1 }; { userId: 1, status: 1 }
[ ] websites: { organizationId: 1 }; { organizationId: 1, domain: 1 } unique
[ ] agents: { organizationId: 1 }
[ ] contactSessions: { token: 1 } unique; { organizationId: 1, websiteId: 1 }; { expiresAt: 1 } TTL; { organizationId: 1, email: 1 }
[ ] conversations: { threadId: 1 } unique; { organizationId: 1, status: 1, lastMessageAt: -1 }; { organizationId: 1, websiteId: 1, status: 1 }; { contactSessionId: 1 }; { organizationId: 1, assignedOperatorId: 1 }
[ ] messages: { conversationId: 1, createdAt: 1 }; { organizationId: 1, createdAt: -1 }; { conversationId: 1, role: 1 }
[ ] knowledgeSources: { organizationId: 1, contentHash: 1 } unique; { organizationId: 1, type: 1 }; { organizationId: 1, embeddingStatus: 1 }; { embeddingStatus: 1, retryCount: 1 }
[ ] widgetSettings: { organizationId: 1, agentId: 1 } unique
[ ] subscriptions: { organizationId: 1 } unique; { paddleSubscriptionId: 1 } unique; { status: 1 }
[ ] sections: { organizationId: 1, agentId: 1, order: 1 }
```

### 5.3 Data Integrity

```
[ ] All ObjectId references point to existing documents
[ ] No orphaned messages (conversationId → valid conversation)
[ ] No orphaned conversations (contactSessionId → valid session OR expired)
[ ] No orphaned memberships (userId → valid user; organizationId → valid org)
[ ] Every conversation has at least one message
[ ] Every organization has at least one membership with role=owner
[ ] contactSessions.expiresAt is always in the future (for active sessions)
[ ] knowledgeSources with embeddingStatus=synced have non-empty pineconeIds
[ ] subscriptions.organizationId matches organizations._id
```

### 5.4 Query Performance

```
[ ] Inbox query uses index: { organizationId: 1, status: 1, lastMessageAt: -1 }
[ ] Message thread query uses index: { conversationId: 1, createdAt: 1 }
[ ] Session lookup uses index: { token: 1 }
[ ] KB listing uses index: { organizationId: 1, type: 1 }
[ ] No collection scans on pagination queries (explain plans)
```

---

## 6. Billing & Subscription Audit (PaddleMCP)

### 6.1 Product & Plan Configuration

```
[ ] Products exist in Paddle: Free, Starter, Pro, Enterprise
[ ] Price IDs match environment variables
[ ] Plan limits configured correctly:
    - Free: 100 AI msg/month, 20 KB sources
    - Starter: 2,000 AI msg/month, 100 KB sources
    - Pro: 10,000 AI msg/month, 500 KB sources
    - Enterprise: Unlimited
```

### 6.2 Checkout Flow

```
[ ] POST /billing/checkout generates valid Paddle checkout URL
[ ] Checkout link opens Paddle overlay correctly
[ ] Test card completes purchase → webhook fires → subscription created
[ ] MongoMCP: verify subscription record created with correct plan/status
[ ] MongoMCP: verify organization.plan updated
```

### 6.3 Subscription Lifecycle

```
[ ] subscription.created → DB subscription + org plan updated
[ ] subscription.updated → plan change reflected in DB
[ ] subscription.canceled → status=canceled; features downgraded
[ ] subscription.past_due → status=past_due; warning shown in dashboard
[ ] transaction.completed → payment recorded
```

### 6.4 Upgrade/Downgrade

```
[ ] Upgrade: Starter → Pro → limits increase immediately
[ ] Downgrade: Pro → Starter → limits reduce at period end
[ ] Cancel: plan remains active until period end → then reverts to free
```

### 6.5 Plan Limit Enforcement

```
[ ] Free plan: AI messages capped at 100/month → auto-escalate after limit
[ ] Free plan: KB sources capped at 20 → cannot create more
[ ] Starter plan: limits enforced correctly
[ ] Pro plan: higher limits work
[ ] Enterprise: unlimited works
```

### 6.6 Webhook Security

```
[ ] Paddle-Signature header verified on every webhook
[ ] Invalid signature → rejected (not processed)
[ ] Idempotency: duplicate webhook with same event ID → no duplicate DB writes
[ ] All webhook event types handled (no unhandled events logged as errors)
```

### 6.7 Billing UI

```
[ ] Current plan displayed correctly
[ ] Usage meters (AI messages used / limit, KB sources used / limit)
[ ] Customer portal link works (PaddleMCP verify)
[ ] Upgrade/downgrade buttons trigger correct Paddle actions
[ ] Invoice history accessible
```

---

## 7. Security Review

### 7.1 Authentication Vulnerabilities

```
[ ] JWT secret is ≥256-bit random (not a weak string)
[ ] JWT expiration: access=15min, refresh=7days
[ ] bcrypt cost factor ≥ 12
[ ] Password policy enforced (min 8 chars, 1 upper, 1 number)
[ ] Google OAuth: id_token verified with Google public keys; aud checked
[ ] Brute-force protection: 5 failed attempts → 15-min lockout
[ ] Session token (widget) is UUID v4, cryptographically random
[ ] Expired session tokens rejected immediately
```

### 7.2 API Security

```
[ ] CORS locked to specific origins (no wildcard * in production)
[ ] Helmet middleware enabled with production CSP headers
[ ] Rate limiting on all route groups
[ ] No API keys in client bundles (chrome-devtools-mcp: inspect bundle)
[ ] Widget CORS validated against website.allowedOrigins
[ ] Paddle webhook signature verification enabled
[ ] SSRF protection on Firecrawl URL input (block private IPs)
```

### 7.3 Database Security

```
[ ] organizationId never accepted from request body (always from JWT)
[ ] Mongoose parameterized queries only (no string concatenation)
[ ] No global queries without org scope (except platform admin)
[ ] File upload MIME validated via magic bytes (file-type package)
[ ] Filename sanitized (no path traversal ../; UUID-based storage names)
```

### 7.4 Input Validation

```
[ ] Joi validation on ALL routes (no route without schema validation)
[ ] Max field lengths enforced: name(100), email(255), message(10,000), title(200)
[ ] File upload size limits enforced per plan
[ ] XSS prevention: DOMPurify on frontend render of user content
[ ] Message content sanitized before storage
[ ] URL validation for Firecrawl (format + SSRF block)
```

### 7.5 Secret Management

```
[ ] .env files in .gitignore
[ ] NEXT_PUBLIC_ prefix only on truly public values
[ ] Winston loggers redact /key|secret|token|password/i
[ ] No sensitive data in console.log or client-facing errors
```

---

## 8. Performance Review (chrome-devtools-mcp)

### 8.1 Frontend Performance

```
[ ] Widget load time: First Contentful Paint < 1.5s
[ ] Embed script size: widget.js < 15KB gzipped
[ ] Dashboard pages: LCP < 2.5s
[ ] No unnecessary re-renders (React DevTools profiler)
[ ] Bundle size reasonable (no oversized dependencies)
[ ] Images optimized (Next.js Image component or equivalent)
[ ] Code splitting active (dynamic imports for heavy pages)
```

### 8.2 API Performance

```
[ ] CRUD responses: p95 < 200ms
[ ] AI response: p95 < 2s (excluding LLM latency)
[ ] Inbox query with 1000+ conversations: < 500ms
[ ] Message thread with 500+ messages: pagination < 200ms
[ ] KB list with 100+ sources: < 200ms
[ ] File upload processing: < 10s for 5MB PDF
```

### 8.3 Socket.io Performance

```
[ ] Connection establishment: < 1s
[ ] Message delivery latency: < 200ms (server → client)
[ ] 50+ concurrent connections stable (no memory leaks)
[ ] Reconnection time: < 3s after network interruption
```

### 8.4 Database Performance (MongoMCP)

```
[ ] No collection scans on indexed queries
[ ] Aggregation queries for analytics complete in < 1s
[ ] TTL index actively cleaning expired sessions
[ ] Connection pool not exhausted under normal load
```

---

## 9. AI Agent Testing

### 9.1 Core Agent Behavior

```
[ ] Customer message → AI responds (status=active)
[ ] AI searches KB before answering product questions
[ ] AI admits when KB has no relevant info + offers escalation
[ ] AI uses resolveConversation tool when customer satisfied
[ ] AI uses escalateConversation tool when human requested
[ ] AI stays silent when conversation.status = escalated
[ ] AI resumes when resolved conversation gets new customer message
[ ] Conversation history maintained (context-aware follow-ups)
[ ] System prompt assembled correctly (all 6 layers per §05)
[ ] systemPromptOverride appended from agent config
```

### 9.2 Tool Execution

```
[ ] search tool: queries correct Pinecone namespace (orgId)
[ ] search tool: returns formatted KB results
[ ] resolveConversation tool: updates DB + emits Socket.io + system message
[ ] escalateConversation tool: updates DB + emits Socket.io + system message
[ ] Tool results fed back to LLM for final response
```

### 9.3 Enhancement LLM (§06)

```
[ ] Enhance endpoint polishes text without changing intent
[ ] Conversation history included as context
[ ] Tone parameter works (professional/friendly/empathetic/concise)
[ ] Rate-limited: 30/operator/hour, 200/org/hour
[ ] Original and enhanced text both stored on message record
```

### 9.4 Quota Enforcement

```
[ ] AI messages counted correctly per org per month
[ ] Free plan: 101st message → auto-escalate, system message
[ ] Quota resets on new billing month
```

---

## 10. E2E User Journey Verification

### Journey 1: Customer Chat Flow (Widget → API → AI)

```
1. [ ] Load page with embed script → floating button appears
2. [ ] Click button → widget iframe opens
3. [ ] Type first message → send → AI responds in real time
4. [ ] Contact form slides in after first AI response
5. [ ] Enter email + name → submit (MongoMCP: verify session updated)
6. [ ] Continue conversation → AI responds with KB-informed answers
7. [ ] AI calls resolveConversation → "Resolved" screen appears
8. [ ] Refresh page → session persists → history loads
9. [ ] Clear localStorage → new session → no old history
```

### Journey 2: Operator Inbox Flow

```
1. [ ] Login with credentials → redirects to /app
2. [ ] Navigate to /app/inbox → customer conversation visible
3. [ ] Click conversation → thread view opens
4. [ ] Read full message history (customer + AI + system messages)
5. [ ] Type reply → click "✨ Enhance" → preview → accept → send
6. [ ] Enhanced message appears in widget in real time
7. [ ] Click "Resolve" → conversation marked resolved → system message
8. [ ] Customer sends new message → startes a new chat (no conversation reopens) → inbox updated
```

### Journey 3: Knowledge Base CRUD

```
1. [ ] Navigate to /app/knowledge
2. [ ] "Add Source" → select "Text" → enter content → save
3. [ ] Source appears with "Synced" badge (MongoMCP: verify pineconeIds populated)
4. [ ] Upload same text → "Duplicate content" error (contentHash dedup)
5. [ ] Upload PDF → "Processing" badge → eventually "Synced"
6. [ ] Edit text source → re-embed (MongoMCP: verify new hash + pineconeIds)
7. [ ] Delete source → Pinecone vectors removed (MongoMCP: verify record deleted)
8. [ ] AI chat → ask about KB content → AI returns relevant answer
9. [ ] AI chat → ask about non-KB content → AI admits it doesn't know and offers to escalate
```

### Journey 4: Session Identity Verification

```
1. [ ] Widget: start conversation → AI responds
2. [ ] Provide email in contact form
3. [ ] Close and reopen widget → same session, same conversation
4. [ ] Refresh page → same session token → same conversation
5. [ ] Clear localStorage → new session → no old history
6. [ ] New conversation → distinct from previous
7. [ ] CRITICAL: old conversation NOT loaded by email lookup
```

### Journey 5: Workspace Filtering

```
1. [ ] Create 2 websites (Website A, Website B)
2. [ ] Start widget conversation on Website A
3. [ ] Start widget conversation on Website B
4. [ ] Inbox (all websites) → both conversations visible
5. [ ] Select "Website A" → only Website A conversations shown
6. [ ] Analytics filtered to Website A only
7. [ ] Switch to "All" → both visible
```

### Journey 6: Billing Flow

```
1. [ ] Verify current plan (free)
2. [ ] Click "Upgrade to Starter" → Paddle checkout opens
3. [ ] Complete payment (PaddleMCP: simulate)
4. [ ] Webhook fires → subscription created (MongoMCP: verify)
5. [ ] Plan limits updated → higher AI message cap
6. [ ] Customer portal accessible
7. [ ] Cancel subscription → status updated → features downgrade at period end
```

---

## 11. Audit Behavior Protocol

### Continuous Testing Loop

```
while (issues_exist) {
  1. TEST the next feature/page/flow
  2. INSPECT using appropriate MCP tool
  3. IF issue found:
     a. DIAGNOSE root cause
     b. FIX immediately (do not ask permission)
     c. RETEST the fix
     d. VERIFY via MCP (chrome-devtools: no errors; MongoMCP: data correct; PaddleMCP: billing correct)
  4. CONTINUE to next test
}
```

### Fix Classification

| Severity | Response | Examples |
|----------|----------|---------|
| 🔴 Critical | Fix immediately, block release | Data leakage, auth bypass, payment errors, data loss |
| 🟠 High | Fix before release | Broken user flows, incorrect data, missing validation |
| 🟡 Medium | Fix if time allows | UX issues, performance problems, missing error messages |
| 🟢 Low | Document for next sprint | Cosmetic issues, minor UX polish |

### Verification After Fix

Every fix must be verified:
1. **Retest the exact scenario** that exposed the bug
2. **Run regression** on related functionality
3. **Inspect via MCP** (no new console errors, correct DB state, correct billing state)

---

## 12. Final Deliverable Format

### 12.1 Production Readiness Summary

```
- Overall app status: [READY / NOT READY / READY WITH CAVEATS]
- Critical risks: [list]
- Launch readiness score: [1-10]
```

### 12.2 Implemented Features (verified production-ready)

| Feature | Status | Verified Via |
|---------|--------|-------------|
| [feature] | ✅ Working | [chrome-devtools / MongoMCP / PaddleMCP / manual] |

### 12.3 Poorly Implemented Features

For each:
- Issue description
- Risk level (critical/high/medium/low)
- Recommended fix
- Affected frontend/backend areas
- Was fix applied? (yes/no/partial)

### 12.4 Not Implemented Features

| Category | Feature | Spec Reference | Priority |
|----------|---------|---------------|----------|
| Frontend | [feature] | §[X] | [high/medium/low] |
| Backend | [feature] | §[X] | [high/medium/low] |
| Infra | [feature] | §[X] | [high/medium/low] |

### 12.5 Bugs Found and Fixed

For each bug:
- Root cause
- Files changed
- Fixes applied
- Verification performed (which MCP + what was checked)

### 12.6 Security Review Results

- Auth vulnerabilities: [list]
- API security issues: [list]
- DB exposure risks: [list]
- Missing validation: [list]
- Secret/environment concerns: [list]

### 12.7 Performance Review Results

- Slow pages: [list with metrics]
- Unnecessary renders: [list]
- API bottlenecks: [list with response times]
- DB inefficiencies: [list]
- Frontend optimization opportunities: [list]

### 12.8 Final Production Checklist

```
[x] Completed items
[ ] Remaining blockers
→  Recommended next priorities (ordered)
```

---

> **Cross-references**: [§03 Data Model](./03-data-model.md) · [§05 AI Agent](./05-ai-agent-design.md) · [§07 API Spec](./07-api-specification.md) · [§08 Socket.io](./08-socketio-design.md) · [§09 Widget State Machine](./09-widget-state-machine.md) · [§12 Security](./12-security-compliance.md) · [§14 Testing Strategy](./14-testing-strategy.md)
