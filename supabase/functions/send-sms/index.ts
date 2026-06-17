/**
 * ClearDesk — send-sms Edge Function
 * Sends SMS via Twilio, logs to sms_logs table.
 *
 * POST /functions/v1/send-sms
 * Auth: Bearer <caller JWT>
 *
 * Body: {
 *   to:       string  (E.164 format: +919876543210)
 *   message:  string  (max 160 chars per segment)
 *   name?:    string  (contact display name)
 *   campaign_id?: string (UUID, optional)
 * }
 *
 * Env secrets required:
 *   TWILIO_ACCOUNT_SID   — ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN    — your auth token
 *   TWILIO_FROM_NUMBER   — +1415xxxxxxx (your Twilio number)
 *
 * Jurisdiction-aware from numbers (optional overrides):
 *   TWILIO_FROM_IN       — +91 number for India
 *   TWILIO_FROM_US       — +1 number for US
 *   TWILIO_FROM_AE       — +971 number for UAE
 *
 * Returns: { ok: true, sid: string, status: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordUsage } from '../_shared/metering.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Jurisdiction → Twilio from number ────────────────────────────
function fromNumber(countryCode: string): string {
  const overrides: Record<string, string> = {
    IN: Deno.env.get('TWILIO_FROM_IN') ?? '',
    US: Deno.env.get('TWILIO_FROM_US') ?? '',
    AE: Deno.env.get('TWILIO_FROM_AE') ?? '',
  };
  return (overrides[countryCode] || Deno.env.get('TWILIO_FROM_NUMBER')) ?? '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const supabaseCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: authErr } = await supabaseCaller.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const orgId = user.app_metadata?.organization_id || user.user_metadata?.organization_id;
  if (!orgId) return json({ error: 'No organization_id in token' }, 422);

  // ── Circuit breaker — check org billing ───────────────────────
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('billing_status, credit_balance, overdraft_allowed, overdraft_limit, country_code')
    .eq('id', orgId)
    .single();

  if (!org) return json({ error: 'Organization not found' }, 404);
  if (org.billing_status === 'past_due')
    return json({ error: 'Account settlement required', code: 'PAST_DUE' }, 402);

  const available = org.credit_balance + (org.overdraft_allowed ? (org.overdraft_limit ?? 0) : 0);
  if (available <= 0)
    return json({ error: 'Wallet depleted', code: 'WALLET_EMPTY' }, 402);

  // ── Parse body ────────────────────────────────────────────────
  let body: { to: string; message: string; name?: string; campaign_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { to, message, name, campaign_id } = body;
  if (!to || !message) return json({ error: 'Missing required fields: to, message' }, 400);
  if (message.length > 1600) return json({ error: 'Message too long (max 1600 chars)' }, 400);

  // ── Validate Twilio config ────────────────────────────────────
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? '';
  const from       = fromNumber(org.country_code || 'US');

  if (!accountSid || !authToken || !from) {
    return json({
      error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in Edge Function secrets.'
    }, 503);
  }

  // ── Send via Twilio REST API ──────────────────────────────────
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params    = new URLSearchParams({ To: to, From: from, Body: message });

  const twilioRes = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const twilioData = await twilioRes.json();

  if (!twilioRes.ok) {
    console.error('[send-sms] Twilio error:', twilioData);

    // Log failed attempt
    await supabaseAdmin.from('sms_logs').insert({
      organization_id: orgId,
      user_id:         user.id,
      contact_name:    name || to,
      phone_number:    to,
      recipient_phone: to,
      message_body:    message,
      message:         message,
      delivery_status: 'failed',
      status:          'failed',
      twilio_sid:      twilioData.sid ?? null,
      campaign_id:     campaign_id ?? null,
      error_message:   twilioData.message ?? 'Twilio error',
    });

    return json({
      error:   'SMS send failed',
      code:    twilioData.code,
      detail:  twilioData.message,
    }, 400);
  }

  // ── Log success ───────────────────────────────────────────────
  const { data: logRow, error: logErr } = await supabaseAdmin
    .from('sms_logs')
    .insert({
      organization_id: orgId,
      user_id:         user.id,
      contact_name:    name || to,
      phone_number:    to,
      recipient_phone: to,
      message_body:    message,
      message:         message,
      delivery_status: twilioData.status || 'queued',
      status:          'sent',
      twilio_sid:      twilioData.sid,
      campaign_id:     campaign_id ?? null,
    })
    .select()
    .single();

  if (logErr) console.error('[send-sms] log error:', logErr.message);

  // ── §7 usage metering: tag this Twilio send to the org ────────
  const segments = Math.max(1, Math.ceil((message?.length || 0) / 160));
  await recordUsage(supabaseAdmin, {
    organization_id: orgId,
    provider: 'twilio',
    unit: 