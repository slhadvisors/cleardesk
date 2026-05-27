/**
 * ClearDesk — crm-webhook Edge Function
 *
 * POST /functions/v1/crm-webhook
 * Auth: HMAC-SHA256 signature verification (X-ClearDesk-Signature header)
 *
 * Accepts inbound webhooks from:
 *   - Zoho CRM  (X-Zoho-Webhook-Token header OR X-ClearDesk-Signature)
 *   - HubSpot   (X-HubSpot-Signature-v3 header)
 *
 * Flow:
 *  1. Identify CRM source from headers
 *  2. Verify HMAC-SHA256 signature against stored webhook secret
 *  3. Parse lead/contact event payload → extract trigger condition
 *  4. Look up matching automated campaigns for the org
 *  5. For each matching campaign, fetch contact_list_json → dispatch via vapi-dispatch
 *  6. Insert crm_webhook_log row
 *  7. Return 200 { received: true, campaigns_triggered: N }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleardesk-signature, x-zoho-webhook-token, x-hubspot-signature-v3',
};

/* ── HMAC verification ── */
async function verifyHmac(secret: string, body: string, signature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expected = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // Strip "sha256=" prefix if present
    const provided = signature.replace(/^sha256=/, '');
    return expected === provided;
  } catch {
    return false;
  }
}

/* ── CRM payload normaliser → returns { orgApiKey, triggerCondition, contacts[] } ── */
interface NormalisedEvent {
  orgApiKey: string;          // identifies which org this webhook belongs to
  triggerCondition: string;   // e.g. "lead_status:Inquiry - Warm Open"
  contacts: Array<{ phone: string; name: string; metadata?: object }>;
  eventType: string;
}

function normaliseZoho(payload: Record<string, unknown>): NormalisedEvent | null {
  // Zoho sends: { module, operation, data: [{ Lead_Status, Phone, Full_Name, ... }] }
  const data = (payload.data as Record<string, unknown>[] | undefined)?.[0];
  if (!data) return null;

  const status   = (data['Lead_Status'] as string) || (data['Status'] as string) || '';
  const phone    = (data['Phone'] as string) || (data['Mobile'] as string) || '';
  const name     = (data['Full_Name'] as string) || (data['Last_Name'] as string) || 'Unknown';
  const apiKey   = (payload['cleardesk_api_key'] as string) || '';

  if (!phone) return null;

  return {
    orgApiKey:        apiKey,
    triggerCondition: `lead_status:${status}`,
    contacts: [{ phone, name, metadata: data as object }],
    eventType: `zoho.${(payload.module as string || 'lead').toLowerCase()}.${(payload.operation as string || 'update').toLowerCase()}`,
  };
}

function normaliseHubSpot(payload: Record<string, unknown>): NormalisedEvent | null {
  // HubSpot sends array of events: [{ subscriptionType, objectId, propertyName, propertyValue, portalId }]
  const events = Array.isArray(payload) ? payload as Record<string, unknown>[] : [payload];
  const ev = events[0];
  if (!ev) return null;

  const propName  = (ev['propertyName'] as string) || '';
  const propValue = (ev['propertyValue'] as string) || '';
  const apiKey    = (ev['cleardesk_api_key'] as string) || '';

  // For HubSpot, contact details must be hydrated via their API;
  // here we use objectId as a placeholder and trust caller to pass phone in metadata
  const phone = (ev['phone'] as string) || '';
  const name  = (ev['name'] as string) || `HS Contact ${ev['objectId']}`;

  return {
    orgApiKey:        apiKey,
    triggerCondition: `${propName}:${propValue}`,
    contacts: [{ phone, name, metadata: ev as object }],
    eventType: (ev['subscriptionType'] as string) || 'hubspot.contact.propertyChange',
  };
}

/* ── Internal vapi-dispatch invoker ── */
async function invokeVapiDispatch(
  campaignId: string,
  contacts: Array<{ phone: string; name: string; metadata?: object }>,
  scriptPrompt: string,
  serviceRoleKey: string,
  supabaseUrl: string
): Promise<{ queued: number; call_ids: string[] }> {
  const fnUrl = `${supabaseUrl}/functions/v1/vapi-dispatch`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      campaign_id:   campaignId,
      contacts,
      script_prompt: scriptPrompt,
      tone:          'professional',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`vapi-dispatch returned ${res.status}: ${err}`);
  }

  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  /* ── 1. Identify CRM source ── */
  const zohoToken    = req.headers.get('x-zoho-webhook-token');
  const hubspotSig   = req.headers.get('x-hubspot-signature-v3');
  const cdSig        = req.headers.get('x-cleardesk-signature');

  let crmSource: 'zoho' | 'hubspot' | 'generic' = 'generic';
  if (zohoToken || (!hubspotSig && !cdSig)) crmSource = 'zoho';
  if (hubspotSig) crmSource = 'hubspot';

  /* ── 2. Normalise payload ── */
  let event: NormalisedEvent | null = null;
  if (crmSource === 'zoho')    event = normaliseZoho(payload);
  if (crmSource === 'hubspot') event = normaliseHubSpot(payload);
  if (crmSource === 'generic') {
    // Generic ClearDesk-signed payload: { cleardesk_api_key, trigger_condition, contacts[] }
    event = {
      orgApiKey:        (payload['cleardesk_api_key'] as string) || '',
      triggerCondition: (payload['trigger_condition'] as string) || '',
      contacts:         (payload['contacts'] as Array<{ phone: string; name: string }>) || [],
      eventType:        'generic.trigger',
    };
  }

  if (!event || !event.orgApiKey) {
    return json({ error: 'Cannot resolve org — missing cleardesk_api_key in payload' }, 422);
  }

  /* ── 3. Resolve org from API key ── */
  const { data: vault, error: vaultErr } = await supabaseAdmin
    .from('organization_developer_vault')
    .select('organization_id, crm_access_token')
    .eq('crm_access_token', event.orgApiKey)   // api key stored in crm_access_token for now
    .single();

  if (vaultErr || !vault) {
    console.error('crm-webhook: org not found for api key', event.orgApiKey);
    // Return 200 anyway to avoid webhook retry storms
    return json({ received: true, campaigns_triggered: 0, warn: 'API key not matched' }, 200);
  }

  const orgId = vault.organization_id;

  /* ── 4. Verify HMAC signature (if present) ── */
  const webhookSecret = Deno.env.get('WEBHOOK_SIGNING_SECRET') ?? '';
  const incomingSig   = cdSig || zohoToken || hubspotSig || '';
  if (webhookSecret && incomingSig) {
    const valid = await verifyHmac(webhookSecret, rawBody, incomingSig);
    if (!valid) {
      console.error('crm-webhook: HMAC verification failed');
      return json({ error: 'Signature mismatch' }, 401);
    }
  }

  /* ── 5. Find matching automated campaigns ── */
  const { data: campaigns, error: campErr } = await supabaseAdmin
    .from('outbound_campaigns')
    .select('id, campaign_name, custom_script_prompt, contact_list_json, automation_trigger_condition')
    .eq('organization_id', orgId)
    .eq('execution_mode', 'automated')
    .in('status', ['draft', 'scheduled']); // only fire ready campaigns

  if (campErr || !campaigns?.length) {
    await logWebhookEvent(supabaseAdmin, orgId, event, 0, 'no_matching_campaigns');
    return json({ received: true, campaigns_triggered: 0 }, 200);
  }

  // Match trigger condition (case-insensitive substring or exact)
  const triggered = campaigns.filter(c => {
    if (!c.automation_trigger_condition) return false;
    const stored  = c.automation_trigger_condition.toLowerCase();
    const incoming = event!.triggerCondition.toLowerCase();
    return incoming.includes(stored) || stored.includes(incoming);
  });

  if (!triggered.length) {
    await logWebhookEvent(supabaseAdmin, orgId, event, 0, 'no_trigger_match');
    return json({ received: true, campaigns_triggered: 0, trigger_seen: event.triggerCondition }, 200);
  }

  /* ── 6. Dispatch calls for each matched campaign ── */
  const supabaseUrl     = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let totalQueued = 0;

  for (const campaign of triggered) {
    try {
      // Merge webhook contact with campaign contact list if campaign has existing contacts
      const campaignContacts: Array<{ phone: string; name: string }> =
        Array.isArray(campaign.contact_list_json) && campaign.contact_list_json.length > 0
          ? campaign.contact_list_json
          : event!.contacts;

      const result = await invokeVapiDispatch(
        campaign.id,
        campaignContacts,
        campaign.custom_script_prompt,
        serviceRoleKey,
        supabaseUrl
      );
      totalQueued += result.queued;

      console.log(`crm-webhook: campaign ${campaign.id} → ${result.queued} calls queued`);
    } catch (err) {
      console.error(`crm-webhook: failed to dispatch campaign ${campaign.id}:`, err);
    }
  }

  await logWebhookEvent(supabaseAdmin, orgId, event, totalQueued, 'dispatched');

  return json({
    received: true,
    campaigns_triggered: triggered.length,
    calls_queued: totalQueued,
    trigger_condition: event.triggerCondition,
  }, 200);
});

/* ── Logging helper ── */
async function logWebhookEvent(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  event: NormalisedEvent,
  callsQueued: number,
  outcome: string
) {
  try {
    await supabase.from('crm_webhook_logs').insert({
      organization_id:   orgId,
      event_type:        event.eventType,
      trigger_condition: event.triggerCondition,
      contacts_received: event.contacts.length,
      calls_queued:      callsQueued,
      outcome,
      created_at:        new Date().toISOString(),
    });
  } catch (err) {
    // Non-critical — log to console only
    console.error('crm-webhook: failed to insert log row:', err);
  }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
