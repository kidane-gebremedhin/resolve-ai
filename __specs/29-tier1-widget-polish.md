# 29 — Tier 1: Widget Polish (Streaming · Markdown · Citations · Feedback · CSAT · Quick-reply)

> **Status**: Implemented
> **Depends on**: existing `agent.service.ts`, `socket/index.ts`, `MessageList.tsx`, `state-machine.ts`
> **Blocks**: none (all Tier 1 items are self-contained; no new third-party credentials)
> **Implementation plan**: `__plans/13-tier1-widget-polish.md`

### Implementation notes (deltas from spec)
- `KnowledgeSource` already had a `sourceUrl` field — no schema change needed; `search.service.ts` now projects `sourceUrl` into the `KbHit.url` field
- Streaming payload uses `delta` field (not `chunk`): `{conversationId, messageId, delta}`
- State machine field is `inFlight` (camelCase, not `in_flight`)
- `quickReplies` are extracted from the meta-pass JSON (not a separate `parseFinalReply()` call); the instruction is embedded in the meta-pass system message
- `FeedbackControls` renders on all AI messages; `QuickReplies` renders only on the last AI message when no in-flight messages exist
- `CSATCard` is rendered in `ResolvedScreen.tsx` (receives `conversationId` + `sessionToken` from `WidgetRoot`)
- `pnpm build` and `pnpm type-check` both pass green after implementation

### Bug fixes applied post-implementation
- **`quickReplies` schema conflict** — The meta-pass originally used `requireJson: true` which applied `FINAL_REPLY_SCHEMA` (`strict: true`, `additionalProperties: false`, no `quickReplies`). This structurally prevented `quickReplies` from appearing. Fixed by adding `META_PASS_SCHEMA` to `tools.ts` (includes `confidence`, `action`, `quickReplies: anyOf[array|null]`) and adding `responseFormat?: Record<string, unknown>` to `callLlm()`. The meta-pass now passes `responseFormat: META_PASS_SCHEMA` instead of `requireJson: true`. See CHANGELOG_6.md.
- **Markdown in AI responses** — Added markdown formatting instruction to `BASE` in `prompts.ts` and to the streaming final-pass system message in `agent.service.ts`.

---

## Overview

Six independently shippable features that bring the widget to modern-chat parity.
They share no hard ordering, but the recommended sequence is:

1. **1.2 Markdown** (unblocks every other feature's formatted output)
2. **1.1 Streaming** (biggest perceived-performance win)
3. **1.3 Citations** (requires Message model change — ship together with streaming)
4. **1.6 Quick-reply chips** (one prompt + one render change)
5. **1.4 Inline feedback**
6. **1.5 CSAT**

All changes are in `apps/api` and `apps/widget` (and `apps/web` for operator inbox
surfaces). The embed (`apps/embed`) does not change for Tier 1.

---

## 1.1 — Streaming responses

### Problem
AI replies appear as a single all-at-once bubble after `generateAiReply()` finishes
(typically 3–8 s). This reads as unresponsive.

### Design

**Server side — `apps/api/src/services/ai/agent.service.ts`**

Streaming applies only to the **final user-facing pass** — the `toolMode:"none"`,
`requireJson:true` call at the end of the tool loop. The intermediate tool-calling
turns (KB search, escalation checks) remain non-streaming.

```
Decision: structured-JSON vs streaming
───────────────────────────────────────
Current final pass uses requireJson:true to extract {reply, confidence, action}.
Streaming raw tokens conflicts with JSON parsing.

Resolution: separate the prose from the metadata.
  - Remove requireJson from the final pass.
  - Ask the model to stream its prose reply directly.
  - Move confidence + action collection to a tiny trailing JSON frame
    emitted as a separate non-streamed structured call ("meta pass"):
      callLlm({ messages, toolMode:"none", requireJson:true, stream:false })
    using only the last user+assistant turns (not the full history) so it
    is cheap (~200 tokens). The meta pass runs concurrently with the
    socket emission loop.
  - If the meta pass fails, fall back to confidence:null, action:"reply".
```

Implementation steps inside `generateAiReply()`:

1. Replace the single final `callLlm()` with a streaming variant:
   ```typescript
   const stream = await callLlmStream({ messages, toolMode: "none" });
   ```
2. Create a placeholder `Message` in MongoDB immediately (role: "ai",
   content: "", status: "streaming"). Emit `message:new` so the widget
   renders an in-flight bubble.
3. Pipe the SSE chunk stream into a local buffer:
   ```typescript
   let fullText = "";
   for await (const chunk of stream) {
     fullText += chunk;
     io.to(`contact:${contactSessionId}`).emit("message:delta", {
       conversationId, messageId, chunk
     });
   }
   io.to(`contact:${contactSessionId}`).emit("message:done", {
     conversationId, messageId
   });
   ```
4. Update the Message document: `content = fullText`, remove `status:streaming`.
5. Run the meta pass (confidence/action) in parallel with step 3; apply
   action (escalate/resolve) after `message:done`.

**New Socket.io events**

| Event | Payload | Room |
|---|---|---|
| `message:delta` | `{conversationId, messageId, chunk: string}` | `contact:*` |
| `message:done` | `{conversationId, messageId}` | `contact:*`, `org:*`, `conversation:*` |

The existing `message:new` is emitted _before_ the stream starts (with an empty
content body) so the widget can render a bubble immediately. `message:done` is the
signal to finalize rendering (remove typing indicator, enable feedback controls).

**Widget side — `apps/widget/src/components/WidgetRoot.tsx`**

Add listeners:
```typescript
socket.on("message:delta", ({ messageId, chunk }) => {
  dispatch({ type: "MESSAGE_DELTA", messageId, chunk });
});
socket.on("message:done", ({ messageId }) => {
  dispatch({ type: "MESSAGE_DONE", messageId });
});
```

**State machine — `apps/widget/src/lib/state-machine.ts`**

Add `in_flight: Map<string, string>` to the context. `MESSAGE_DELTA` appends
chunks; `MESSAGE_DONE` moves the assembled text into the regular messages array.

**MessageList.tsx rendering**

While a message is in-flight, render its current content from `in_flight` with a
blinking cursor (`::after` CSS animation). On `MESSAGE_DONE`, switch to the normal
message render.

### New helper — `callLlmStream()`

Add alongside the existing `callLlm()` in `agent.service.ts`:

```typescript
async function* callLlmStream(params: {
  messages: ChatMessage[];
  toolMode: "none";
}): AsyncGenerator<string> {
  const response = await fetch(env.ai.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
      temperature: params.temperature,
    }),
    signal: AbortSignal.timeout(env.ai.llmTimeoutMs),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      const json = JSON.parse(line.slice(6));
      const chunk = json.choices?.[0]?.delta?.content;
      if (chunk) yield chunk;
    }
  }
}
```

### Credentials
None — OpenRouter already supports SSE streaming.

### Blockers / user actions required
- **Decision already resolved above**: streaming prose + meta pass.
- No blockers.

### Acceptance
- [ ] AI bubble starts populating within ~300ms of user send.
- [ ] No duplicate bubble appears; `message:new` → grow → `message:done`.
- [ ] `confidence` and `action` still applied correctly (escalate/resolve fires).
- [ ] If stream fails mid-way, the partial text is persisted and `message:done` is
  still emitted (never leave the widget in a stuck state).

---

## 1.2 — Markdown rendering

### Problem
`MessageList.tsx` renders `role === "ai"` content as plain text with
`whitespace-pre-wrap`. Bold, lists, code blocks, and links are not rendered.

### Design

Install in `apps/widget`:
```
react-markdown
remark-gfm
rehype-highlight
rehype-sanitize
```

**`apps/widget/src/components/MessageList.tsx`**

Replace the plain-text AI content block:

```tsx
// Before:
<p className="whitespace-pre-wrap text-sm">{message.content}</p>

// After (ai role only):
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";

{message.role === "ai" ? (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeSanitize, rehypeHighlight]}
    className="prose prose-sm max-w-none"
    components={{
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      ),
    }}
  >
    {message.content}
  </ReactMarkdown>
) : (
  <p className="whitespace-pre-wrap text-sm">{message.content}</p>
)}
```

**CSS scoping**

The widget runs inside an iframe so host-page CSS cannot bleed in, but the widget
does need to load `highlight.js` theme CSS. Import a single highlight theme (e.g.
`github` or `atom-one-dark`) in `apps/widget/src/app/globals.css`, scoped under
`.message-content pre`.

**Bundle size**

`react-markdown` + plugins adds ~40 kB gzipped. Since the widget is already an
iframe (not inline-embedded), this is acceptable. Lazy-load with dynamic import
if the bundle grows beyond 200 kB gzipped:
```typescript
const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });
```

**System prompt alignment**

`prompts.ts` Layer 1 already instructs the model to use Markdown ("Format
responses using Markdown for readability"). No prompt change needed.

### Credentials
None.

### Blockers
None.

### Acceptance
- [ ] AI messages with `**bold**`, `- lists`, `` `code` ``, and `[links]()` render correctly.
- [ ] Customer and operator messages still render as plain text.
- [ ] No host-page CSS interference (verify in an iframe context).
- [ ] `pnpm build` passes for `apps/widget`.

---

## 1.3 — Citations panel

### Problem
`searchKb()` returns `KbHit[]` with `sourceTitle` and `score`, but these are
consumed only inside the LLM prompt and never surface to the customer.

### Design

**Step 1 — Persist sources on the Message**

Add field to `apps/api/src/models/Message.ts`:
```typescript
sources?: Array<{
  sourceId: string;        // KnowledgeSource._id (string, not ObjectId — safe to expose)
  sourceTitle: string;
  url?: string;            // canonical URL if the KB source is a website page
  score: number;           // cosine similarity from Pinecone
}>;
```

**Step 2 — Capture sources in `generateAiReply()`**

After the `search_kb` tool call, accumulate hit results:
```typescript
const usedSources: KbHit[] = [];

// Inside tool dispatch:
case "search_kb": {
  const hits = await searchKb(...);
  usedSources.push(...hits.filter(h => !usedSources.find(u => u.sourceId === h.sourceId)));
  break;
}

// When persisting the AI Message:
await Message.create({
  ...aiMessageFields,
  sources: usedSources.slice(0, 5).map(h => ({
    sourceId: h.sourceId,
    sourceTitle: h.sourceTitle,
    url: h.sourceUrl,   // see Step 3
    score: h.score,
  })),
});
```

**Step 3 — Add `sourceUrl` to `KbHit` / `KnowledgeSource`**

`apps/api/src/models/KnowledgeSource.ts`: add optional `url?: string` field.
- For `type: "website"`, populated from the crawled page URL (already tracked
  during Firecrawl ingestion via `__specs/27-website-kb-crawl-favicon.md`).
- For `type: "file"` (PDF/DOCX), `url` is the attachment download URL
  (`/api/v1/kb/sources/:id/download`) — the operator can also manually set it.
- For `type: "text"` (manually written articles), `url` is null.

`apps/api/src/services/kb/search.service.ts` `searchKb()`: project `url` from the
`KnowledgeSource` document when resolving source titles (already does a DB lookup).

**Step 4 — Return `sources` and `conversationStatus` in the widget message payload**

`apps/api/src/routes/widget.routes.ts` — `GET /widget/conversations/:id/messages`:
include `sources` in the message DTO (already included via Mongoose `toJSON` transform).
Also include `conversationStatus: conversation.status` in the response alongside `items` and
`nextCursor` so the widget can correctly route to `resolved`/`escalated`/`chat_active` on resume
without relying solely on the socket `conversation:updated` event.

`apps/widget/src/lib/api-client.ts` — `MessagesPage` type must include
`conversationStatus?: ConversationStatus` to match the API response.

`apps/widget/src/components/WidgetRoot.tsx` — On resume, read
`page.conversationStatus ?? "active"` instead of hardcoding `"active"`, and route
`next` state to `"resolved"`, `"escalated"`, or `"chat_active"` accordingly.

**Step 5 — Widget `<Citations>` component**

New file `apps/widget/src/components/Citations.tsx`:
```tsx
export function Citations({ sources }: { sources: MessageSource[] }) {
  const [open, setOpen] = useState(false);
  if (!sources?.length) return null;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Sources ({sources.length}) {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-2">
          {sources.map(s => (
            <li key={s.sourceId} className="text-xs text-muted-foreground">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer"
                   className="underline hover:text-foreground">
                  {s.sourceTitle}
                </a>
              ) : (
                <span>{s.sourceTitle}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Render in `MessageList.tsx` after the AI message bubble:
```tsx
{message.role === "ai" && message.sources?.length ? (
  <Citations sources={message.sources} />
) : null}
```

### Credentials
None.

### Blockers
- `KnowledgeSource.url` may be missing for file-type sources. The field is optional
  so these sources render without a link. No blocker for shipping; enrich URLs
  retroactively when the operator re-ingests.

### Acceptance
- [ ] AI message with KB results shows "Sources (N)" below the bubble.
- [ ] Expanding shows source titles; website sources link to the original page.
- [ ] Messages with no KB hits (pure conversation, escalation) show no citation row.
- [ ] `sources` field visible in MongoDB via `mongo-mcp`.

---

## 1.4 — Inline feedback (👍 / 👎)

### Problem
No way for customers to signal that an AI answer was unhelpful. Low-rated answers
are invisible to operators.

### Design

**New model — `apps/api/src/models/MessageFeedback.ts`**
```typescript
{
  messageId:       { type: ObjectId, ref: "Message", required: true },
  conversationId:  { type: ObjectId, ref: "Conversation", required: true },
  organizationId:  { type: ObjectId, ref: "Organization", required: true },
  rating:          { type: String, enum: ["up", "down"], required: true },
  reason:          { type: String, maxlength: 500 },   // optional free-text
  contactSessionId:{ type: ObjectId, ref: "ContactSession" },
  createdAt:       { type: Date, default: Date.now },
}
// Indexes: { messageId: 1 } unique (one rating per message), { organizationId:1, createdAt:-1 }
```

**New endpoint — `apps/api/src/routes/widget.routes.ts`**
```
POST /widget/messages/:messageId/feedback
Auth: session-token (same as sendMessage)
Body: { rating: "up" | "down", reason?: string }
Response: 201 { feedbackId }
Idempotency: upsert by messageId (allow the customer to change their vote)
```

**Widget — `apps/widget/src/components/MessageList.tsx`**

Below each AI message (after `<Citations>`), render thumbs:
```tsx
{message.role === "ai" && (
  <FeedbackControls messageId={message._id} />
)}
```

`FeedbackControls` component:
- 👍 / 👎 buttons. On click: optimistic state update → call
  `api.submitFeedback(messageId, rating)`.
- If `rating === "down"`: show a small inline text field ("Tell us more (optional)")
  with a "Send" button. On submit: `api.submitFeedback(messageId, "down", reason)`.
- After submission: replace buttons with a "Thanks!" confirmation; persist state in
  a local ref (not global state) so page re-render doesn't reset it.

**Operator inbox — `apps/web/src/app/(dashboard)/app/inbox`**

Add a "Low-rated" filter chip next to existing filters. The inbox message list
should badge AI messages that have a `down` feedback (`MessageFeedback.rating ===
"down"`). Requires joining Feedback in the server-side messages fetch (or a
separate `GET /messages?hasFeedback=down` endpoint).

### Credentials
None.

### Blockers
None.

### Acceptance
- [ ] Customer submits 👎 + reason → `MessageFeedback` document in Mongo.
- [ ] Operator inbox shows "Low-rated" filter; clicking it shows only conversations
  with thumbs-down AI replies.
- [ ] Re-rating (👍 after 👎) updates the existing record.

---

## 1.5 — CSAT on resolution

### Problem
No mechanism to collect customer satisfaction at the end of a conversation.

### Design

**New model — `apps/api/src/models/ConversationRating.ts`**
```typescript
{
  conversationId:  { type: ObjectId, ref: "Conversation", required: true, unique: true },
  organizationId:  { type: ObjectId, ref: "Organization", required: true },
  stars:           { type: Number, min: 1, max: 5, required: true },
  comment:         { type: String, maxlength: 1000 },
  resolvedBy:      { type: String, enum: ["ai", "operator", "system"] },
  createdAt:       { type: Date, default: Date.now },
}
// Index: { organizationId:1, createdAt:-1 }
```

**New endpoint — `apps/api/src/routes/widget.routes.ts`**
```
POST /widget/conversations/:conversationId/csat
Auth: session-token
Body: { stars: 1..5, comment?: string }
Response: 201 { ratingId }
Constraint: only accepted if conversation.status === "resolved" (400 otherwise)
```

**Widget — state machine + `apps/widget/src/lib/state-machine.ts`**

In the `resolved` state, after the "Conversation resolved" system message, show a
`<CSATCard>` component:

```tsx
// New component: apps/widget/src/components/CSATCard.tsx
export function CSATCard({ conversationId }: { conversationId: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    await api.submitCsat(conversationId, { stars, comment });
    setSubmitted(true);
  };

  if (submitted) return <p className="text-sm text-center text-muted-foreground">Thanks for your feedback!</p>;
  return (
    <div className="p-3 border rounded-lg">
      <p className="text-sm font-medium mb-2">How did we do?</p>
      <StarRating value={stars} onChange={setStars} />
      {stars > 0 && stars <= 3 && (
        <textarea
          className="mt-2 w-full text-sm border rounded p-2"
          placeholder="What could we do better? (optional)"
          value={comment}
          onChange={e => setComment(e.target.value)}
          maxLength={1000}
        />
      )}
      {stars > 0 && (
        <button onClick={submit} className="mt-2 btn-primary text-sm w-full">Submit</button>
      )}
    </div>
  );
}
```

**Analytics — `apps/web/src/app/(dashboard)/app/analytics`**

Add a CSAT summary card: average star rating + distribution bar (1–5 stars). Data
from `GET /analytics/csat?websiteId=&from=&to=` (new endpoint on
`analytics.routes.ts`).

### Decision: when does CSAT fire?
Fire for **all** resolution paths (`resolvedBy: "ai" | "operator"`). Exclude
`resolvedBy: "system"` (auto-expired conversations).

### Credentials
None.

### Blockers
None.

### Acceptance
- [ ] When a conversation resolves (any path), the widget shows the star-rating card.
- [ ] Submitting stores a `ConversationRating` in MongoDB.
- [ ] Analytics `/app/analytics` shows CSAT average and distribution.

---

## 1.6 — Quick-reply chips

### Problem
Customers must type every follow-up. Common actions ("Talk to a human", "Show me
more", "That solved it") require zero-friction chip buttons.

### Design

**Prompt — `apps/api/src/services/ai/prompts.ts`**

Add to Layer 5 (Tool Instructions):
```
## Quick-reply suggestions
After your reply, you may optionally suggest 2–3 short follow-up actions as
"quickReplies". Include them only when they naturally fit the context:
- "Talk to a human" — when the customer might want escalation
- "That solved it" — when the issue looks resolved
- "Show me more" — when there is more KB content you could surface
Keep each chip under 40 characters.
```

**Schema — `parseFinalReply()` in `agent.service.ts`**

Extend `FinalReply` interface:
```typescript
interface FinalReply {
  reply: string;
  confidence: number;
  action: "reply" | "escalate" | "resolve";
  quickReplies?: string[];   // max 3 items
}
```

**Model — `apps/api/src/models/Message.ts`**

Add optional field:
```typescript
quickReplies?: string[];   // max 3 items, max 40 chars each
```

**Widget — `apps/widget/src/components/MessageList.tsx`**

Below the AI message + Citations:
```tsx
{message.role === "ai" && message.quickReplies?.length ? (
  <QuickReplies
    chips={message.quickReplies}
    onSelect={(text) => {
      // Directly sends the chip text as a customer message
      onSendMessage(text);
    }}
    disabled={isWaiting}
  />
) : null}
```

`QuickReplies` renders outlined pill buttons that disappear after the customer
selects one (or after the customer types a reply manually).

### Credentials
None.

### Blockers
None — degrade gracefully (no `quickReplies` field = no chips rendered).

### Acceptance
- [ ] AI messages with context-appropriate scenarios show 2–3 chip buttons.
- [ ] Clicking a chip sends it as a customer message.
- [ ] Chips disappear after selection.
- [ ] Messages without chips render unchanged.

---

## Cross-cutting changes summary

| File | Changes |
|---|---|
| `apps/api/src/models/Message.ts` | Add `sources[]`, `quickReplies[]` |
| `apps/api/src/models/MessageFeedback.ts` | New model |
| `apps/api/src/models/ConversationRating.ts` | New model |
| `apps/api/src/services/ai/agent.service.ts` | `callLlmStream()`, stream loop, sources capture, quickReplies in final reply |
| `apps/api/src/services/ai/prompts.ts` | Quick-reply instruction layer |
| `apps/api/src/services/kb/search.service.ts` | Return `sourceUrl` from KnowledgeSource |
| `apps/api/src/models/KnowledgeSource.ts` | Add `url?` field |
| `apps/api/src/routes/widget.routes.ts` | `POST /messages/:id/feedback`, `POST /conversations/:id/csat`, `GET /appearance` (already spec'd in spec 22) |
| `apps/api/src/socket/index.ts` | Emit `message:delta`, `message:done` events |
| `apps/widget/src/components/MessageList.tsx` | Markdown renderer, Citations, FeedbackControls, QuickReplies |
| `apps/widget/src/components/Citations.tsx` | New component |
| `apps/widget/src/components/CSATCard.tsx` | New component |
| `apps/widget/src/lib/state-machine.ts` | `in_flight` buffer for streaming |
| `apps/widget/src/components/WidgetRoot.tsx` | `message:delta` / `message:done` socket listeners |
| `apps/web/src/app/(dashboard)/app/inbox` | Low-rated filter |
| `apps/web/src/app/(dashboard)/app/analytics` | CSAT summary card |

## New env vars
None for Tier 1. All builds on existing `OPENROUTER_API_KEY`.
