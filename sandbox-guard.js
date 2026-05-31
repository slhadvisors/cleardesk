/**
 * ClearDesk — Sandbox / Guest Trial Guard
 *
 * When billing_status === 'guest_trial':
 *   - Hard cap: 3 source documents maximum
 *   - Hard cap: 2 minutes of voice testing
 *   - "One-Click Sync" / premium buttons overlaid with locked blurred glass shield
 *   - Records auto-purged 2 hours after creation (handled by DB trigger)
 *
 * Include after auth.js. Call `initSandboxGuard()` on page load.
 */

const SANDBOX_LIMITS = {
  maxDocuments: 3,
  maxVoiceMinutes: 2,
  purgeAfterHours: 2,
};

let _sandboxState = null;

async function initSandboxGuard() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.organization_id) return;

    const { data: org } = await window.supabase
      .from('organizations')
      .select('billing_status')
      .eq('id', user.organization_id)
      .single();

    if (!org || org.billing_status !== 'guest_trial') return;

    // Fetch usage from developer vault
    const { data: vault } = await window.supabase
      .from('organization_developer_vault')
      .select('demo_files_processed_count, max_demo_files_allowed, demo_voice_minutes_allowed')
      .eq('organization_id', user.organization_id)
      .single();

    _sandboxState = {
      isGuest: true,
      orgId: user.organization_id,
      filesUsed: vault?.demo_files_processed_count || 0,
      filesMax: vault?.max_demo_files_allowed || SANDBOX_LIMITS.maxDocuments,
      voiceMax: vault?.demo_voice_minutes_allowed || SANDBOX_LIMITS.maxVoiceMinutes,
    };

    // Apply UI restrictions
    applyGuestOverlays();
    injectSandboxBanner();
    interceptGuestActions();

  } catch (e) {
    console.warn('[SandboxGuard] init error:', e);
  }
}

function applyGuestOverlays() {
  // Find premium action buttons and overlay with locked glass shield
  const premiumSelectors = [
    '[data-premium]',
    '.sync-btn',
    '.one-click-sync',
    '[onclick*="syncCRM"]',
    '[onclick*="exportCSV"]',
  ];

  premiumSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      wrapWithUpgradeShield(el);
    });
  });
}

function wrapWithUpgradeShield(el) {
  if (el.dataset.shielded) return;
  el.dataset.shielded = 'true';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;';

  const shield = document.createElement('div');
  shield.style.cssText = `
    position:absolute;inset:0;z-index:10;
    background:rgba(255,255,255,0.45);
    backdrop-filter:blur(6px) saturate(120%);
    border-radius:inherit;
    display:flex;align-items:center;justify-content:center;
    cursor:not-allowed;
    border:1px solid rgba(255,255,255,0.25);
  `;
  shield.innerHTML = `
    <span style="font-size:12px;font-weight:600;color:#6b7280;text-align:center;padding:4px 12px;">
      <span style="font-size:16px;">🔒</span><br>Upgrade to unlock
    </span>
  `;
  shield.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    showUpgradeModal();
  };

  el.parentNode.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  wrapper.appendChild(shield);
}

function injectSandboxBanner() {
  const banner = document.createElement('div');
  banner.id = 'sandbox-banner';
  banner.style.cssText = `
    position:fixed;bottom:0;left:0;right:0;z-index:9999;
    background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);
    color:#fff;padding:10px 20px;
    display:flex;align-items:center;justify-content:space-between;
    font-family:var(--font-clean,'Inter',sans-serif);font-size:13px;font-weight:500;
    box-shadow:0 -4px 20px rgba(0,0,0,0.15);
  `;
  banner.innerHTML = `
    <span>🧪 Guest Trial — ${_sandboxState.filesUsed}/${_sandboxState.filesMax} documents used · ${_sandboxState.voiceMax} min voice limit · Data expires in 2 hours</span>
    <button onclick="showUpgradeModal()" style="
      background:#fff;color:#d97706;border:none;padding:6px 16px;
      border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
      transition:all 0.22s;
    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
      Upgrade Now
    </button>
  `;
  document.body.appendChild(banner);
  // Add bottom padding so banner doesn't cover content
  document.body.style.paddingBottom = '52px';
}

function interceptGuestActions() {
  // Intercept file uploads if at limit
  if (_sandboxState.filesUsed >= _sandboxState.filesMax) {
    document.querySelectorAll('input[type="file"]').forEach(input => {
      input.addEventListener('click', (e) => {
        e.preventDefault();
        showLimitReachedToast('document');
      }, true);
    });
  }
}

function showLimitReachedToast(type) {
  const msg = type === 'document'
    ? `Document limit reached (${_sandboxState.filesMax}/${_sandboxState.filesMax}). Upgrade to continue.`
    : `Voice minutes exhausted (${_sandboxState.voiceMax} min). Upgrade to continue.`;

  // Use existing toast function if available, otherwise create one
  if (typeof toast === 'function') {
    toast(msg);
  } else {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:60px;right:20px;z-index:10000;background:#dc2626;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,0.25);transition:opacity 0.3s;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  }
}

function showUpgradeModal() {
  let modal = document.getElementById('upgrade-modal');
  if (modal) { modal.style.display = 'flex'; return; }

  modal = document.createElement('div');
  modal.id = 'upgrade-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.2);">
      <div style="font-size:48px;margin-bottom:12px;">🚀</div>
      <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#1b1b24;">Upgrade Your Plan</h2>
      <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6;">
        You're on the Guest Trial with limited access.<br>
        Upgrade to unlock unlimited documents, voice calls, CRM sync, and automated campaigns.
      </p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button onclick="document.getElementById('upgrade-modal').style.display='none'" style="padding:10px 24px;border-radius:12px;border:1.5px solid #e5e7eb;background:#fff;font-size:13px;font-weight:600;cursor:pointer;color:#374151;">Maybe Later</button>
        <button onclick="window.location.href='developer/credits.html'" style="padding:10px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#4d41df,#6366f1);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">View Plans</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

/**
 * Call before any billable action to check guest limits.
 * Returns true if allowed, false if blocked (shows toast automatically).
 */
function checkGuestDocLimit() {
  if (!_sandboxState?.isGuest) return true;
  if (_sandboxState.filesUsed >= _sandboxState.filesMax) {
    showLimitReachedToast('document');
    return false;
  }
  return true;
}

function checkGuestVoiceLimit() {
  if (!_sandboxState?.isGuest) return true;
  showLimitReachedToast('voice');
  return false;
}

function isGuestTrial() {
  return _sandboxState?.isGuest === true;
}
