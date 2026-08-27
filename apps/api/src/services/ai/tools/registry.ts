// Assembles the complete tool set for one conversation.
//
// The non-obvious work here is reconciling MANY connections to ONE offered tool:
// an org can connect Stripe and Paddle, both exposing `get_subscription`. The
// model must be offered that name exactly once (duplicate function names 400 the
// entire request), so the operator's configured priority decides which
// connection's schema and description are advertised, and the rest become
// ordered fallbacks the dispatcher walks on a hard error.

import type { StructuredToolInterface } from "@langchain/core/tools";
import { ToolDefinition } from "../../../models/index.js";
import { BUILTIN_TOOL_NAMES, buildBuiltinTools } from "./builtin.tools.js";
import { buildIntegrationTool, type IntegrationToolSpec } from "./integration.tools.js";
import type { ToolExecutionContext, ToolRegistry } from "./types.js";

type ToolDefDoc = {
  key?: unknown;
  description?: unknown;
  jsonSchema?: unknown;
  guardrails?: unknown;
  connectionId?: unknown;
  createdAt?: unknown;
};

const connectionIdOf = (td: ToolDefDoc): string =>
  String((td.connectionId as { _id?: unknown } | null)?._id ?? td.connectionId ?? "");

/**
 * When several connections share a tool key the model sees ONE schema — but for
 * plan-change tools each billing provider carries its OWN `targetPlan` enum (its
 * configured plan names). Offer the UNION of the chain's enums so the model can
 * request any plan ANY connected provider offers; a call that lands on the wrong
 * provider throws "Unknown plan …" (a hard error) and falls back down the chain.
 */
function offeredSchemaFor(sorted: ToolDefDoc[]): unknown {
  const primary = sorted[0]!;
  if (sorted.length <= 1) return primary.jsonSchema;

  const enums = sorted
    .map(
      (d) =>
        (d.jsonSchema as { properties?: { targetPlan?: { enum?: unknown[] } } } | undefined)
          ?.properties?.targetPlan?.enum,
    )
    .filter((e): e is unknown[] => Array.isArray(e) && e.length > 0);
  if (enums.length <= 1) return primary.jsonSchema;

  const union = [...new Set(enums.flat().map(String))];
  const merged = JSON.parse(JSON.stringify(primary.jsonSchema)) as {
    properties?: { targetPlan?: { enum?: string[] } };
  };
  if (!merged?.properties?.targetPlan) return primary.jsonSchema;
  merged.properties.targetPlan.enum = union;
  return merged;
}

export async function buildToolRegistry(args: {
  ctx: ToolExecutionContext;
  allowEscalation: boolean;
  /** The agent's operator-configured primary→fallback connection order, per key. */
  toolPriority?: { key?: string; connectionIds?: unknown[] }[] | null;
}): Promise<ToolRegistry> {
  const { ctx } = args;

  // Populate the connection's provider so we know which tools are custom
  // webhooks — their inline form must collect the operator's FULL input schema,
  // not just the missing required fields.
  const toolDefs = (await ToolDefinition.find({
    organizationId: ctx.organizationId,
    enabledAgentIds: ctx.agentId,
    isActive: true,
  })
    .populate("connectionId", "provider")
    .lean()) as unknown as ToolDefDoc[];

  const priorityByKey = new Map<string, string[]>();
  for (const p of args.toolPriority ?? []) {
    if (p.key) priorityByKey.set(p.key, (p.connectionIds ?? []).map((c) => String(c)));
  }

  const defsByKey = new Map<string, ToolDefDoc[]>();
  for (const td of toolDefs) {
    const key = String(td.key ?? "");
    if (!key) continue;
    const list = defsByKey.get(key);
    if (list) list.push(td);
    else defsByKey.set(key, [td]);
  }

  const schemaByKey = new Map<string, unknown>();
  const guardrailsByKey = new Map<string, { requireNamedAttendee?: boolean } | undefined>();
  const webhookToolKeys = new Set<string>();
  const specs: IntegrationToolSpec[] = [];

  for (const [key, defs] of defsByKey) {
    const order = priorityByKey.get(key) ?? [];
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const sorted = [...defs].sort((a, b) => {
      const d = rank(connectionIdOf(a)) - rank(connectionIdOf(b));
      if (d !== 0) return d;
      return new Date((a.createdAt as string) ?? 0).getTime() - new Date((b.createdAt as string) ?? 0).getTime();
    });
    const primary = sorted[0]!; // the tool the AI sees (its description/schema)
    const schema = offeredSchemaFor(sorted);

    schemaByKey.set(key, schema);
    guardrailsByKey.set(key, primary.guardrails as { requireNamedAttendee?: boolean } | undefined);
    if ((primary.connectionId as { provider?: string } | null)?.provider === "webhook") {
      webhookToolKeys.add(key);
    }
    specs.push({
      key,
      description: String(primary.description ?? key),
      schema,
      connectionChain: sorted.map(connectionIdOf),
    });
  }

  const builtinTools = buildBuiltinTools({
    ctx,
    allowEscalation: args.allowEscalation,
    offerRequestForm: specs.length > 0,
    schemaByKey,
    webhookToolKeys,
  });
  const integrationTools = specs.map((spec) => buildIntegrationTool(spec, ctx));
  const tools: StructuredToolInterface[] = [...builtinTools, ...integrationTools];

  return {
    tools,
    byName: new Map(tools.map((t) => [t.name, t])),
    builtinNames: new Set(BUILTIN_TOOL_NAMES),
    schemaByKey,
    guardrailsByKey,
    webhookToolKeys,
    activeToolKeys: [...defsByKey.keys()],
    // Prompt-layer tool list, deduped by key: several connections can expose the
    // same tool key but the model is offered ONE function per key — listing it
    // twice with two descriptions just adds contradictory noise. Use the
    // PRIMARY's description, the same one the offered function carries.
    promptTools: specs.map((s) => ({ key: s.key, description: s.description })),
  };
}
