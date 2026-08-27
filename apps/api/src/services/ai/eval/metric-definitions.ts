// Plain-language definitions for every tile on the RAG Quality dashboard.
//
// ONE definition per metric, held here and served from
// `GET /rag-metrics/definitions`. The offline report and the live dashboard are
// one product: two definitions of Precision@5 would let the two disagree with
// nobody able to say which is lying.
//
// Every `spec` field below names a row in a metric table in
// `__specs/39-rag-evaluation.md`, and `rag-metrics.test.ts` parses that file and
// fails if a single word drifts apart. Edit the spec and this file together, or
// the test will tell you.

export type MetricDefinition = {
  /** Tile heading. `{k}` is substituted with the selected K. */
  label: string;
  /** Verbatim from the spec's Definition column. */
  definition: string;
  /** Verbatim from the spec's third column, where the table has one. */
  note?: string;
  /** The metric's row name in `__specs/39-rag-evaluation.md`. */
  spec: string;
  /** A worked example, written here rather than in the spec. */
  example?: string;
};

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  // ---- Retrieval, scored against the production proxy ----
  recallAtK: {
    label: "Recall@{k}",
    spec: "Recall@K",
    definition: "Fraction of the relevant set found in the top K",
    note: "Graded, not a hit flag: a multi-hop case that finds one of two sources scores 0.5",
    example: "A reply citing 2 sources, 1 of which was in the top 5, scores 0.5.",
  },
  precisionAtK: {
    label: "Precision@{k}",
    spec: "Precision@K",
    definition: "Relevant results in the top K, divided by K",
    note: "Measures context budget spent usefully. 2 returned and both relevant at K=5 is 0.4, not 1.0",
    example: "Of the 5 passages retrieved, 1 was relevant: 20 percent.",
  },
  mrr: {
    label: "MRR",
    spec: "MRR",
    definition: "1 / rank of the first relevant result",
    note: 'Ignores everything past the first hit; catches "found it, but at rank 8"',
    example: "First cited source at rank 2 scores 0.5; at rank 1, 1.0.",
  },
  relevantSet: {
    label: "How this is scored",
    spec: "Production relevant set",
    definition:
      "The sources the reply cited, standing in for a human-declared relevant set",
    note: "Only turns that cited at least one source are scored. A turn that cited nothing is excluded, never counted as zero",
  },

  // ---- Generation ----
  faithfulness: {
    label: "Faithfulness",
    spec: "Faithfulness",
    definition:
      "Supported claims / total claims, after decomposing the answer into atomic claims. The hallucination metric. Every unsupported claim is listed in the report",
    example:
      "An answer making 4 claims, 3 of them supported by a retrieved passage, scores 0.75.",
  },
  citationAccuracy: {
    label: "Citation accuracy",
    spec: "Citation accuracy",
    definition: "Citations pointing at a passage that supports their sentence",
  },

  // ---- Production-only ----
  noHitRate: {
    label: "No-hit rate",
    spec: "No-hit rate",
    definition:
      "Share of turns where retrieval returned no passage for the reply to be grounded in",
    note: "The knowledge base is missing the topic. The fix is writing a document",
  },
  lowConfidenceRate: {
    label: "Low-confidence rate",
    spec: "Low-confidence rate",
    definition: "Share of turns whose confidence fell below AI_CONFIDENCE_THRESHOLD",
    note: "Usually retrieval quality rather than missing content: look for near-duplicate or stale documents competing with the right one",
  },
  widenRate: {
    label: "Widen-on-empty rate",
    spec: "Widen-on-empty rate",
    definition:
      "Share of turns where the score floor filtered everything out and retrieval retried with no floor",
    note: "A high rate means AI_KB_SEARCH_MIN_SCORE is set above where this corpus actually scores",
  },
  escalationRate: {
    label: "Escalation rate",
    spec: "Escalation rate",
    definition: "Share of turns handed to a human",
    note: "The assistant declining rather than guessing, which is correct behaviour but expensive at volume",
  },
  meanConfidence: {
    label: "Mean confidence",
    spec: "Mean confidence",
    definition:
      "Average of the meta pass's confidence across turns, after any uncited-ratio penalty",
    note: "Not a probability. It is one model's stated confidence in another model's answer, useful as a trend and not as an absolute",
  },
  retrievalConfidence: {
    label: "Retrieval confidence",
    spec: "Retrieval confidence",
    definition:
      "Normalised 0-1 blend of the best passage's score, its margin over the runner-up, and how many passages corroborate it",
    note: "Derived, not a raw score, because a cosine score is not comparable across queries. Nothing routes on it",
  },
  meanTopScore: {
    label: "Mean top score",
    spec: "Mean top score",
    definition: "Average raw similarity of the best passage retrieved",
    note: "Always on the cosine scale, whichever of fusion and reranking ran",
  },
  citationRate: {
    label: "Citation rate",
    spec: "Citation rate",
    definition: "Share of replies carrying at least one citation",
    note: "A reply with passages retrieved but nothing cited is grounded only by luck",
  },
  citationsPerAnswer: {
    label: "Citations per answer",
    spec: "Citations per answer",
    definition:
      "Mean number of validated citations on replies that cited anything",
    note: "Markers pointing at nothing are stripped before this is counted",
  },
  helpfulness: {
    label: "Helpfulness",
    spec: "Helpfulness",
    definition: "Thumbs up as a share of all thumbs on replies in the window",
    note: "The only metric here a customer produced. Sparse by nature; read it as a signal, not a rate",
  },
  costPerConversation: {
    label: "Cost / conversation",
    spec: "Cost per conversation",
    definition:
      "Total resolved USD in the window divided by the conversations that produced it",
    note: "Turns whose cost OpenRouter never resolved are excluded from both halves, so this is a cost per priced conversation",
  },
  latency: {
    label: "p95 latency",
    spec: "End-to-end latency",
    definition:
      "Wall clock from the start of a turn to its persisted reply, p50 and p95",
    note: "Includes retrieval, every tool round trip and both finalize calls. It is not the time to first token, which is what the customer actually sees",
  },
  sourceRetrievalCount: {
    label: "Retrieved in",
    spec: "Source retrieval count",
    definition: "Turns in which this source contributed at least one passage",
  },
  sourceMeanTopScore: {
    label: "Mean top score",
    spec: "Source mean top score",
    definition:
      "Average top score across the turns where this source ranked first",
    note: "Exact rather than approximate: the turn's top score belongs to the top-ranked source, so turns where this source placed lower are excluded rather than credited with another source's score",
  },
  neverRetrieved: {
    label: "Never retrieved",
    spec: "Never retrieved",
    definition: "Ready sources that no turn in the window retrieved",
    note: "Dead weight in the index. Either the content is unreachable by the questions being asked, or nobody is asking about it",
  },
};

export type MetricKey = keyof typeof METRIC_DEFINITIONS;
