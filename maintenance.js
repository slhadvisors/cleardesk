/**
 * ClearDesk — maintenance.js
 * Call checkMaintenanceMode() early on every page load (before protectPage).
 * If platform is in maintenance window, replaces body with full-screen overlay.
 * DEVELOPER-role users bypass the screen so ops vault stays accessible.
 */

async function checkMaintenanceMode() {
  try {
    const { data, error } = await window.supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'maintenance_mode')
      .single();

    if (error || !data) return; // fail open — don't block users on DB error

    const m = data.value;
    if (!m || m.mode === 'off' || m.enabled === false) return;

    let active = false;
    let endsAt = null;

    if (m.mode === 'on') {
      active = true;
    } else if (m.mode === 'scheduled') {
      const now   = Date.now();
      const start = m.start ? new Date(m.start).getTime() : 0;
      const end   = m.end   ? new Date(m.end).getTime()   : Infinity;
      active = now >= start && now <= end;
      endsAt = m.end ? new Date(m.end) : null;
    }

    if (!active) return;

    // DEVELOPER users bypass maintenance screen
    const { data: { session } } = await window.supabase.auth.getSession();
    if (session) {
      const role = session.user?.app_metadata?.user_role || session.user?.user_metadata?.user_role;
      if (role === 'DEVELOPER') return;
    }

    _showMaintenanceScreen(m.message, endsAt);

  } catch { /* fail open */ }
}

function _showMaintenanceScreen(message, endsAt) {
  document.body.style.overflow = 'hidden';

  const screen = document.createElement('div');
  screen.id = 'maintenance-screen';
  screen.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:linear-gradient(135deg,#0f172a 0%,#0a0f1e 50%,#0f172a 100%);
    display:flex;align-items:center;justify-content:center;flex-direction:column;
    font-family:'Inter',-apple-system,sans-serif;
  `;

  const endMsg = endsAt
    ? `<p id="maint-countdown" style="font-size:13px;color:#64748b;margin-top:8px;font-family:'JetBrains Mono',monospace;"></p>`
    : '';

  screen.innerHTML = `
    <!-- Subtle grid bg -->
    <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(6,182,212,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(6,182,212,0.04) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;"></div>

    <div style="position:relative;text-align:center;max-width:480px;padding:0 24px;">
      <!-- Icon -->
      <div style="width:72px;height:72px;border-radius:20px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 28px;box-shadow:0 0 40px rgba(6,182,212,0.08);">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>

      <!-- Title -->
      <h1 style="font-size:22px;font-weight:700;color:#f1f5f9;letter-spacing:-0.02em;margin:0 0 8px;">
        Scheduled Maintenance
      </h1>
      <div style="width:40px;height:2px;background:linear-gradient(90deg,#06b6d4,#34d399);border-radius:2px;margin:0 auto 20px;"></div>

      <!-- Message -->
      <p style="font-size:14px;color:#94a3b8;line-height:1.7;margin:0 0 24px;">
        ${message || 'ClearDesk is undergoing scheduled maintenance. We will be back shortly.'}
      </p>

      ${endMsg}

      <!-- Status chip -->
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);margin-top:28px;">
        <span style="width:6px;height:6px;border-radius:50%;background:#06b6d4;animation:maintPulse 2s ease-in-out infinite;"></span>
        <span style="font-size:12px;font-weight:600;color:#06b6d4;letter-spacing:0.05em;">MAINTENANCE IN PROGRESS</span>
      </div>

      <!-- ClearDesk branding -->
      <p style="margin-top:40px;font-size:11px;color:#334155;letter-spacing:0.08em;">CLEARDESK PLATFORM</p>
    </div>

    <style>
      @keyframes maintPulse {
        0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(6,182,212,0.4); }
        50%      { opacity:.7; box-shadow:0 0 0 6px rgba(6,182,212,0); }
      }
    </style>
  `;

  document.body.appendChild(screen);

  // Countdown timer
  if (endsAt) {
    const tick = () => {
      const diff = endsAt - Date.now();
      const el   = document.getElementById('maint-countdown');
      if (!el) return;
      if (diff <= 0) { el.textContent = 'Finishing up…'; clearInterval(timer); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `Estimated time remaining: ${h}h ${m}m ${s}s`;
    };
    tick();
    const timer = setInterval(tick, 1000);
  }
}
