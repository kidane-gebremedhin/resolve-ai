# @csb/rag-eval

Offline evaluation harness for the RAG chatbot. Scores retrieval and generation
quality so a pipeline change can be defended with a number.

```bash
pnpm eval:rag                    # full golden set
pnpm eval:rag --no-judge         # retrieval only, no judge tokens
pnpm eval:rag --limit 10         # smoke subset
pnpm eval:rag --baseline <file>  # exit 1 on regression
```

Full documentation: [`__specs/39-rag-evaluation.md`](../../__specs/39-rag-evaluation.md).
Operational workflow: RUNBOOK section 13.5.

**The one rule:** this package measures production. Retrieval is `searchKb`,
generation is `generateAiReply`. It contains no retrieval logic, no prompt
construction and no model client of its own, and a test enforces that.
