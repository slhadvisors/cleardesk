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

    /* Update call_log */
    await supabaseAdmin.from('call_logs').update({
      status:           finalStatus,
      duration_seconds: durationSecs,
      cost_credits:     costCredits,
      recording_url:    recordingUrl || null,
      transcript:       transcriptText ? transcriptText.slice(0, 8000) : null,
      summary:          summary ? summary.slice(0, 1000) : transcriptText.slice(0, 500),
      ended_at:         new Date().toISOString(),
    }).eq('id', callLog.id);

    /* Deduct from org wallet */
    if (costCredits > 0 && callLog.organization_id) {
      await supabaseAdmin.rpc('deduct_org_credits', {
        p_org_id: callLog.organization_id,
        p_amount: costCredits,
      }).catch(async () => {
        // Fallback if RPC not available
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('credit_balance')
          .eq('id', callLog.organization_id)
          .single();
        if (org) {
          await supabaseAdmin.from('organizations')
            .update({ credit_balance: Math.max(0, (org.credit_balance ?? 0) - costCredits) })
            .eq('id', callLog.organization_id);
        }
      });
    }

    /* Check campaign completion */
    if (callLog.campaign_id) {
      const { count: pending } = await supabaseAdmin
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', callLog.campaign_id)
        .eq('status', 'in_progress');

      if (pending === 0) {
        await supabaseAdmin.from('outbound_campaigns')
          .update({ status: 'completed' })
          .eq('id', callLog.campaign_id)
          .eq('status', 'processing');
        console.log(`[vapi-webhook] campaign ${callLog.campaign_id} marked completed`);
      }
    }

    /* Gross margin check — alert ops if < 35% */
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('credit_balance')
        .eq('id', callLog.organization_id)
        .single();

      const retailBurn   = costCredits;
      const wholesaleCost = computeCost(durationSecs, callLog.jurisdiction ?? 'US') / 1.4;
      const margin = retailBurn > 0
        ? ((retailBurn - wholesaleCost) / retailBurn) * 100
        : 100;

      if (margin < 35) {
        console.warn(`[vapi-webhook] MARGIN ALERT: ${margin.toFixed(1)}% for org ${callLog.organization_id}`);
        // Could insert an ops alert row here in future
      }
    } catch(_) {}

    return json({ received: true, event: eventType, status: finalStatus, duration: durationSecs, cost: costCredits });
  }

  /* ── Handle: hang / error ── */
  if (eventType === 'hang' || eventType === 'error') {
    await supabaseAdmin.from('call_logs')
      .update({ status: 'failed' })
      .eq('id', callLog.id);
    return json({ received: true, event: eventType });
  }

  return json({ received: true, event: eventType ?? 'unknown' });
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
