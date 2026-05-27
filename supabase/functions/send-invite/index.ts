/**
 * ClearDesk — send-invite Edge Function
 *
 * POST /functions/v1/send-invite
 * Auth: Bearer <caller's JWT> (must be ORG_ADMIN or DEVELOPER)
 *
 * Body: {
 *   email:        string,
 *   display_name: string,
 *   role:         'ORG_ADMIN' | 'ORG_STAFF',   // never allow DEVELOPER via API
 *   organization_id: string (UUID)              // extracted server-side for non-DEVELOPER callers
 * }
 *
 * On success: Supabase sends invite email pointing to SITE_URL/invite.html
 * The invite token embeds { display_name, user_role, organization_id } in user_metadata
 * so getCurrentUser() in auth.js can read them immediately after acceptance.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // ── 1. Initialise admin client (service role) ──────────────────────────
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 2. Authenticate the caller with the anon client ───────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: callerErr } = await supabaseCaller.auth.getUser();
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. RBAC — caller must be ORG_ADMIN or DEVELOPER ──────────────────
    const callerRole = caller.app_metadata?.user_role || caller.user_metadata?.user_role;
    const allowedRoles = ['ORG_ADMIN', 'DEVELOPER'];
    if (!allowedRoles.includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'Forbidden — insufficient role' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Parse request body ─────────────────────────────────────────────
    const body = await req.json();
    const { email, display_name, role } = body;

    if (!email || !display_name || !role) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email, display_name, role' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── 5. Derive organization_id from caller (never trust client) ────────
    const organization_id =
      caller.app_metadata?.organization_id ||
      caller.user_metadata?.organization_id;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: 'Caller has no organization_id in metadata' }), {
        status: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── 6. Restrict role escalation — ORG_ADMIN cannot invite DEVELOPER ──
    const ROLE_HIERARCHY = ['DEVELOPER', 'ORG_ADMIN', 'ORG_STAFF'];
    const invitedRoleIndex = ROLE_HIERARCHY.indexOf(role);
    const callerRoleIndex = ROLE_HIERARCHY.indexOf(callerRole);
    if (invitedRoleIndex < callerRoleIndex) {
      return new Response(JSON.stringify({ error: 'Forbidden — cannot invite a higher role than your own' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── 7. Send invite via Supabase Admin API ─────────────────────────────
    // Metadata is embedded in the invite token and available in user_metadata
    // immediately after the user accepts without a DB round-trip.
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${Deno.env.get('SITE_URL') ?? 'https://cleardesk-iota.vercel.app'}/invite.html`,
      data: {
        display_name,
        user_role: role,
        organization_id,
        invited_by: caller.email,
        invited_at: new Date().toISOString(),
      },
    });

    if (inviteErr) {
      console.error('invite error:', inviteErr);
      return new Response(JSON.stringify({ error: inviteErr.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── 8. Log to pending_invites table (optional audit trail) ────────────
    await supabaseAdmin.from('pending_invites').upsert({
      email,
      display_name,
      role,
      organization_id,
      invited_by: caller.id,
      invited_at: new Date().toISOString(),
      status: 'pending',
    }, { onConflict: 'email' });

    return new Response(JSON.stringify({ success: true, user_id: inviteData.user?.id }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
