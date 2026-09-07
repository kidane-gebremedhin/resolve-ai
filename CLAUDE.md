@AGENTS.md

# Custom Rules
- Always ask clarifying questions when unclear before implemention

- Never stop on a strategic, budget or provider question. Pick the documented default, make it config-driven and reversible, and record it in the changelog under "proceeded under assumption". Genuine ambiguity about what I want is still worth asking about first, an open decision that a default can carry is not

- Humanize AI ressponses

- Unless explicitly stated, always use the current project directory as a base file path

- Always update existing specs, plans, README.md/RUNBOOK.md, etc.. to accomodate the new chages implemented, so that changes persist on brand new code regeneration from specs, plans, etc...

- Always create new CHANGELOG_[1-BASED INDEX NUMBER].md outlining only the new chages implemented (Don't outline changes from previous sessions), use the existing changelog index as base, don't consider deleted ones

- When creating new environment variable, make sure it is added to .env.example and __specs/13-env-variables.md

- Finish the whole task. Done means it works end to end in the running app, not that the code is written. The migration, the config, the tests, the docs and the verification all ship in the same pass

- When a task states how it is measured, run that measurement and report the numbers. A change that does not move its metric does not ship

- When a task carries a DONE WHEN checklist, do not report it complete until every line passes. If a line cannot pass, name it and say why. A blocked line is a normal outcome, a quietly skipped one is not

- Read AGENTS.md before writing frontend code. This Next.js version has breaking changes, so read node_modules/next/dist/docs/ rather than working from memory

- Do not git commit 

- Verify each new feature is working as expected and fix any issues found using devtools mcp, you may skip blocked ones that need human input. Write results into QA_TEST_RESULTS_[1-BASED INDEX NUMBER].md file.

- Avoid using emm dashes '—'


# Karpathy's Four Rules That Fix AI Coding Agents
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]