/**
 * ClearDesk — intelligent-desk.js
 * Intelligent Desk widget controller.
 * Loads after supabase-config.js + auth.js are in scope.
 * Uses IIFE to avoid global namespace pollution.
 * RLS on tenant_financial_insights handles multi-tenant isolation — no org_id needed client-side.
 */

(function IntelligentDesk() {

  // ── Config ──────────────────────────────────────────────────────
  const TABLE      = 'tenant_financial_insights';
  const STREAM_ID  = 'intelligentDeskStream';
  const SAVINGS_ID = 'txtTotalSavingsOdometer';
  const LIMIT      = 3;

  const TYPE_ICON = {
    info:               '💡',
    optimization_alert: '⚡',
    critical_crunch:    '🚨',
  };

  // ── Currency formatter (jurisdiction-aware) ─────────────────────
  function fmtCurrency(amount) {
    const n = parseFloat(amount) || 0;
    // Use INR as default; org country_code could be wired here later
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 2
    }).format(n);
  }

  // ── Savings odometer rolling counter ───────────────────────────
  function animateSavings(target) {
    const el = document.getElementById(SAVINGS_ID);
    if (!el) return;
    const start = Date.now();
    const dur   = 900;
    const tick  = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtCurrency(target * ease);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = fmtCurrency(target);
    };
    requestAnimationFrame(tick);
  }

  // ── Row renderer ───────────────────────────────────────────────
  function buildRow(insight, idx) {
    const type    = insight.insight_type || 'info';
    const icon    = TYPE_ICON[type] || '💡';
    const savings = parseFloat(insight.projected_savings_amount) || 0;

    const row = document.createElement('div');
    row.className = `insight-stream-row severity-glow-${type}`;
    row.style.cssText = `animation: intelligentDeskIn 0.38s cubic-bezier(0.25,1,0.5,1) ${idx * 0.08}s both;`;
    row.dataset.insightId = insight.id;

    row.innerHTML = `
      <div class="insight-icon-badge insight-icon-${type}">${icon}</div>
      <div class="insight-body">
        <div class="insight-title">${escHtml(insight.metric_title)}</div>
        <div class="insight-summary">${escHtml(insight.detailed_finding_summary)}</div>
        ${savings > 0 ? `<span class="insight-savings">Savings: ${fmtCurrency(savings)}</span>` : ''}
      </div>
      <button class="publish-btn" onclick="IntelligentDesk.publish('${insight.id}', this)">
        Publish ➔
      </button>
    `;
    return row;
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Publish handler ────────────────────────────────────────────
  async function publishInsightToClient(insightId, btn) {
    if (!insightId || !window.supabase) return;
    btn.disabled = true;
    btn.textContent = 'Publishing…';

    const { error } = await window.supabase
      .from(TABLE)
      .update({ is_published_to_taxpayer: true })
      .eq('id', insightId);

    if (error) {
      btn.disabled = false;
      btn.textContent = 'Publish ➔';
      console.error('[IntelligentDesk] publish error:', error.message);
      return;
    }

    btn.textContent = '✓ Published';
    btn.classList.add('published');
    btn.disabled = true;
  }

  // ── Main loader ────────────────────────────────────────────────
  async function load() {
    const stream = document.getElementById(STREAM_ID);
    if (!stream || !window.supabase) return;

    // Loading state already in HTML — leave until data arrives
    const { data, error } = await window.supabase
      .from(TABLE)
      .select('id, insight_type, metric_title, detailed_finding_summary, projected_savings_amount')
      .eq('is_published_to_taxpayer', false)
      .order('created_at', { ascending: false })
      .limit(LIMIT);

    if (error) {
      stream.innerHTML = `<div class="stream-empty">⚠ Could not load insights — ${escHtml(error.message)}</div>`;
      return;
    }

    if (!data || !data.length) {
      stream.innerHTML = `<div class="stream-empty">No pending insights. All clear ✓</div>`;
      return;
    }

    // Aggregate savings
    const totalSavings = data.reduce((sum, r) => sum + (parseFloat(r.projected_savings_amount) || 0), 0);
    animateSavings(totalSavings);

    // Render rows
    stream.innerHTML = '';
    data.forEach((insight, i) => stream.appendChild(buildRow(insight, i)));
  }

  // ── Public API (exposed for onclick handlers) ──────────────────
  window.IntelligentDesk = {
    load,
    publish: publishInsightToClient
  };

  // Auto-init once DOM ready (safe to call multiple times — checks for element)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

})();
