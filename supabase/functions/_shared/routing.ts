/**
 * ClearDesk — §4 Conversation & Call Routing (shared)
 *
 * Intent-based routing is decided INSIDE each agent's own response logic
 * (no separate classifier round-trip). The agent classifies the caller's
 * intent into one of the buckets below and, when needed, calls one of the
 * routing tools. Every handoff/escalation is logged to the shared client
 * record (agent_handoffs + client_interaction_summaries).
 *
 * Used by:
 *   - vapi-dispatch  → injects ROUTING_RULES_PROMPT + routingTools into the assistant
 *   - vapi-webhook   → receives the tool calls and invokes the recorders
 */

// ── Canonical routing rules (injected into every agent system prompt) ──────
export const ROUTING_RULES_PROMPT = `
ROUTING RULES — classify the caller's intent yourself on every turn and act:

1. INFORMATIONAL ("how much do I owe", "when is it due"): answer immediately
   from live data only — never from memory or an estimate. Do NOT hand off.
2. AMBIGUOUS ("I wanted to talk about the fees"): ask ONE clarifying question
   before deciding which bucket applies.
3. NEGOTIATION / DISPUTE ("I can't pay", "extend my deadline", "this looks
   wrong"): call handoff_to_recovery with a written_summary of the
   conversation so far. The Recovery agent receives the summary on handoff.
4. FEE WAIVERS / DISCOUNTS: never decide this yourself. Call escalate_to_human
   with category "fee_waiver_discount". A human staff member must approve.
5. HIGH-RISK actions (changing bank details, cancelling an engagement): call
   escalate_to_human with category "high_risk", even for verified callers.

When you are UNSURE which bucket applies, escalate rather than guess: call
escalate_to_human with category "uncertain".
`.trim();

// ── Vapi/OpenAI-style function tool schemas ────────────────────────────────
export const routingTools = [
  {
    type: 'function',
    function: {
      name: 'handoff_to_recovery',
      description:
        'Warm-hand off a negotiation or dispute (cannot pay, deadline extension, ' +
        'disputed charge) to the Recovery agent. Always include a written summary.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason for the handoff.' },
          written_summary: {
            type: 'string',
            description: 'Summary of the conversation so far, attached for Recovery.',
          },
        },
        required: ['reason', 'written_summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description:
        'Escalate to a human staff member. Use for fee waivers/discounts ' +
        '(always), high-risk actions (bank-detail changes, engagement ' +
        'cancellation), or when the correct bucket is uncertain.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason for the escalation.' },
          category: {
            type: 'string',
            enum: ['fee_waiver_discount', 'high_risk', 'uncertain', 'other'],
          },
          written_summary: {
            type: 'string',
            description: 'Optional summary of the conversation so far.',
          },
        },
        required: ['reason', 'category'],
      },
    },
  },
];

// ── Types ───────────────────────────────────────────────────────────────────
export interface RoutingContext {
  organization_id: string;
  client_id?: string | null;     // null for unverified/unknown callers
  call_log_id?: string | null;
  from_agent_type?: string | null;
}

type Supa = {
  from: (t: string) => any;
};

const CATEGORY_TO_BUCKET: Record<string, string> = {
  fee_waiver_discount: 'fee_waiver_discount',
  high_risk: 'high_risk',
  uncertain: 'other',
  other: 'other',
};

async function logSummary(
  supabaseAdmin: Supa,
  ctx: RoutingContext,
  text: string,
) {
  if (!ctx.client_id) return; // no shared client record to attach to
  await supabaseAdmin.from('client_interaction_summaries').insert({
    organization_id: ctx.organization_id,
    client_id: ctx.client_id,
    agent_type: ctx.from_agent_type ?? null,
    channel: 'call',
    summary: text,
  });
}

/** §4 negotiation/dispute → warm handoff to Recovery with summary attached. */
export async function recordHandoff(
  supabaseAdmin: Supa,
  ctx: RoutingContext,
  args: { reason: string; written_summary: string },
): Promise<string> {
  await supabaseAdmin.from('agent_handoffs').insert({
    organization_id: ctx.organization_id,
    client_id: ctx.client_id ?? null,
    call_log_id: ctx.call_log_id ?? null,
    from_agent_type: ctx.from_agent_type ?? null,
    to_target: 'recovery',
    intent_bucket: 'negotiation_dispute',
    reason: args.reason,
    written_summary: args.written_summary,
    requires_human_approval: false,
    status: 'pending',
  });
  await logSummary(
    supabaseAdmin,
    ctx,
    `[Handoff → Recovery] ${args.reason} — ${args.written_summary}`,
  );
  return 'I’m connecting you with our recovery specialist who can help with this. One moment.';
}

/** §4 fee waivers/discounts, high-risk, or uncertain → escalate to a human. */
export async function recordEscalation(
  supabaseAdmin: Supa,
  ctx: RoutingContext,
  args: { reason: string; category: string; written_summary?: string },
): Promise<string> {
  const bucket = CATEGORY_TO_BUCKET[args.category] ?? 'other';
  const needsApproval = args.category === 'fee_waiver_discount' || args.category === 'high_risk';
  await supabaseAdmin.from('agent_handoffs').insert({
    organization_id: ctx.organization_id,
    client_id: ctx.client_id ?? null,
    call_log_id: ctx.call_log_id ?? null,
    from_agent_type: ctx.from_agent_type ?? null,
    to_target: 'human',
    intent_bucket: bucket,
    reason: args.reason,
    written_summary: args.written_summary ?? null,
    requires_human_approval: needsApproval,
    status: 'pending',
  });
  await logSummary(
    supabaseAdmin,
    ctx,
    `[Escalation → Human/${args.category}] ${args.reason}` +
      (args.written_summary ? ` — ${args.written_summary}` : ''),
  );
  return 'This needs a member of our team to assist. I’m escalating it now and someone will follow up shortly.';
}

/** Dispatch a Vapi tool/function call by name. Returns the result string. */
export async function handleRoutingToolCall(
  supabaseAdmin: Supa,
  ctx: RoutingContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (name === 'handoff_to_recovery') {
    return recordHandoff(supabaseAdmin, ctx, {
      reason: String(args.reason ?? ''),
      written_summary: String(args.written_summary ?? ''),
    });
  }
  if (name === 'escalate_to_human') {
    return recordEscalation(supabaseAdmin, ctx, {
      reason: String(args.reason ?? ''),
      category: String(args.category ?? 'uncertain'),
      written_summary: args.written_summary ? String(args.written_summary) : undefined,
    });
  }
  return null; // not a routing tool
}
