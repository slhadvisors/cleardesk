/**
 * ClearDesk — accept-invite Edge Function
 *
 * Called from invite.html AFTER the user sets their password via supabase.auth.updateUser().
 * Stamps app_metadata with { organization_id, user_role } so all RLS policies work
 * on the very first request after acceptance.
 *
 * POST /functions/v1/accept-invite
 * Auth: Bearer <newly accepted user's JWT>
 *
 * Returns: { ok: true, role, organization_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

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

  // Identify the calling user
  const { data: { user }, error: authErr } = await supabaseCaller.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  // Read organization_id + user_role from user_metadata (set by inviteUserByEmail)
  const meta = user.user_metadata || {};
  const orgId   = meta.organization_id;
  const role    = meta.user_role || 'ORG_STAFF';
  const name    = meta.display_name || meta.full_name || user.email;

  if (!orgId) {
    return json({ error: 'No organization_id in invite metadata. Contact your administrator.' }, 422);
  }

  // Stamp app_metadata — this makes organization_id available in JWT for RLS
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      organization_id: orgId,
      user_role:       role,
      display_name:    name,
    },
  });

  if (updateErr) {
    console.error('[accept-invite] app_metadata update failed:', updateErr.message);
    return json({ error: updateErr.message }, 500);
  }

  // Ensure user_profiles row exists
  await supabaseAdmin.from('user_profiles').upsert({
    id:              user.id,
    organization_id: orgId,
    role,
    display_name:    name,
    preferred_language: 'ENGLISH',
  }, { onConflict: 'id' });

  // Mark pending_invite accepted
  await supabaseAdmin.from('pending_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('email', user.email);

  return json({ ok: true, role, organization_id: orgId });
});

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
