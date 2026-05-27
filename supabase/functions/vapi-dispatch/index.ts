/**
 * ClearDesk — vapi-dispatch Edge Function
 *
 * POST /functions/v1/vapi-dispatch
 * Auth: Bearer <caller JWT> (ORG_ADMIN or DEVELOPER)
 *
 * Body: {
 *   campaign_id:   string (UUID),
 *   contacts:      Array<{ phone: string, name: string, metadata?: object }>,
 *   script_prompt: string,
 *   tone?:         'professional' | 'urgent' | 'friendly'  (default: 'professional')
 * }
 *
 * Flow:
 *  1. Verify caller JWT — extract org_id, jurisdiction (country_code)
 *  2. Run automated cost circuit breaker check
 *  3. Select Vapi voice model + telephony DID by jurisdiction
 *  4. POST /call to Vapi for each contact → returns call_id
 *  5. Insert call_logs rows (status: in_progress)
 *  6. Update campaign status → processing
 *  7. Return 202 Accepted with { queued: N, call_ids: [...] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JURISDICTION_CONFIG: Record<string, {
  vapi_phone_number_id: string;
  voice_id: string;
  language: string;
}> = {
  IN: {
    vapi_phone_number_id: Deno.env.get('VAPI_PHONE_ID_IN') ?? '',
    voice_id:             Deno.env.get('VAPI_VOICE_ID_IN') ?? '11labs-priya',
    language:             'hi-IN',
  },
  US: {
    vapi_phone_number_id: Deno.env.get('VAPI_PHONE_ID_US') ?? '',
    voice_id:             Deno.env.get('VAPI_VOICE_ID_US') ?? '11labs-jessica',
    language:             'en-US',
  },
  AE: {
    vapi_phone_number_id: Deno.env.get('VAPI_PHONE_ID_AE') ?? '',
    voice_id:             Deno.env.get('VAPI_VOICE_ID_AE') ?? 'azure-hoda',
    language:             'ar-AE',
  },
};

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'Speak in a calm, professional tone. Be concise and respectful.',
  urgent:       'Communicate urgency clearly but remain polite. Emphasise deadlines.',
  friendly:     'Be warm and conversational. Build rapport before stating the purpose.',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    /* ── 1. Auth ── */
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: callerErr } = await supabaseCaller.auth.getUser();
    if (callerErr || !caller) return json({ error: 'Unauthorized' }, 401);

    const callerRole   = caller.app_metadata?.user_role || caller.user_metadata?.user_role;
    const orgId        = caller.app_metadata?.organization_id || caller.user_metadata?.organization_id;
    if (!['ORG_ADMIN','DEVELOPER'].includes(callerRole)) return json({ error: 'Forbidden' }, 403);
    if (!orgId) return json({ error: 'No organization_id in token' }, 422);

    /* ── 2. Circuit breaker ── */
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('credit_balance, overdraft_allowed, overdraft_limit, billing_status, country_code')
      .eq('id', orgId)
      .single();

    if (orgErr || !org) return json({ error: 'Organization not found' }, 404);
    if (org.billing_status === 'past_due') return json({ error: 'HALT: Account settlement required', code: 'PAST_DUE' }, 402);

    const available = org.credit_balance + (org.overdraft_allowed ? (org.overdraft_limit ?? 0) : 0);
    if (available <= 0) {
      await supabaseAdmin.from('outbound_campaigns')
        .update({ status: 'paused' })
        .eq('organization_id', orgId)
        .eq('status', 'processing');
      return json({ error: 'CIRCUIT_BREAKER: Wallet depleted. Campaigns auto-paused.', code: 'WALLET_EMPTY' }, 402);
    }

    /* ── 3. Parse body ── */
    const body = await req.json();
    const { campaign_id, contacts, script_prompt, tone = 'professional' } = body;
    if (!campaign_id || !contacts?.length || !script_prompt) {
      return json({ error: 'Missing: campaign_id, contacts, script_prompt' }, 400);
    }

    /* ── 4. Jurisdiction config ── */
    const jur    = (org.country_code || 'US') as string;
    const jurCfg = JURISDICTION_CONFIG[jur] || JURISDICTION_CONFIG['US'];
    const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS['professional'];

    const VAPI_KEY = Deno.env.get('VAPI_API_KEY') ?? '';
    const VAPI_ASSISTANT_ID = Deno.env.get('VAPI_ASSISTANT_ID') ?? '';

    /* ── 5. Dispatch calls ── */
    const callIds: string[] = [];
    const callLogRows: object[] = [];

    for (const contact of contacts) {
      const vapiBody = {
        phoneNumberId: jurCfg.vapi_phone_number_id,
        assistantId:   VAPI_ASSISTANT_ID,
        customer: {
          number: contact.phone,
          name:   contact.name,
        },
        assistantOverrides: {
          voice: { voiceId: jurCfg.voice_id },
          firstMessage: `Hello ${contact.name}, ${toneInstruction}`,
          systemPrompt: `${script_prompt}\n\nTone instruction: ${toneInstruction}\n\nContact metadata: ${JSON.stringify(contact.metadata || {})}`,
        },
        metadata: {
          campaign_id,
          organization_id: orgId,
          contact_phone:   contact.phone,
          contact_name:    contact.name,
        },
      };

      const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VAPI_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(vapiBody),
      });

      if (!vapiRes.ok) {
        const errText = await vapiRes.text();
        console.error(`Vapi call failed for ${contact.phone}:`, errText);
        // Log failure but continue with remaining contacts
        callLogRows.push({
          organization_id: orgId,
          campaign_id,
          contact_phone:   contact.phone,
          contact_name:    contact.name,
          status:          'failed',
          vapi_call_id:    null,
          jurisdiction:    jur,
          created_at:      new Date().toISOString(),
        });
        continue;
      }

      const vapiData = await vapiRes.json();
      const callId = vapiData.id;
      callIds.push(callId);

      callLogRows.push({
        organization_id: orgId,
        campaign_id,
        contact_phone:   contact.phone,
        contact_name:    contact.name,
        status:          'in_progress',
        vapi_call_id:    callId,
        jurisdiction:    jur,
        created_at:      new Date().toISOString(),
      });
    }

    /* ── 6. Persist logs + update campaign ── */
    if (callLogRows.length > 0) {
      await supabaseAdmin.from('call_logs').insert(callLogRows);
    }
    await supabaseAdmin.from('outbound_campaigns')
      .update({ status: 'processing' })
      .eq('id', campaign_id)
      .eq('organization_id', orgId);

    return json({ success: true, queued: callIds.length, total: contacts.length, call_ids: callIds }, 202);

  } catch (err) {
    console.error('vapi-dispatch error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
