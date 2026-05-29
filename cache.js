/**
 * ClearDesk — cache.js
 * Client-side wrapper for the cache-proxy Edge Function.
 * Provides get/set/del with automatic org_id scoping and
 * graceful fallback (cache miss → caller fetches fresh data).
 *
 * Usage:
 *   const data = await Cache.get('stats');          // returns null on miss
 *   await Cache.set('stats', { agents: 5 }, 60);   // ttl in seconds (optional)
 *   await Cache.del('stats');                       // invalidate
 *
 * Key format sent to proxy: "{prefix}:{org_id}"
 * org_id is resolved once per session from Supabase JWT.
 */

window.Cache = (() => {

  // ── Resolve Edge Function URL from supabase URL ─────────────────
  function getProxyUrl() {
    const base = (window.SUPABASE_URL || '').replace('supabase.co', 'supabase.co');
    // Derive project ref from URL: https://{ref}.supabase.co
    const match = base.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (!match) return null;
    return `https://${match[1]}.supabase.co/functions/v1/cache-proxy`;
  }

  // ── Resolve org_id from current session JWT ──────────────────────
  let _orgId = null;
  async function getOrgId() {
    if (_orgId) return _orgId;
    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (!session) return null;
      const meta = session.user?.user_metadata || {};
      const app  = session.user?.app_metadata  || {};
      _orgId = meta.organization_id || app.organization_id || session.user?.id;
    } catch { _orgId = null; }
    return _orgId;
  }

  // ── Auth header ─────────────────────────────────────────────────
  async function authHeader() {
    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (!session?.access_token) return null;
      return { Authorization: `Bearer ${session.access_token}` };
    } catch { return null; }
  }

  // ── GET ─────────────────────────────────────────────────────────
  async function get(prefix) {
    try {
      const proxyUrl = getProxyUrl();
      const orgId    = await getOrgId();
      const headers  = await authHeader();
      if (!proxyUrl || !orgId || !headers) return null;

      const key = `${prefix}:${orgId}`;
      const res = await fetch(`${proxyUrl}?key=${encodeURIComponent(key)}`, {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
      if (!res.ok) return null;

      const json = await res.json();
      if (!json.hit) return null;

      console.debug(`[Cache] HIT  ${key}`);
      return json.data;
    } catch (e) {
      console.debug('[Cache] get error (non-fatal):', e.message);
      return null;
    }
  }

  // ── SET ─────────────────────────────────────────────────────────
  async function set(prefix, value, ttl) {
    try {
      const proxyUrl = getProxyUrl();
      const orgId    = await getOrgId();
      const headers  = await authHeader();
      if (!proxyUrl || !orgId || !headers) return;

      const key = `${prefix}:${orgId}`;
      await fetch(proxyUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, ttl })
      });
      console.debug(`[Cache] SET  ${key}  ttl=${ttl ?? 'default'}`);
    } catch (e) {
      console.debug('[Cache] set error (non-fatal):', e.message);
    }
  }

  // ── DEL ─────────────────────────────────────────────────────────
  async function del(prefix) {
    try {
      const proxyUrl = getProxyUrl();
      const orgId    = await getOrgId();
      const headers  = await authHeader();
      if (!proxyUrl || !orgId || !headers) return;

      const key = `${prefix}:${orgId}`;
      await fetch(`${proxyUrl}?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
      console.debug(`[Cache] DEL  ${key}`);
    } catch (e) {
      console.debug('[Cache] del error (non-fatal):', e.message);
    }
  }

  return { get, set, del };

})();
