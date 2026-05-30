/**
 * ClearDesk — sync-contacts Edge Function
 *
 * POST /functions/v1/sync-contacts
 * Auth: Bearer <caller JWT>
 *
 * Reads crm_type + crm_access_token from organization_developer_vault
 * Fetches contacts from Zoho CRM or HubSpot
 * Upserts into contacts table (deduplicates on email + phone per org)
 *
 * Supported CRMs: zoho | hubspot | none
 *
 * Returns: { ok: true, synced: N, crm_type: string, skipped: N }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CRMContact {
  name:    string;
  email:   string;
  phone:   string;
  company: string;
  type:    'client' | 'lead';
}

// ── Zoho CRM fetcher ─────────────────────────────────────────────
async function fetchZohoContacts(accessToken: string): Promise<CRMContact[]> {
  const contacts: CRMContact[] = [];

  // Fetch Contacts module
  const contactsRes = await fetch(
    'https://www.zohoapis.com/crm/v3/Contacts?fields=Full_Name,Email,Phone,Account_Name&per_page=200',
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  if (contactsRes.ok) {
    const data = await contactsRes.json();
    for (const r of (data.data || [])) {
      contacts.push({
        name:    r.Full_Name || r.Last_Name || 'Unknown',
        email:   r.Email    || '',
        phone:   r.Phone    || r.Mobile || '',
        company: r.Account_Name || '',
        type:    'client',
      });
    }
  }

  // Fetch Leads module
  const leadsRes = await fetch(
    'https://www.zohoapis.com/crm/v3/Leads?fields=Full_Name,Email,Phone,Company,Lead_Status&per_page=200',
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  if (leadsRes.ok) {
    const data = await leadsRes.json();
    for (const r of (data.data || [])) {
      contacts.push({
        name:    r.Full_Name || r.Last_Name || 'Unknown',
        email:   r.Email    || '',
        phone:   r.Phone    || r.Mobile || '',
        company: r.Company  || '',
        type:    'lead',
      });
    }
  }

  return contacts.filter(c => c.name && (c.email || c.phone));
}

// ── HubSpot fetcher ──────────────────────────────────────────────
async function fetchHubSpotContacts(accessToken: string): Promise<CRMContact[]> {
  const contacts: CRMContact[] = [];
  let after: string | undefined;

  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/contacts');
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', 'firstname,lastname,email,phone,company,lifecyclestage');
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) break;

    const data = await res.json();
    for (const r of (data.results || [])) {
      const p = r.properties || {};
      const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Unknown';
      contacts.push({
        name,
        email:   p.email   || '',
        phone:   p.phone   || '',
        company: p.company || '',
        type:    p.lifecyclestage === 'customer' ? 'client' : 'lead',
      });
    }

    after = data.paging?.next?.after;
  } while (after && contacts.length < 1000);

  return contacts.filter(c => c.name && (c.email || c.phone));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const supabaseCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseCaller.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const orgId = user.app_metadata?.organization_id || user.user_metadata?.organization_id;
  if (!orgId) return json({ error: 'No organization_id in token' }, 422);

  // ── Load vault ────────────────────────────────────────────────
  const { data: vault } = await supabaseAdmin
    .from('organization_developer_vault')
    .select('crm_type, crm_access_token')
    .eq('organization_id', orgId)
    .single();

  const crmType  = vault?.crm_type    || 'none';
  const crmToken = vault?.crm_access_token || '';

  if (crmType === 'none' || !crmToken) {
    return json({
      error: 'CRM not configured. Go to Settings → CRM Integration to connect your CRM.',
      crm_type: crmType,
    }, 503);
  }

  // ── Fetch from CRM ────────────────────────────────────────────
  let crmContacts: CRMContact[] = [];
  try {
    if (crmType === 'zoho') {
      crmContacts = await fetchZohoContacts(crmToken);
    } else if (crmType === 'hubspot') {
      crmContacts = await fetchHubSpotContacts(crmToken);
    } else {
      return json({ error: `Unsupported CRM type: ${crmType}` }, 400);
    }
  } catch (err) {
    console.error('[sync-contacts] CRM fetch error:', err);
    return json({ error: 'Failed to fetch from CRM: ' + String(err) }, 502);
  }

  if (!crmContacts.length) {
    return json({ ok: true, synced: 0, skipped: 0, crm_type: crmType, message: 'No contacts found in CRM' });
  }

  // ── Upsert into contacts table ────────────────────────────────
  // Deduplicate on email within the batch
  const seen = new Set<string>();
  const rows = crmContacts
    .filter(c => {
      const key = c.email || c.phone;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(c => ({
      organization_id: orgId,
      name:            c.name,
      email:           c.email   || null,
      phone:           c.phone   || null,
      company:         c.company || null,
      type:            c.type,
      source:          crmType,
      last_contact:    new Date().toLocaleDateString('en-IN'),
      tags:            [crmType],
    }));

  // Upsert in batches of 100
  let synced = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data: upserted, error: upsertErr } = await supabaseAdmin
      .from('contacts')
      .upsert(batch, { onConflict: 'organization_id,email', ignoreDuplicates: false })
      .select('id');

    if (upsertErr) {
      console.error('[sync-contacts] upsert error:', upsertErr.message);
      skipped += batch.length;
    } else {
      synced += upserted?.length ?? batch.length;
    }
  }

  // Log sync event
  await supabaseAdmin.from('crm_webhook_logs').insert({
    organization_id:   orgId,
    event_type:        `${crmType}.contacts.sync`,
    trigger_condition: 'manual_sync',
    contacts_received: crmContacts.length,
    calls_queued:      0,
    outcome:           'synced',
    created_at:        new Date().toISOString(),
  }).catch(() => {});

  return json({ ok: true, synced, skipped, crm_type: crmType, total_fetched: crmContacts.length });
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
