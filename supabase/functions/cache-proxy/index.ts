/**
 * ClearDesk — cache-proxy Edge Function
 * Upstash Redis HTTP REST cache layer.
 *
 * Routes:
 *   GET  /cache-proxy?key=stats:{org_id}          → get cached value
 *   POST /cache-proxy  { key, value, ttl }         → set cached value
 *   DELETE /cache-proxy?key=stats:{org_id}         → invalidate key
 *
 * Env vars required (set in Supabase Dashboard → Edge Functions → Secrets):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Auth: validates Supabase JWT — only authenticated users can read/write cache.
 * Cache keys are scoped per org_id extracted from JWT (no client-side spoofing).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── TTL defaults (seconds) ──────────────────────────────────────────
const TTL_DEFAULTS: Record<string, number> = {
  'stats':   60,
  'feed':    30,
  'desk':    300,
  'session': 3600,
};

function defaultTTL(key: string): number {
  const prefix = key.split(':')[0];
  return TTL_DEFAULTS[prefix] ?? 60;
}

// ── Upstash REST helpers ────────────────────────────────────────────
async function redisGet(key: string): Promise<string | null> {
  const url   = Deno.env.get('UPSTASH_REDIS_REST_URL')!;
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.result ?? null;
}

async function redisSet(key: string, value: string, ttl: number): Promise<void> {
  const url   = Deno.env.get('UPSTASH_REDIS_REST_URL')!;
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;

  await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${ttl}`, {
    method: 'GET', // Upstash REST supports GET-style commands
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function redisDel(key: string): Promise<void> {
  const url   = Deno.env.get('UPSTASH_REDIS_REST_URL')!;
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;

  await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Auth helper — extract org_id from JWT ──────────────────────────
async function getOrgId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    user.user_metadata?.organization_id ||
    user.app_metadata?.organization_id  ||
    user.id  // fallback: scope per user
  );
}

// ── Validate key belongs to requesting org ─────────────────────────
function keyBelongsToOrg(key: string, orgId: string): boolean {
  // Key format: {prefix}:{org_id}  e.g. "stats:uuid-..."
  const parts = key.split(':');
  return parts.length >= 2 && parts[1] === orgId;
}

// ── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req: Request) => {

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // Validate Upstash env vars present
  if (!Deno.env.get('UPSTASH_REDIS_REST_URL') || !Deno.env.get('UPSTASH_REDIS_REST_TOKEN')) {
    return new Response(
      JSON.stringify({ error: 'Redis not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Auth check
  const orgId = await getOrgId(req);
  if (!orgId) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);

  try {
    // ── GET: read from cache ───────────────────────────────────────
    if (req.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!key) return json400('Missing ?key param');
      if (!keyBelongsToOrg(key, orgId)) return json403();

      const cached = await redisGet(key);
      if (cached === null) {
        return new Response(
          JSON.stringify({ hit: false, data: null }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
      }

      let parsed;
      try { parsed = JSON.parse(cached); } catch { parsed = cached; }

      return new Response(
        JSON.stringify({ hit: true, data: parsed }),
        { headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } }
      );
    }

    // ── POST: write to cache ───────────────────────────────────────
    if (req.method === 'POST') {
      const body = await req.json();
      const { key, value, ttl } = body;

      if (!key || value === undefined) return json400('Missing key or value');
      if (!keyBelongsToOrg(key, orgId)) return json403();

      const resolvedTTL = ttl ?? defaultTTL(key);
      const serialized  = typeof value === 'string' ? value : JSON.stringify(value);

      await redisSet(key, serialized, resolvedTTL);

      return new Response(
        JSON.stringify({ ok: true, key, ttl: resolvedTTL }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // ── DELETE: invalidate key ─────────────────────────────────────
    if (req.method === 'DELETE') {
      const key = url.searchParams.get('key');
      if (!key) return json400('Missing ?key param');
      if (!keyBelongsToOrg(key, orgId)) return json403();

      await redisDel(key);
      return new Response(
        JSON.stringify({ ok: true, invalidated: key }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });

  } catch (err) {
    console.error('[cache-proxy] error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────────
function json400(msg: string) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
}
function json403() {
  return new Response(
    JSON.stringify({ error: 'Key does not belong to your organization' }),
    { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
}
