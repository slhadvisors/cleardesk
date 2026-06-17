/**
 * ClearDesk — vapi-webhook Edge Function (v2)
 *
 * POST /functions/v1/vapi-webhook
 * Receives call lifecycle events from Vapi.
 *
 * Events handled:
 *   call-started           → status: in_progress
 *   call-ended             → status resolved, duration, cost
 *   end-of-call-report     → full data: transcript, recording, cost, summary
 *   transcript             → live partial transcript update
 *   hang                   → status: failed
 *
 * Auth: Bearer token matches VAPI_WEBHOOK_SECRET env var
 *
 * Post-call:
 *   - Deducts cost_credits from org credit_balance
 *   - Marks campaign completed if all calls done
 *   - Triggers gross margin check (alerts if < 35%)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleRoutingToolCall } from '../_shared/routing.ts';
import { handleVerificationToolCall, lookupRisk } from '../_shared/verification.ts';
import { recordUsage } from '../_shared/metering.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-vapi-signature',
};

function computeCost(durationSeconds: number, jurisdiction: string): number {
  const ratePerMin: Record<string, number> = { IN: 0.05, US: 0.08, AE: 0.07 };
  const rate = ratePerMin[jurisdiction] ?? ratePerMin['US'];
  return parseFloat(((durationSeconds / 60) * rate * 1.4).toFixed(4));
}

function resolveStatus(endedReason: string): string {
  const r = (endedReason || '').toLowerCase();
  if (r.includes('customer-ended') || r.includes('assistant-ended') || r === 'completed') return 'completed';
  if (r.includes('no-answer') || r === 'no_answer')  return 'no_answer';
  if (r.includes('voicemail'))                        return 'voicemail';
  if (r.includes('busy'))                             return 'failed';
  return 'failed';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();

  /* ── Auth ── */
  const secret = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? '';
  if (secret) {
    const incoming = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (incoming !== secret) {
      console.error('vapi-webhook: invalid bearer token');
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  /* ── Parse event ── */
  const eventType  = (payload.message?.type ?? payload.type ?? payload.event) as string;
  const msgData    = (payload.message ?? payload) as Record<string, unknown>;
  const callData   = (msgData.call ?? msgData) as Record<string, unknown>;
  const vapiCallId = (callData.id ?? callData.callId ?? callData.call_id) as string;

  console.log(`[vapi-webhook] event=${eventType} call_id=${vapiCallId}`);

  if (!vapiCallId) {
    return json({ received: true, warn: 'no call_id' }, 200);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  /* ── Fetch call_log ── */
  const { data: callLog } = await supabaseAdmin
    .from('call_logs')
    .select('id, organization_id, campaign_id, jurisdiction, status, cost_credits')
    .eq('vapi_call_id', vapiCallId)
    .single();

  if (!callLog) {
    console.warn('[vapi-webhook] call_log not found for', vapiCallId);
    return json({ received: true, warn: 'call_log not found' }, 200);
  }

  /* ── Handle: call-started ── */
  if (eventType === 'call-started') {
    await supabaseAdmin.from('call_logs')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', callLog.id);
    // §5 Twilio Lookup risk signals at connect (best-effort, graceful no-op).
    try {
      const { data: cl } = await supabaseAdmin
        .from('call_logs').select('from_phone, contact_phone').eq('id', callLog.id).single();
      const cli = cl?.from_phone ?? cl?.contact_phone ?? null;
      if (cli) {
        await lookupRisk(supabaseAdmin, {
          organization_id: callLog.organization_id,
          call_log_id: callLog.id,
          cli_phone: cli,
        });
      }
    } catch (_) {}
    return json({ received: true, event: eventType });
  }

  /* ── Handle: transcript (live partial) ── */
  if (eventType === 'transcript') {
    const text = (msgData.transcript ?? callData.transcript ?? '') as string;
    if (text) {
      await supabaseAdmin.from('call_logs')
        .update({ summary: text.slice(0, 3000) })
        .eq('id', callLog.id);
    }
    return json({ received: true, event: eventType });
  }

  /* ── Handle: tool-calls (§4 routing — handoff / escalate, mid-call) ── */
  if (eventType === 'tool-calls' || eventType === 'function-call') {
    // Normalise Vapi's tool-call shapes into [{ id, name, args }].
    const rawCalls =
      (msgData.toolCalls as Array<Record<string, unknown>>) ??
      (msgData.toolCallList as Array<Record<string, unknown>>) ??
      (msgData.functionCall ? [{ id: 'fc', function: msgData.functionCall }] : []);

    // Resolve the client + CLI from the call (best-effort).
    const { data: clRow } = await supabaseAdmin
      .from('call_logs')
      .select('contact_phone, from_phone, campaign_id')
      .eq('id', callLog.id)
      .single();

    const cliPhone = (clRow?.from_phone ?? clRow?.contact_phone ?? null) as string | null;
    let clientId: string | null = null;
    if (clRow?.contact_phone) {
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('organization_id', callLog.organization_id)
        .eq('phone', clRow.contact_phone)
        .maybeSingle();
      clientId = contact?.id ?? null;
    }

    const ctx = {
      organization_id: callLog.organization_id as string,
      client_id: clientId,
      call_log_id: callLog.id as string,
      from_agent_type: null,
    };
    const verifyCtx = {
      organization_id: callLog.organization_id as string,
      call_log_id: callLog.id as string,
      cli_phone: cliPhone,
      channel: 'call',
    };

    const results: Array<{ toolCallId: string; result: string }> = [];
    for (const c of rawCalls) {
      const fn = (c.function ?? c) as Record<string, unknown>;
      const name = String(fn.name ?? '');
      let args: Record<string, unknown> = {};
      try {
        args = typeof fn.arguments === 'string'
          ? JSON.parse(fn.arguments as string)
          : ((fn.arguments ?? fn.parameters ?? {}) as Record<string, unknown>);
      } catch { args = {}; }

      // §4 routing tools, else §5 verification tools.
      let result = await handleRoutingToolCall(supabaseAdmin, ctx, name, args);
      if (result === null) {
        result = await handleVerificationToolCall(supabaseAdmin, verifyCtx, name, args);
      }
      results.push({
        toolCallId: String(c.id ?? c.toolCallId ?? 'fc'),
        result: result ?? `Unknown tool: ${name}`,
      });
    }

    return json({ results });
  }

  /* ── Handle: end-of-call-report (primary Vapi event) ── */
  if (eventType === 'end-of-call-report' || eventType === 'call-ended') {
    const report       = (msgData as Record<string, unknown>);
    const endedReason  = (report.endedReason ?? callData.endedReason ?? 'unknown') as string;
    const durationSecs = Number(report.durationSeconds ?? callData.duration ?? callData.durationSeconds ?? 0);
    const recordingUrl = (report.recordingUrl ?? callData.recordingUrl ?? '') as string;
    const costData     = report.cost as Record<string, unknown> ?? {};

    // Extract transcript messages
    const messages = report.messages as Array<Record<string, unknown>> ?? [];
    const transcriptText = messages.length > 0
      ? messages.map(m => `[${m.role}] ${m.message || m.content || ''}`).join('\n')
      : (report.transcript ?? callData.transcript ?? '') as string;

    // Extract summary
    const summary = (report.summary ?? report.analysis?.summary ?? '') as string;

    const finalStatus  = resolveStatus(endedReason);
    const costCredits  = costData.totalCost
      ? parseFloat(Number(costData.totalCost).toFixed(4))
      : computeCost(durationSecs, callLog.jurisdiction ?? 'US');

    /* Upda