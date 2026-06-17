/**
 * ClearDesk — razorpay-webhook Edge Function (§6 billing)
 *
 * POST /functions/v1/razorpay-webhook
 * Auth: HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET, compared
 *       against the `x-razorpay-signature` header. We NEVER flip an org to
 *       "active" on a client redirect — only on a verified webhook here.
 *
 * Events (verified against Razorpay docs, 2026-06):
 *   subscription.activated / subscription.charged / payment.captured → active
 *   subscription.pending                                             → past_due + grace
 *   payment.failed                                                   → past_due + grace
 *   subscription.halted                                              → past_due (retries exhausted)
 *   subscription.cancelled                                           → canceled
 *
 * Deploy with verify_jwt = false (Razorpay sends no Supabase JWT).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRACE_DAYS = 5;

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish compare.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();

  /* ── Signature verification (mandatory) ── */
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
  if (!secret) {
    console.error('razorpay-webhook: RAZORPAY_WEBHOOK_SECRET not set — rejecting');
    return json({ error: 'Webhook not configured' }, 503);
  }
  const sigHeader = req.headers.get('x-razorpay-signature') ?? '';
  const expected = await hmacHex(secret, rawBody);
  if (!sigHeader || !safeEqual(sigHeader, expected)) {
    console.error('razorpay-webhook: invalid signature');
    return json({ error: 'Invalid signature' }, 401);
  }

  let payload: Record<string, any>;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const event = String(payload.event ?? '');
  const sub = payload.payload?.subscription?.entity ?? {};
  const subscriptionId = sub.id as string | undefined;
  if (!subscriptionId) return json({ received: true, warn: 'no subscription id' });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: org } = await supabaseAdmin
    .from('organizations').select('id, billing_status')
    .eq('razorpay_subscription_id', subscriptionId).maybeSingle();
  if (!org) {
    console.warn('razorpay-webhook: no org for subscription', subscriptionId);
    return json({ received: true, warn: 'org not found' });
  }

  const graceUntil = () => new Date(Date.now() + GRACE_DAYS * 86400_000).toISOString();
  let update: Record<string, unknown> = { subscription_status: sub.status ?? event };

  switch (event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'payment.captured':
      update = { ...update, billing_status: 'active', grace_until: null };
      break;
    case 'subscription.pending':
    case 'payment.failed':
      // Autopay failure → grace period, NOT instant lockout.
      update = { ...update, billing_status: 'past_due', grace_until: graceUntil() };
      break;
    case 'subscription.halted':
      update = { ...update, billing_status: 'past_due' };
      break;
    case 'subscription.cancelled':
    case 'subscription.completed':
      update = { ...update, billing_status: 'canceled' };
      break;
    default:
      return json({ received: true, event, note: 'no state change' });
  }

  await supabaseAdmin.from('organizations').update(update).eq('id', org.id);

  // On activation, kick off the async provisioning checklist.
  if (update.billing_status === 'active') {
    await supabaseAdmin.rpc('seed_provisioning_tasks', { p_org: org.id }).catch((e: unknown) =>
      console.error('seed_provisioning_tasks failed', e));
  }

  console.log(`razorpay-webhook: ${event} → org ${org.id} = ${update.billing_status}`);
  return json({ received: true, event, billing_status: update.billing_status });
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
