/**
 * The offline harness's wrapper around the shared judge.
 *
 * The prompt, the verdict shape and the parsing all live in
 * `@api/services/ai/eval/judge.js` now, because online faithfulness sampling
 * scores production turns with the SAME judge (__specs/39). Two copies of the
 * prompt would make the two numbers incomparable the first time one was edited.
 *
 * What stays here is the part only an offline run wants: a disk cache. Re-
 * scoring an answer that has not changed is a pure waste of judge tokens, and
 * judge tokens are the harness's only inherent spend. Online has nothing to
 * cache — every production answer is new.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  JUDGE_PROMPT_VERSION,
  runJudge,
  type JudgePassage,
  type JudgeVerdict,
} from "@api/services/ai/eval/judge.js";

export { type JudgeVerdict } from "@api/services/ai/eval/judge.js";

export const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-4.5";

export type JudgeResult = {
  verdict: JudgeVerdict;
  cached: boolean;
  generationId: string | null;
};

/**
 * Disk cache keyed by (case id, answer hash, judge model, prompt version).
 *
 * The answer hash is what makes a rerun near-free. Including the model and
 * prompt version means changing either invalidates the cache rather than
 * silently mixing verdicts from two different judges into one number.
 */
export class JudgeCache {
  private readonly file: string;
  private data: Record<string, JudgeVerdict> = {};
  hits = 0;

  constructor(cacheDir: string, judgeModel: string) {
    const slug = judgeModel.replace(/[^a-z0-9]+/gi, "-");
    this.file = path.join(cacheDir, `judge-cache-${slug}-${JUDGE_PROMPT_VERSION}.json`);
  }

  async load(): Promise<void> {
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8")) as Record<string, JudgeVerdict>;
    } catch {
      this.data = {};
    }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 2));
  }

  static key(caseId: string, answer: string): string {
    return `${caseId}:${createHash("sha256").update(answer).digest("hex").slice(0, 16)}`;
  }

  get(key: string): JudgeVerdict | undefined {
    const hit = this.data[key];
    if (hit) this.hits += 1;
    return hit;
  }

  set(key: string, verdict: JudgeVerdict): void {
    this.data[key] = verdict;
  }
}

export type Judge = (args: {
  caseId: string;
  question: string;
  answer: string;
  referenceAnswer: string;
  passages: JudgePassage[];
}) => Promise<JudgeResult>;

/** The real judge: the shared call, with the offline cache in front of it. */
export function createJudge(opts: { model: string; cache: JudgeCache }): Judge {
  return async (args) => {
    const key = JudgeCache.key(args.caseId, args.answer);
    const cached = opts.cache.get(key);
    if (cached) return { verdict: cached, cached: true, generationId: null };

    const { verdict, generationId } = await runJudge({ model: opts.model, ...args });
    opts.cache.set(key, verdict);
    return { verdict, cached: false, generationId };
  };
}
