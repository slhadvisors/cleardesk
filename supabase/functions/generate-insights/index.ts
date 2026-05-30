/**
 * ClearDesk — generate-insights Edge Function
 *
 * POST /functions/v1/generate-insights
 * Auth: Bearer <caller JWT> (any authenticated user) OR service-role (cron)
 *
 * Collects real operational data for the org, sends to GPT-4o-mini,
 * parses structured insights, writes to tenant_financial_insights.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — required for AI generation (Claude claude-haiku-4-5-20251001)
 *   (all standard Supabase vars)
 *
 * Returns: { ok: true, insights_generated: N }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an AI financial analyst for ClearDesk, an AI-powered tax compliance automation platform.
Analyse the operational data provided and generate 3-5 actionable financial insights.

For each insight return a JSON object with:
- insight_type: "info" | "optimization_alert" | "critical_crunch"
- metric_title: short title (max 60 chars)
- detailed_finding_summary: clear explanation with specific numbers (max 300 chars)
- projected_savings_amount: estimated savings in INR/USD (0 if not applicable)

Rules:
- "critical_crunch" only for genuine risks (wallet depletion, compliance failures, >50% call failure rate)
- "optimization_alert" for clear savings opportunities
- "info" for useful metrics and trends
- Use actual numbers from the data — no generic advice
- Be specific about what action to take

Return ONLY a JSON array of insight objects. No markdown, no explanation.`;

interface InsightRow {
  insight_type: 'info' | 'optimization_alert' | 'critical_crunch';
  metric_title: string;
  detailed_finding_summary: string;
  projected_savings_amount: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 503);

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const isCron = !authHeader;

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let orgId: string | null = null;

  if (!isCron && authHeader) {
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    orgId = user.app_metadata?.organization_id || user.user_metadata?.organization_id || null;
  }

  // If cron or no org_id, process all orgs
  const orgsToProcess: string[] = [];
  if (orgId) {
    orgsToProcess.push(orgId);
  } else {
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .not('billing_status', 'eq', 'past_due');
    orgsToProcess.push(...(orgs || []).map((o: { id: string }) => o.id));
  }

  let totalGenerated = 0;

  for (const currentOrgId of orgsToProcess) {
    try {
      const generated = await generateInsightsForOrg(currentOrgId, supabaseAdmin, anthropicKey);
      totalGenerated += generated;
    } catch(err) {
      console.error(`[generate-insights] org ${currentOrgId} failed:`, err);
    }
  }

  return json({ ok: true, insights_generated: totalGenerated, orgs_processed: orgsToProcess.length });
});

async function generateInsightsForOrg(
  orgId: string,
  db: ReturnType<typeof createClient>,
  openaiKey: string
): Promise<number> {

  // ── Collect org data ──────────────────────────────────────────
  const [orgRes, callRes, smsRes, campaignRes, vaultRes] = await Promise.all([
    db.from('organizations').select('firm_name, country_code, billing_status, credit_balance, overdraft_limit').eq('id', orgId).single(),
    db.from('call_logs').select('status, duration_seconds, cost_credits, created_at').eq('organization_id', orgId).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
    db.from('sms_logs').select('delivery_status, created_at').eq('organization_id', orgId).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
    db.from('outbound_campaigns').select('status, campaign_purpose, allocated_budget_cap, created_at').eq('organization_id', orgId),
    db.from('organization_developer_vault').select('monthly_budget_cap, current_month_accumulated_spend, budget_breached_lockout').eq('organization_id', orgId).single(),
  ]);

  const org      = orgRes.data;
  const calls    = callRes.data || [];
  const sms      = smsRes.data || [];
  const campaigns = campaignRes.data || [];
  const vault    = vaultRes.data;

  if (!org) return 0;

  // ── Compute metrics ───────────────────────────────────────────
  const totalCalls       = calls.length;
  const completedCalls   = calls.filter(c => c.status === 'completed').length;
  const failedCalls      = calls.filter(c => c.status === 'failed' || c.status === 'no_answer').length;
  const callSuccessRate  = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;
  const totalCallCost    = calls.reduce((s, c) => s + (c.cost_credits || 0), 0);
  const avgCallDuration  = totalCalls > 0
    ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / totalCalls)
    : 0;

  const totalSMS        = sms.length;
  const deliveredSMS    = sms.filter(s => s.delivery_status === 'delivered').length;
  const smsDeliveryRate = totalSMS > 0 ? Math.round((deliveredSMS / totalSMS) * 100) : 0;

  const creditBalance    = org.credit_balance ?? 0;
  const budgetCap        = vault?.monthly_budget_cap ?? 100;
  const monthSpend       = vault?.current_month_accumulated_spend ?? 0;
  const budgetUsedPct    = budgetCap > 0 ? Math.round((monthSpend / budgetCap) * 100) : 0;

  const activeCampaigns  = campaigns.filter(c => c.status === 'processing').length;
  const draftCampaigns   = campaigns.filter(c => c.status === 'draft').length;

  // ── Build data summary for GPT ────────────────────────────────
  const dataSummary = `
Organization: ${org.firm_name} (${org.country_code})
Billing: ${org.billing_status} | Credits: ${creditBalance.toFixed(2)}

CALLS (last 30 days):
- Total: ${totalCalls} | Completed: ${completedCalls} | Failed: ${failedCalls}
- Success rate: ${callSuccessRate}%
- Total cost: ${totalCallCost.toFixed(2)} credits
- Avg duration: ${avgCallDuration}s

SMS (last 30 days):
- Total: ${totalSMS} | Delivered: ${deliveredSMS}
- Delivery rate: ${smsDeliveryRate}%

CAMPAIGNS:
- Active: ${activeCampaigns} | Draft (not launched): ${draftCampaigns}
- Total ever: ${campaigns.length}

BUDGET:
- Monthly cap: ${budgetCap} | Spent this month: ${monthSpend.toFixed(2)}
- Budget used: ${budgetUsedPct}%
- Budget lockout active: ${vault?.budget_breached_lockout ? 'YES' : 'no'}
`.trim();

  // ── Call Claude claude-haiku-4-5-20251001 (Anthropic) ──────────────────────────
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system:     SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: dataSummary },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    throw new Error(`Anthropic error ${claudeRes.status}: ${err}`);
  }

  const claudeData = await claudeRes.json();
  const rawContent = claudeData.content?.[0]?.text || '[]';

  // ── Parse insights ────────────────────────────────────────────
  let insights: InsightRow[] = [];
  try {
    const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    insights = JSON.parse(cleaned);
    if (!Array.isArray(insights)) insights = [];
  } catch(e) {
    console.error('[generate-insights] JSON parse failed:', rawContent.slice(0, 200));
    return 0;
  }

  // ── Delete old unpublished insights for this org ──────────────
  await db.from('tenant_financial_insights')
    .delete()
    .eq('organization_id', orgId)
    .eq('is_published_to_taxpayer', false);

  // ── Insert new insights ───────────────────────────────────────
  const validTypes = ['info', 'optimization_alert', 'critical_crunch'];
  const rows = insights
    .filter(ins => validTypes.includes(ins.insight_type) && ins.metric_title && ins.detailed_finding_summary)
    .slice(0, 5)
    .map(ins => ({
      organization_id:          orgId,
      insight_type:             ins.insight_type,
      metric_title:             String(ins.metric_title).slice(0, 255),
      detailed_finding_summary: String(ins.detailed_finding_summary).slice(0, 1000),
      projected_savings_amount: Math.max(0, Number(ins.projected_savings_amount) || 0),
      is_published_to_taxpayer: false,
    }));

  if (!rows.length) return 0;

  const { data: inserted, error } = await db
    .from('tenant_financial_insights')
    .insert(rows)
    .select('id');

  if (error) {
    console.error('[generate-insights] insert error:', error.message);
    return 0;
  }

  console.log(`[generate-insights] org ${orgId}: ${inserted?.length || 0} insights written`);
  return inserted?.length || 0;
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
