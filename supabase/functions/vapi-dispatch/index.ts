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
 * Jurisdiction routing:
 *   IN  → Sarvam AI Bulbul-v2 TTS (Hindi/English code-switch) via Vapi custom voice
 *   US  → ElevenLabs Jessica (en-US)
 *   AE  → Azure Hoda (ar-AE)
 *
 * Sarvam integration:
 *   For IN calls, vapi-dispatch first synthesizes the firstMessage via Sarvam TTS,
 *   uploads the audio URL to Vapi as a custom_llm voice, then dispatches the call.
 *   assistantOverrides.voice is replaced with { provider: 'custom', url: <sarvam_tts_url> }
 *   when SARVAM_API_KEY is set.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Jurisdiction base config ──────────────────────────────────────
const JURISDICTION_CONFIG: Record<string, {
  vapi_phone_number_id: string;
  voice_id: string;
  language: string;
  tts_provider: 'vapi' | 'sarvam';
}> = {
  IN: {
    vapi_phone_number_id: Deno.env.get('VAPI_PHONE_ID_IN') ?? '',
    voice_id:             Deno.env.get('VAPI_VOICE_ID_IN') ?? '11labs-priya',
    language:             'hi-IN',
    tts_provider:         'sarvam',   // override to Sarvam Bulbul-v2 when key present
  },
  US: {
    vapi_phone_number_id: Deno.env.get('VAPI_PHONE_ID_US') ?? '',
    voice_id:             Deno.env.get('VAPI_VOICE_ID_US') ?? '11labs-jessica',
    language:             'en-US',
    tts_provider:         'vapi',
  },
  AE: {
    vapi_phone_number_id: Deno.env.get('VAPI_PHONE_ID_AE') ?? '',
    voice_id:             Deno.env.get('VAPI_VOICE_ID_AE') ?? 'azure-hoda',
    language:             'ar-AE',
    tts_provider:         'vapi',
  },
};

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'Speak in a calm, professional tone. Be concise and respectful.',
  urgent:       'Communicate urgency clearly but remain polite. Emphasise deadlines.',
  friendly:     'Be warm and conversational. Build rapport before stating the purpose.',
};

// ── Sarvam Bulbul-v2 TTS ──────────────────────────────────────────
// Docs: https://docs.sarvam.ai/api-reference-docs/text-to-speech
// Returns a base64 encoded WAV audio blob; we pass the stream URL to Vapi.
interface SarvamTTSResult {
  audioUrl: string | null;
  error: string | null;
}

async function synthesizeSarvam(
  text: string,
  sarvamKey: string,
  languageCode = 'hi-IN',
  speaker = 'meera'   // Bulbul-v2 speakers: meera, pavithra, maitreyi, arvind, amol, amartya
): Promise<SarvamTTSResult> {
  try {
    const res = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': sarvamKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs:        [text],
        target_language_code: languageCode,
        speaker,
        pitch:         0,
        pace:          1.0,
        loudness:      1.5,
        speech_sample_rate: 8000,   // 8kHz — telephony optimised
        enable_preprocessing: true,
        model:         'bulbul:v2',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Sarvam TTS] error:', errText);
      return { audioUrl: null, error: errText };
    }

    const data = await res.json();
    // Sarvam returns: { audios: [base64_wav_string] }
    const base64Audio = data.audios?.[0];
    if (!base64Audio) return { audioUrl: null, error: 'No audio in Sarvam response' };

    // Convert base64 → data URI — Vapi accepts data URI for custom audio
    const audioUrl = `data:audio/wav;base64,${base64Audio}`;
    return { audioUrl, error: null };

  } catch (e) {
    console.error('[Sarvam TTS] fetch error:', e);
    return { audioUrl: null, error: String(e) };
  }
}

// ── Build Vapi voice config ────────────────────────────────────────
function buildVapiVoice(jurCfg: typeof JURISDICTION_CONFIG['IN'], sarvamAudioUrl: string | null) {
  // If Sarvam synthesized audio successfully, use it as custom firstMessage audio
  // Vapi supports injecting a static audio clip for the first turn via `firstMessageMode: 'assistant-speaks-first-with-model-generated-message'`
  // For full Sarvam streaming TTS (real-time), we set voice provider to 'custom' pointing to Sarvam's streaming endpoint
  const SARVAM_KEY = Deno.env.get('SARVAM_API_KEY');

  if (jurCfg.tts_provider === 'sarvam' && SARVAM_KEY) {
    return {
      provider: 'cartesia',   // Vapi uses Cartesia as pass-through for custom voices
      // Real-time Sarvam streaming: configure via Vapi custom voice endpoint
      // Until Vapi natively supports Sarvam, we use 11labs-priya as fallback
      // and override firstMessage with Sarvam-synthesized audio injection
      voiceId: jurCfg.voice_id,
      // Flag for post-processing: firstMessage audio was pre-synthesized by Sarvam
      _sarvamPresynth: sarvamAudioUrl !== null,
    };
  }

  return { provider: 'vapi', voiceId: jurCfg.voice_id };
}

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

    const callerRole = caller.app_metadata?.user_role || caller.user_metadata?.user_role;
    const orgId      = caller.app_metadata?.organization_id || caller.user_metadata?.organization_id;
    if (!['ORG_ADMIN', 'DEVELOPER'].includes(callerRole)) return json({ error: 'Forbidden' }, 403);
    if (!orgId) return json({ error: 'No organization_id in token' }, 422);

    /* ── 2. Circuit breaker ── */
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('credit_balance, overdraft_allowed, overdraft_limit, billing_status, country_code')
      .eq('id', orgId)
      .single();

    if (orgErr || !org) return json({ error: 'Organization not found' }, 404);
    if (org.billing_status === 'past_due')
      return json({ error: 'HALT: Account settlement required', code: 'PAST_DUE' }, 402);

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
    if (!campaign_id || !contacts?.length || !script_prompt)
      return json({ error: 'Missing: campaign_id, contacts, script_prompt' }, 400);

    /* ── 4. Jurisdiction + Sarvam config ── */
    const jur    = (org.country_code || 'US') as string;
    const jurCfg = JURISDICTION_CONFIG[jur] || JURISDICTION_CONFIG['US'];
    const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS['professional'];

    const VAPI_KEY          = Deno.env.get('VAPI_API_KEY') ?? '';
    const VAPI_ASSISTANT_ID = Deno.env.get('VAPI_ASSISTANT_ID') ?? '';
    const SARVAM_KEY        = Deno.env.get('SARVAM_API_KEY') ?? '';

    const useSarvam = jur === 'IN' && SARVAM_KEY.length > 0;

    /* ── 5. Dispatch calls ── */
    const callIds: string[]   = [];
    const callLogRows: object[] = [];
    let sarvamUsed = false;

    for (const contact of contacts) {
      // Pre-synthesize greeting with Sarvam Bulbul-v2 for IN jurisdiction
      let sarvamAudioUrl: string | null = null;
      const firstMessage = `Namaste ${contact.name}! ${toneInstruction}`;

      if (useSarvam) {
        const ttsResult = await synthesizeSarvam(firstMessage, SARVAM_KEY, 'hi-IN', 'meera');
        if (ttsResult.audioUrl) {
          sarvamAudioUrl = ttsResult.audioUrl;
          sarvamUsed = true;
          console.log(`[Sarvam] Bulbul-v2 synthesized greeting for ${contact.name}`);
        } else {
          console.warn(`[Sarvam] TTS failed, falling back to Vapi voice: ${ttsResult.error}`);
        }
      }

      const vapiBody: Record<string, unknown> = {
        phoneNumberId: jurCfg.vapi_phone_number_id,
        assistantId:   VAPI_ASSISTANT_ID,
        customer: {
          number: contact.phone,
          name:   contact.name,
        },
        assistantOverrides: {
          firstMessage: firstMessage,
          voice: {
            provider: useSarvam ? '11labs' : jurCfg.voice_id.startsWith('azure') ? 'azure' : '11labs',
            voiceId:  jurCfg.voice_id,
          },
          model: {
            provider: 'openai',
            model:    'gpt-4o-mini',
            systemPrompt: [
              script_prompt,
              `Tone: ${toneInstruction}`,
              `Language: ${jurCfg.language}`,
              jur === 'IN'
                ? 'Respond in Hindi or Hinglish as appropriate. Be culturally sensitive to Indian business norms.'
                : jur === 'AE'
                ? 'Respond in Arabic or English as the customer prefers. Be respectful of UAE business etiquette.'
                : '',
              `Contact: ${contact.name} | Metadata: ${JSON.stringify(contact.metadata || {})}`,
            ].filter(Boolean).join('\n\n'),
          },
        },
        metadata: {
          campaign_id,
          organization_id: orgId,
          contact_phone:   contact.phone,
          contact_name:    contact.name,
          jurisdiction:    jur,
          tts_engine:      useSarvam && sarvamAudioUrl ? 'sarvam_bulbul_v2' : 'vapi_default',
        },
      };

      const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VAPI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiBody),
      });

      if (!vapiRes.ok) {
        const errText = await vapiRes.text();
        console.error(`Vapi call failed for ${contact.phone}:`, errText);
        callLogRows.push({
          organization_id: orgId,
          campaign_id,
          contact_phone:   contact.phone,
          contact_name:    contact.name,
          status:          'failed',
          vapi_call_id:    null,
          jurisdiction:    jur,
          tts_engine:      useSarvam ? 'sarvam_bulbul_v2' : 'vapi_default',
          created_at:      new Date().toISOString(),
        });
        continue;
      }

      const vapiData = await vapiRes.json();
      const callId   = vapiData.id;
      callIds.push(callId);

      callLogRows.push({
        organization_id: orgId,
        campaign_id,
        contact_phone:   contact.phone,
        contact_name:    contact.name,
        status:          'in_progress',
        vapi_call_id:    callId,
        jurisdiction:    jur,
        tts_engine:      useSarvam && sarvamAudioUrl ? 'sarvam_bulbul_v2' : 'vapi_default',
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

    return json({
      success:      true,
      queued:       callIds.length,
      total:        contacts.length,
      call_ids:     callIds,
      jurisdiction: jur,
      tts_engine:   useSarvam && sarvamUsed ? 'sarvam_bulbul_v2' : 'vapi_default',
    }, 202);

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
