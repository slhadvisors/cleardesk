/**
 * ClearDesk — §5 Inbound Caller Verification (shared)
 *
 * CLI/caller-ID is a HINT, never proof. Before any client-specific data,
 * the agent must confirm a SECOND factor (last 4 of registered GSTIN,
 * registered mobile, or OTP via Twilio Verify). Unverified callers get
 * generic info only. NEVER confirm or deny that a record exists for an
 * unverified caller — the failure message is identical whether or not a
 * match exists, to avoid leaking information.
 *
 * Twilio is not yet configured (project blocker): OTP + Lookup degrade
 * gracefully when TWILIO_* env vars are absent.
 */

type Supa = { from: (t: string) => any };

export interface VerifyContext {
  organization_id: string;
  call_log_id?: string | null;
  cli_phone?: string | null;
  channel?: string;
}

// Identical generic responses — never reveal whether a record exists.
const MSG_FAIL = "I wasn't able to verify your identity, so I can only share general information.";
const MSG_OK   = 'Thank you — your identity is verified. How can I help?';

export const VERIFICATION_RULES_PROMPT = `
IDENTITY VERIFICATION — follow strictly before sharing anything client-specific:

- The caller-ID is only a hint. It is NOT proof of identity.
- Before discussing any client-specific detail (dues, filings, GSTINs, history),
  confirm ONE second factor: last 4 digits of the registered GSTIN, the
  registered mobile, or an OTP. Call verify_caller_factor (or request_otp then
  check_otp).
- If the caller is NOT verified, answer ONLY generic questions (general GST
  rules, public deadlines). Do not reveal any client-specific data.
- NEVER confirm or deny whether we have a record for this caller's number or
  name. If you cannot verify, say only: "I wasn't able to verify your identity."
  Say this regardless of whether a record exists.
- High-risk actions (changing bank details, cancelling an engagement) always go
  to a human, even for verified callers (use escalate_to_human, category
  "high_risk").
`.trim();

export const verifyTools = [
  {
    type: 'function',
    function: {
      name: 'verify_caller_factor',
      description:
        'Verify a second identity factor against the caller record. Returns a ' +
        'generic result; never reveals whether a record exists.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['gstin_last4', 'registered_mobile'] },
          value: { type: 'string', description: 'The digits the caller provided.' },
        },
        required: ['method', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_otp',
      description: 'Send a one-time passcode (Twilio Verify) to the caller for verification.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_otp',
      description: 'Check a one-time passcode the caller read back.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
    },
  },
];

const digits = (s: string) => (s || '').replace(/\D/g, '');

/** Ensure a caller_verifications row exists for this call; resolves CLI match server-side. */
async function ensureRow(supabaseAdmin: Supa, ctx: VerifyContext): Promise<any> {
  if (ctx.call_log_id) {
    const { data: existing } = await supabaseAdmin
      .from('caller_verifications').select('*').eq('call_log_id', ctx.call_log_id).maybeSingle();
    if (existing) return existing;
  }
  // CLI → client match (server-side only; never surfaced to the caller).
  let clientId: string | null = null;
  let cliMatch = false;
  if (ctx.cli_phone) {
    const { data: c } = await supabaseAdmin
      .from('contacts').select('id')
      .eq('organization_id', ctx.organization_id).eq('phone', ctx.cli_phone).maybeSingle();
    if (c) { clientId = c.id; cliMatch = true; }
  }
  const { data: row } = await supabaseAdmin.from('caller_verifications').insert({
    organization_id: ctx.organization_id,
    client_id: clientId,
    call_log_id: ctx.call_log_id ?? null,
    channel: ctx.channel ?? 'call',
    cli_phone: ctx.cli_phone ?? null,
    cli_match: cliMatch,
    status: 'unverified',
  }).select('*').single();
  return row;
}

/** Verify a knowledge factor against the CLI-identified client record. */
export async function verifyFactor(
  supabaseAdmin: Supa,
  ctx: VerifyContext,
  method: string,
  value: string,
): Promise<string> {
  const row = await ensureRow(supabaseAdmin, ctx);
  let ok = false;
  // Only verifiable when CLI pointed at a known client — otherwise generic fail
  // (no enumeration of other records).
  if (row?.client_id) {
    const { data: client } = await supabaseAdmin
      .from('contacts').select('gstin, phone').eq('id', row.client_id).maybeSingle();
    if (client) {
      if (method === 'gstin_last4' && client.gstin) {
        ok = digits(client.gstin).slice(-4) === digits(value).slice(-4) && digits(value).length >= 4;
      } else if (method === 'registered_mobile' && client.phone) {
        ok = digits(client.phone).slice(-10) === digits(value).slice(-10) && digits(value).length >= 4;
      }
    }
  }
  await supabaseAdmin.from('caller_verifications').update({
    method,
    status: ok ? 'verified' : 'failed',
    attempts: (row?.attempts ?? 0) + 1,
    verified_at: ok ? new Date().toISOString() : null,
  }).eq('id', row.id);
  return ok ? MSG_OK : MSG_FAIL;
}

/** Twilio Verify — start OTP. Graceful no-op when unconfigured. */
export async function requestOtp(supabaseAdmin: Supa, ctx: VerifyContext): Promise<string> {
  const row = await ensureRow(supabaseAdmin, ctx);
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const svc = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
  const to = ctx.cli_phone;
  if (!sid || !token || !svc || !to) {
    return 'One-time passcode verification is not available right now. Please confirm the last 4 digits of your registered GSTIN instead.';
  }
  try {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${svc}/Verifications`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Channel: 'sms' }),
    });
    if (!res.ok) { console.error('[verify] start failed', await res.text()); return MSG_FAIL; }
    await supabaseAdmin.from('caller_verifications').update({ method: 'otp', status: 'pending' }).eq('id', row.id);
    return 'I have sent a one-time passcode by SMS. Please read it back to me.';
  } catch (e) { console.error('[verify] start error', e); return MSG_FAIL; }
}

/** Twilio Verify — check OTP. Graceful no-op when unconfigured. */
export async function checkOtp(supabaseAdmin: Supa, ctx: VerifyContext, code: string): Promise<string> {
  const row = await ensureRow(supabaseAdmin, ctx);
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const svc = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
  const to = ctx.cli_phone;
  if (!sid || !token || !svc || !to) return MSG_FAIL;
  try {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${svc}/VerificationCheck`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Code: code }),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data.status === 'approved';
    await supabaseAdmin.from('caller_verifications').update({
      method: 'otp',
      status: ok ? 'verified' : 'failed',
      attempts: (row?.attempts ?? 0) + 1,
      verified_at: ok ? new Date().toISOString() : null,
    }).eq('id', row.id);
    return ok ? MSG_OK : MSG_FAIL;
  } catch (e) { console.error('[verify] check error', e); return MSG_FAIL; }
}

/**
 * Twilio Lookup v2 risk signals (line type + SIM-swap) before/at connect.
 * Records onto the verification row. Graceful no-op when unconfigured.
 */
export async function lookupRisk(
  supabaseAdmin: Supa,
  ctx: VerifyContext,
): Promise<Record<string, unknown>> {
  const row = await ensureRow(supabaseAdmin, ctx);
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const phone = ctx.cli_phone;
  if (!sid || !token || !phone) return {};
  try {
    const fields = 'line_type_intelligence,sim_swap';
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=${fields}`,
      { headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) } },
    );
    if (!res.ok) return {};
    const data = await res.json();
    const signals = {
      line_type: data.line_type_intelligence?.type ?? null,
      sim_swapped_recently: data.sim_swap?.last_sim_swap?.swapped_in_period ?? null,
      carrier: data.line_type_intelligence?.carrier_name ?? null,
    };
    await supabaseAdmin.from('caller_verifications').update({ risk_signals: signals }).eq('id', row.id);
    return signals;
  } catch (e) { console.error('[lookup] error', e); return {}; }
}

/** Dispatch a verification tool/function call by name. Returns result string or null. */
export async function handleVerificationToolCall(
  supabaseAdmin: Supa,
  ctx: VerifyContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (name === 'verify_caller_factor') {
    return verifyFactor(supabaseAdmin, ctx, String(args.method ?? ''), String(args.value ?? ''));
  }
  if (name === 'request_otp') return requestOtp(supabaseAdmin, ctx);
  if (name === 'check_otp') return checkOtp(supabaseAdmin, ctx, String(args.code ?? ''));
  return null;
}
