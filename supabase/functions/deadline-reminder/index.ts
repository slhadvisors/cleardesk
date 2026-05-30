/**
 * ClearDesk — deadline-reminder Edge Function
 *
 * Runs daily at 09:00 IST via pg_cron (configured in Supabase).
 * Also callable manually: POST /functions/v1/deadline-reminder
 * Auth: service-role key (cron) or Bearer JWT (manual trigger by DEVELOPER)
 *
 * Logic:
 *  1. Compute today's date
 *  2. For each jurisdiction (IN / US / AE) compute deadlines that fall
 *     exactly LEAD_DAYS (5) days from today
 *  3. For each org with matching country_code, find automated campaigns
 *     with execution_mode='automated' and campaign_purpose='deadline_reminder'
 *     whose automation_trigger_condition matches the deadline key
 *  4. If no campaign exists, create a one-off campaign and dispatch via vapi-dispatch
 *  5. Log to deadline_reminder_logs table
 *
 * Deadline calendars:
 *   IN  → GSTR-1 (11th of each month), GSTR-3B (20th), TDS Q1-Q4, Advance Tax
 *   US  → Form 1099-NEC (Jan 31), 1040 (Apr 15), Q-estimates (Apr/Jun/Sep/Jan)
 *   AE  → UAE VAT return (28th of month after quarter end: Jan/Apr/Jul/Oct)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LEAD_DAYS = 5; // fire reminder N days before deadline

// ── Deadline calendars ────────────────────────────────────────────
interface Deadline {
  key:         string;   // unique identifier e.g. "GSTR-1-2025-03"
  label:       string;   // human-readable e.g. "GSTR-1 March 2025"
  dueDate:     Date;
  jurisdiction: string;
  script:      string;   // default script if no campaign configured
}

function getDeadlines(year: number, month: number): Deadline[] {
  const deadlines: Deadline[] = [];
  const m = String(month + 1).padStart(2, '0');
  const y = year;

  // ── India (IN) ────────────────────────────────────────────────
  // GSTR-1: 11th of every month (for previous month)
  deadlines.push({
    key:          `GSTR-1-${y}-${m}`,
    label:        `GSTR-1 filing due`,
    dueDate:      new Date(year, month, 11),
    jurisdiction: 'IN',
    script:       'Namaste, this is ClearDesk calling on behalf of your tax advisor. Your GSTR-1 return is due in 5 days. Please ensure your sales invoices are reconciled and uploaded to the GST portal. Contact your CA immediately if you need assistance.',
  });

  // GSTR-3B: 20th of every month
  deadlines.push({
    key:          `GSTR-3B-${y}-${m}`,
    label:        `GSTR-3B filing due`,
    dueDate:      new Date(year, month, 20),
    jurisdiction: 'IN',
    script:       'Namaste, this is ClearDesk. Your GSTR-3B return is due in 5 days. Please verify your ITC claims and tax liability before filing. Contact your CA if you need support.',
  });

  // Advance Tax: 15th of Jun, Sep, Dec, Mar
  const advanceTaxMonths = [5, 8, 11, 2]; // Jun, Sep, Dec, Mar (0-indexed)
  if (advanceTaxMonths.includes(month)) {
    deadlines.push({
      key:          `ADVANCE-TAX-${y}-${m}`,
      label:        `Advance Tax instalment due`,
      dueDate:      new Date(year, month, 15),
      jurisdiction: 'IN',
      script:       'Namaste, this is ClearDesk. Your advance tax instalment is due in 5 days on the 15th. Please ensure payment to avoid interest under Section 234B and 234C.',
    });
  }

  // ── United States (US) ────────────────────────────────────────
  // 1099-NEC: Jan 31
  if (month === 0) {
    deadlines.push({
      key:          `1099-NEC-${y}`,
      label:        `Form 1099-NEC due`,
      dueDate:      new Date(year, 0, 31),
      jurisdiction: 'US',
      script:       `Hello, this is ClearDesk calling on behalf of your tax advisor. Form 1099-NEC is due January 31st — just 5 days away. Please ensure all contractor payments over $600 are reported. Contact your accountant immediately if you need assistance.`,
    });
  }

  // 1040 Individual: Apr 15
  if (month === 3) {
    deadlines.push({
      key:          `1040-${y}`,
      label:        `Form 1040 tax return due`,
      dueDate:      new Date(year, 3, 15),
      jurisdiction: 'US',
      script:       `Hello, this is ClearDesk. Your federal tax return is due April 15th — 5 days away. Please file or request an extension immediately to avoid penalties.`,
    });
  }

  // Quarterly estimates: Apr 15, Jun 15, Sep 15, Jan 15
  const qEstimates: [number, number, string][] = [
    [3, 15, 'Q1'], [5, 15, 'Q2'], [8, 15, 'Q3'], [0, 15, 'Q4'],
  ];
  qEstimates.forEach(([m, d, q]) => {
    if (month === m) {
      deadlines.push({
        key:          `EST-TAX-${q}-${y}`,
        label:        `${q} Estimated Tax Payment due`,
        dueDate:      new Date(year, m, d),
        jurisdiction: 'US',
        script:       `Hello, this is ClearDesk. Your ${q} estimated tax payment is due in 5 days. Please submit Form 1040-ES to avoid underpayment penalties.`,
      });
    }
  });

  // ── UAE (AE) ──────────────────────────────────────────────────
  // VAT return: 28th of Jan, Apr, Jul, Oct (quarter end + 28 days)
  const vatMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct
  if (vatMonths.includes(month)) {
    deadlines.push({
      key:          `UAE-VAT-${y}-${m}`,
      label:        `UAE VAT Return due`,
      dueDate:      new Date(year, month, 28),
      jurisdiction: 'AE',
      script:       `Hello, this is ClearDesk calling on behalf of your tax advisor. Your UAE VAT return is due on the 28th — just 5 days away. Please ensure all input and output tax entries are reconciled and submit via the FTA portal.`,
    });
  }

  return deadlines;
}

// ── Check if a deadline fires today (due in exactly LEAD_DAYS) ────
function firesOn(deadline: Deadline, today: Date): boolean {
  const due = deadline.dueDate;
  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays === LEAD_DAYS;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Allow manual trigger by DEVELOPER role
  const authHeader = req.headers.get('Authorization');
  const isCronCall = !authHeader; // cron calls have no auth header
  if (!isCronCall && authHeader) {
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await caller.auth.getUser();
    if (!user || !['DEVELOPER', 'ORG_ADMIN'].includes(
      user.app_metadata?.user_role || user.user_metadata?.user_role
    )) {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  // ── Compute today and deadlines ────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const allDeadlines = getDeadlines(today.getUTCFullYear(), today.getUTCMonth());
  const todayDeadlines = allDeadlines.filter(d => firesOn(d, today));

  if (!todayDeadlines.length) {
    return json({ ok: true, message: 'No deadlines trigger today', date: today.toISOString().slice(0, 10) });
  }

  console.log(`[deadline-reminder] ${todayDeadlines.length} deadline(s) firing today:`, todayDeadlines.map(d => d.key));

  // ── Load all orgs ──────────────────────────────────────────────
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, firm_name, country_code, billing_status, credit_balance, overdraft_allowed, overdraft_limit');

  if (!orgs?.length) return json({ ok: true, message: 'No orgs found' });

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const results: object[] = [];

  for (const org of orgs) {
    // Skip suspended orgs
    if (org.billing_status === 'past_due') continue;
    const available = (org.credit_balance || 0) + (org.overdraft_allowed ? (org.overdraft_limit || 0) : 0);
    if (available <= 0) continue;

    // Find deadlines matching this org's jurisdiction
    const orgDeadlines = todayDeadlines.filter(d => d.jurisdiction === org.country_code);
    if (!orgDeadlines.length) continue;

    for (const deadline of orgDeadlines) {
      // Find matching automated deadline_reminder campaigns
      const { data: campaigns } = await supabaseAdmin
        .from('outbound_campaigns')
        .select('id, campaign_name, custom_script_prompt, contact_list_json')
        .eq('organization_id', org.id)
        .eq('campaign_purpose', 'deadline_reminder')
        .eq('execution_mode', 'automated')
        .in('status', ['draft', 'scheduled'])
        .ilike('automation_trigger_condition', `%${deadline.key.split('-')[0]}%`);

      let campaignId: string;
      let scriptPrompt: string;
      let contacts: Array<{ phone: string; name: string }>;

      if (campaigns && campaigns.length > 0) {
        const campaign = campaigns[0];
        campaignId   = campaign.id;
        scriptPrompt = campaign.custom_script_prompt || deadline.script;
        contacts     = Array.isArray(campaign.contact_list_json) ? campaign.contact_list_json : [];
      } else {
        // No campaign configured — create a one-off draft and log (don't auto-call without contacts)
        const { data: newCamp } = await supabaseAdmin
          .from('outbound_campaigns')
          .insert({
            organization_id:            org.id,
            campaign_name:              `Auto: ${deadline.label}`,
            campaign_purpose:           'deadline_reminder',
            execution_mode:             'automated',
            custom_script_prompt:       deadline.script,
            automation_trigger_condition: deadline.key,
            status:                     'draft',
            contact_list_json:          [],
          })
          .select('id')
          .single();

        results.push({
          org_id:   org.id,
          deadline: deadline.key,
          action:   'draft_created_no_contacts',
          campaign_id: newCamp?.id,
        });
        continue;
      }

      if (!contacts.length) {
        results.push({ org_id: org.id, deadline: deadline.key, action: 'skipped_no_contacts' });
        continue;
      }

      // Dispatch via vapi-dispatch
      try {
        const vapiRes = await fetch(`${supabaseUrl}/functions/v1/vapi-dispatch`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            campaign_id:   campaignId,
            contacts,
            script_prompt: scriptPrompt,
            tone:          'professional',
          }),
        });

        const vapiData = await vapiRes.json();

        // Log the reminder
        await supabaseAdmin.from('deadline_reminder_logs').insert({
          organization_id: org.id,
          deadline_key:    deadline.key,
          deadline_label:  deadline.label,
          campaign_id:     campaignId,
          contacts_called: contacts.length,
          calls_queued:    vapiData.queued || 0,
          outcome:         vapiRes.ok ? 'dispatched' : 'dispatch_failed',
          fired_at:        new Date().toISOString(),
        }).catch(() => {}); // non-critical

        results.push({
          org_id:    org.id,
          firm_name: org.firm_name,
          deadline:  deadline.key,
          calls_queued: vapiData.queued || 0,
          outcome:   vapiRes.ok ? 'dispatched' : 'failed',
        });
      } catch(err) {
        console.error(`[deadline-reminder] dispatch failed for org ${org.id}:`, err);
        results.push({ org_id: org.id, deadline: deadline.key, outcome: 'error', error: String(err) });
      }
    }
  }

  return json({
    ok: true,
    date:      today.toISOString().slice(0, 10),
    deadlines_fired: todayDeadlines.map(d => d.key),
    results,
  });
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
