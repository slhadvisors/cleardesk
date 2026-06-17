/**
 * ClearDesk — §7 Usage metering (shared)
 *
 * Single master account per provider (Twilio/Claude/Sarvam/Vapi). Every API
 * call is tagged here with org_id + agent_type at the point of invocation, so
 * costs can be attributed back to tenants (credit dashboard + margin alerts).
 * Best-effort: never throws into the caller's hot path.
 */

type Supa = { from: (t: string) => any };

export interface UsageEvent {
  organization_id: string;
  agent_type?: string | null;
  provider: 'claude' | 'twilio' | 'sarvam' | 'vapi';
  unit: 'call_minute' | 'sms_segment' | 'message' | 'llm_token' | 'tts_char';
  quantity: number;
  cost_credits?: number;     // retail
  wholesale_cost?: number;   // infra cost
  ref_type?: string | null;
  ref_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Rate card (retail credits). Single source of truth for usage pricing.
 * wholesale = retail / MARKUP (consistent with the §10 / ops margin calc).
 * Tune here only — callers must not hardcode prices.
 */
export const MARKUP = 1.4;

const RATES: Record<string, number> = {
  // provider:unit  →  retail credits per unit
  'twilio:sms_segment': 0.50,   // per 160-char SMS segment
  'twilio:message':     0.50,   // per WhatsApp/MMS message
  'vapi:call_minute':   1.00,   // per AI voice minute
  'claude:llm_token':   0.00002, // per token (~0.02 / 1k tokens)
  'sarvam:tts_cha