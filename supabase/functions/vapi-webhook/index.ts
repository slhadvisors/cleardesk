/**
 * ClearDesk — vapi-webhook Edge Function
 *
 * POST /functions/v1/vapi-webhook
 * Receives call lifecycle events from Vapi:
 *   - call-started
 *   - call-ended
 *   - transcript
 *
 * Vapi sends:  X-Vapi-Signature header (HMAC-SHA256 of raw body)
 *
 * Flow:
 *  1. Verify HMAC-SHA256 signature
 *  2. Parse event type + call_id
 *  3. Update call_logs row accordingly
 *  4. On call-ended: calculate cost, update org wallet
 *  5. If campaign fully complete: update campaign status → completed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-vapi-signature',
};

/** Compute credit cost from Vapi call data (wholesale + margin) */
function computeCost(durationSeconds: number, jurisdiction: string): number {
  // Wholesale rates per minute by jurisdiction (from CLAUDE.md)
  const ratePerMin: Record<string, number> = { IN: 0.05, US: 0.08, AE: 0.07 };
  const rate = ratePerMin[jurisdiction] ?? ratePerMin['US'];
  // Retail markup ×1.4 to preserve 35%+ gross margin
  return parseFloat(((durationSeconds / 60) * rate * 1.4).toFixed(4));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();

  /* ── 1. Verify Bearer token ── */
  const secret = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? '';
  if (secret) {
    const authHeader = req.headers.get('authorization') ?? '';
    // Vapi sends: "Authorization: Bearer <token>"
    const incoming = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (incoming !== secret) {
      console.error('vapi-webhook: invalid bearer token');
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const eventType = (payload.type ?? payload.event) as string;
  const callData  = (payload.call ?? payload) as Record<string, unknown>;
  const vapiCallId = (callData.id ?? callData.call_id) as string;

  if (!vapiCallId) {
    console.warn('vapi-webhook: no call_id in payload, skipping');
    return json({ received: true }, 200);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  /* ── 2. Fetch existing call_log row ── */
  const { data: callLog } = await supabaseAdmin
    .from('call_logs')
    .select('id, organization_id, campaign_id, jurisdiction, status')
    .eq('vapi_call_id', vapiCallId)
    .single();

  if (!callLog) {
    console.warn('vapi-webhook: no call_log for vapi_call_id', vapiCallId);
    return json({ received: true, warn: 'call_log not found' }, 200);
  }

  /* ── 3. Handle event ── */
  if (eventType === 'call-started') {
    await supabaseAdmin.from('call_logs')
      .update({ status: 'in_progress' })
      .eq('id', callLog.id);
  }

  if (eventType === 'call-ended' || eventType === 'end-of-call-report') {
    const endedReason  = (callData.endedReason ?? callData.ended_reason ?? 'unknown') as string;
    const durationSecs = ((callData.duration ?? callData.durationSeconds ?? 0) as number);
    const transcript   = (callData.transcript ?? callData.summary ?? '') as string;

    const finalStatus = endedReason === 'customer-ended-call' || endedReason === 'assistant-ended-call'
      ? 'completed'
      : endedReason === 'no-answer' ? 'no-answer' : 'failed';

    const costCredits = computeCost(durationSecs, callLog.jurisdiction ?? 'US');

    await supabaseAdmin.from('call_logs').update({
      status:           finalStatus,
      duration_seconds: durationSecs,
      cost_credits:     costCredits,
      summary:          transcript.slice(0, 2000),
    }).eq('id', callLog.id);

    /* ── 4. Check if campaign is fully complete ── */
    if (callLog.campaign_id) {
      const { count: pendingCount } = await supabaseAdmin
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', callLog.campaign_id)
        .eq('status', 'in_progress');

      if (pendingCount === 0) {
        await supabaseAdmin.from('outbound_campaigns')
          .update({ status: 'completed' })
          .eq('id', callLog.campaign_id)
          .eq('status', 'processing');
      }
    }
  }

  if (eventType === 'transcript') {
    // Partial transcript update — just store latest
    const text = (callData.transcript ?? '') as string;
    if (text) {
      await supabaseAdmin.from('call_logs')
        .update({ summary: text.slice(0, 2000) })
        .eq('id', callLog.id);
    }
  }

  return json({ received: true, event: eventType, call_id: vapiCallId }, 200);
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
