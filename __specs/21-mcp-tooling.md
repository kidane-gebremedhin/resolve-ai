# 21 — MCP Tooling

## Overview

The build, audit, and on-call workflows rely on a small set of **Model Context Protocol (MCP) servers** that an AI assistant (running inside Claude Code / Cursor / Zed) uses to inspect the running system. The required MCPs were introduced in [16-production-readiness-audit.md](./16-production-readiness-audit.md); this document gives them a concrete configuration and adds the supporting servers needed for development, deployment, and incident response.

> **Three MCPs are mandatory for the QA workflow** (§16): `chrome-devtools-mcp`, `mongo-mcp`, `paddle-mcp`. The others below are **recommended** — they remove manual toil but are not gates.

---

## 1. `.mcp.json` (project root, checked in)

Claude Code / compatible clients auto-load `.mcp.json` from the workspace root. Sensitive values are read from the shell environment (`${VAR}` expansion) so secrets never enter version control.

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-chrome-devtools"],
      "env": {
        "CHROME_REMOTE_DEBUG_PORT": "9222"
      }
    },
    "mongo": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "${MONGODB_URI}",
        "MDB_MCP_READ_ONLY": "false"
      }
    },
    "paddle": {
      "command": "npx",
      "args": ["-y", "@paddle/paddle-mcp"],
      "env": {
        "PADDLE_API_KEY": "${PADDLE_API_KEY}",
        "PADDLE_ENVIRONMENT": "${PADDLE_ENVIRONMENT}"
      }
    },
    "pinecone": {
      "command": "npx",
      "args": ["-y", "@pinecone-database/mcp"],
      "env": {
        "PINECONE_API_KEY": "${PINECONE_API_KEY}"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "docker": {
      "command": "npx",
      "args": ["-y", "docker-mcp-server"],
      "env": { "DOCKER_HOST": "unix:///var/run/docker.sock" }
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

> If you run **Cursor**, mirror this in `~/.cursor/mcp.json`. For **Zed**, configuration lives in `assistant_settings`. All three clients use the same MCP wire protocol.

---

## 2. Server-by-Server

### 2.1 `chrome-devtools-mcp` — **mandatory (frontend audit)**

Drives a headful or headless Chrome instance via the DevTools Protocol. Used by the agent in §16 to inspect console errors, network failures, hydration mismatches, accessibility, Core Web Vitals, and responsive layout across every page.

| Setting | Value |
|---------|-------|
| Package | `@modelcontextprotocol/server-chrome-devtools` |
| Local prerequisite | Chrome installed; run with `--remote-debugging-port=9222` |
| Used by | `/ultrareview`, manual QA, §16 audit |
| Scope | Read-only against the running app |

Common prompts:
- "Visit /app/inbox, capture any console errors, and verify Socket.io connects."
- "Lighthouse the marketing landing page; report LCP/FID/CLS."
- "Screenshot the widget at 320px, 768px, 1024px."

### 2.2 `mongo-mcp` — **mandatory (data integrity)**

Exposes Mongo collections and indexes to the agent. Used to verify schema conformance, index presence, RLS leakage across orgs, and post-deploy data integrity.

| Setting | Value |
|---------|-------|
| Package | `mongodb-mcp-server` (community) |
| Connection | `MONGODB_URI` from `apps/api/.env` |
| Used by | `/ultrareview`, §16 audit, incident triage |
| Scope | Read/write in dev; **read-only in production** (set `MDB_MCP_READ_ONLY=true` in prod `.mcp.json`) |

> Production Mongo is **never** exposed to a public MCP client. Use a SSH tunnel + a read-only credential. Never embed prod creds in `.mcp.json`.

Common prompts:
- "Show indexes on `conversations` and verify they match §03."
- "Find any documents in `messages` whose `conversationId` does not exist."
- "Count active sessions older than 24h that didn't TTL out."

### 2.3 `paddle-mcp` — **mandatory (billing)**

Provides product/price/subscription/transaction CRUD against the Paddle Billing API. Used to verify checkout flows, simulate lifecycle events, and reconcile DB state with Paddle.

| Setting | Value |
|---------|-------|
| Package | `@paddle/paddle-mcp` (official) |
| Auth | `PADDLE_API_KEY` |
| Environment | `sandbox` for dev/staging; `production` only for read operations |
| Used by | §16 audit, billing-team workflows |

Common prompts:
- "List all active subscriptions for customer X."
- "Verify that price IDs in `PADDLE_PRICE_*` env vars exist and are active."
- "Show webhook history for subscription Y."

### 2.4 `pinecone-mcp` — recommended (vector store)

The KB pipeline embeds chunks into Pinecone (one namespace per org). The Pinecone MCP lets the agent inspect namespaces, vector counts, and run test queries.

| Setting | Value |
|---------|-------|
| Package | `@pinecone-database/mcp` |
| Auth | `PINECONE_API_KEY` |
| Scope | Per-namespace queries; do not delete vectors from prod via MCP |

### 2.5 `github-mcp` — recommended (DevOps)

Used to triage CI failures, open follow-up issues, review PRs, and inspect Action runs.

| Setting | Value |
|---------|-------|
| Package | `@modelcontextprotocol/server-github` (official) |
| Auth | Fine-grained PAT with scopes: `repo`, `read:packages`, `read:org`, `workflow` |
| Scope | The single repository; rotate quarterly |

### 2.6 `filesystem-mcp` — recommended (repo navigation)

Allows the agent to traverse the monorepo with structured paths instead of shell calls. Scope is the project root only.

### 2.7 `docker-mcp` — recommended (local + remote ops)

Lists running containers, fetches logs, restarts services. On staging, mount it through an SSH tunnel to the Coolify node when triaging deploys.

### 2.8 `context7-mcp` — recommended (library docs)

Resolves up-to-date library documentation by exact version. Critical because **this repo uses Next.js 16 + React 19** — see the project AGENTS.md: "This is NOT the Next.js you know." Use `context7` to fetch current Next/Express/Mongoose/Pinecone docs instead of relying on training data.

---

## 3. When to use which MCP

| Workflow | MCPs invoked |
|----------|--------------|
| Phase-0 migration (assets, routes) | `filesystem`, `context7` (Next 16 docs), `github` |
| Phase-1 backend bring-up | `mongo`, `context7`, `filesystem` |
| Phase-2 widget + sockets | `chrome-devtools`, `mongo`, `context7` |
| Phase-3 KB + Pinecone | `pinecone`, `mongo`, `chrome-devtools` |
| Phase-4 billing + admin | `paddle`, `mongo`, `chrome-devtools` |
| `/ultrareview` (PR review) | `chrome-devtools`, `mongo`, `paddle`, `github` |
| Production readiness audit (§16) | All three mandatory + `pinecone` + `github` |
| On-call / incident | `mongo` (read-only), `chrome-devtools`, `docker`, `github` |

---

## 4. Security Rules

1. **No production secrets in `.mcp.json`.** Use shell env vars (`${VAR}`) and load them from a vault (`1Password CLI`, `bw`, `direnv`) at session start.
2. **Production Mongo MCP is read-only.** Set `MDB_MCP_READ_ONLY=true` and use a Mongo user with only `read` role.
3. **Production Paddle MCP** uses an API key with `read` scope only; mutations go through the API server.
4. **GitHub PAT** is fine-grained (single repo, minimal scopes) and rotated quarterly.
5. **MCP servers run on the developer's machine**, not on production. Never expose an MCP server to the public internet.
6. **Audit log**: keep `MCP_LOG_PATH=$HOME/.mcp-audit.log` set so the agent's MCP calls are recorded for postmortems.

---

## 5. Onboarding a Developer

```bash
# 1. Install Claude Code (or Cursor / Zed)
# 2. Load secrets into shell
op signin
export MONGODB_URI="$(op read 'op://csb-dev/mongo/uri')"
export PADDLE_API_KEY="$(op read 'op://csb-dev/paddle/sandbox-key')"
export PADDLE_ENVIRONMENT=sandbox
export PINECONE_API_KEY="$(op read 'op://csb-dev/pinecone/api-key')"
export GITHUB_TOKEN="$(op read 'op://csb-dev/github/pat-csb')"

# 3. Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222 &

# 4. Open the repo in Claude Code — MCPs load from .mcp.json automatically
claude .
```

Verify with a quick prompt: *"Use the mongo MCP to list collections in customer-support."* Should return `organizations, users, memberships, ...`.

---

## 6. CI Considerations

MCPs are **not** invoked from CI — they are interactive tools. CI uses straight HTTP/SDK calls. However, the **same package authors** should be preferred for CI scripts to keep behavior consistent:

| MCP | CI counterpart |
|-----|----------------|
| `paddle-mcp` | `@paddle/paddle-node-sdk` |
| `mongo-mcp` | `mongodb` driver (already used by Mongoose) |
| `pinecone-mcp` | `@pinecone-database/pinecone` |
| `github-mcp` | `@octokit/rest` |

---

## 7. Acceptance

- [ ] `.mcp.json` exists at repo root, references only `${VAR}` for secrets
- [ ] All three mandatory MCPs (`chrome-devtools`, `mongo`, `paddle`) start cleanly in Claude Code
- [ ] Production `mongo` MCP credential is read-only and tunneled (not direct internet)
- [ ] `MCP_LOG_PATH` is set in developer shells
- [ ] A new developer can reach an `/ultrareview` workflow within 30 minutes of repo clone
- [ ] No MCP secret has ever appeared in a git diff (verified by `gitleaks` in CI — see §18)
