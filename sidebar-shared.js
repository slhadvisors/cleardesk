/**
 * sidebar-shared.js — ClearDesk Neo-Glass Sidebar Injector
 * Wraps page body content in .dash-shell and injects the
 * shared sidebar navigation. Works on any authenticated page.
 *
 * Usage: <body data-sidebar-active="campaigns">
 *   Supported values: dashboard, campaigns, contacts, calls, sms, settings, dev
 */
(function () {
  'use strict';

  /* ── Theme ──────────────────────────────────────────────────── */
  const savedTheme = localStorage.getItem('cd-theme') || 'dark';
  document.body.classList.remove('theme-dark', 'theme-light', 'text-on-surface');
  document.body.classList.add(savedTheme === 'light' ? 'theme-light' : 'theme-dark');

  /* ── Nav items ──────────────────────────────────────────────── */
  const NAV = [
    { id: 'dashboard',  icon: 'grid_view',      label: 'Dashboard', href: 'index.html' },
    { id: 'campaigns',  icon: 'campaign',        label: 'Campaigns', href: 'campaigns.html' },
    { id: 'contacts',   icon: 'contacts',        label: 'Contacts',  href: 'contacts.html' },
    { id: 'calls',      icon: 'call',            label: 'Calls',     href: 'call-logs.html' },
    { id: 'sms',        icon: 'sms',             label: 'SMS',       href: 'sms-logs.html' },
    { id: 'teams',      icon: 'group',           label: 'Teams',     href: 'team-management.html' },
    { id: 'agents',     icon: 'support_agent',   label: 'Agents',    href: 'agent-detail.html' },
    { id: 'settings',  icon: 'settings',        label: 'Settings',  href: 'settings.html' },
  ];

  /* ── Logo SVG ───────────────────────────────────────────────── */
  const LOGO_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none" style="width:20px;height:20px">
    <defs><mask id="sbm"><rect width="100" height="100" fill="white"/>
    <circle cx="50" cy="50" r="20.5" fill="black"/>
    <polygon points="19.5,73.5 61.5,31.5 74,24 66.5,36.5 24.5,78.5" fill="black"/></mask></defs>
    <path fill="currentColor" mask="url(#sbm)" d="M43.88,6.43 A44,44 0 0,1 56.12,6.43 L55.01,14.35 A36,36 0 0,1 71.66,21.25 L76.48,14.86 A44,44 0 0,1 85.14,23.52 L78.75,28.34 A36,36 0 0,1 85.65,44.99 L93.57,43.88 A44,44 0 0,1 93.57,56.12 L85.65,55.01 A36,36 0 0,1 78.75,71.66 L85.14,76.48 A44,44 0 0,1 76.48,85.14 L71.66,78.75 A36,36 0 0,1 55.01,85.65 L56.12,93.57 A44,44 0 0,1 43.88,93.57 L44.99,85.65 A36,36 0 0,1 28.34,78.75 L23.52,85.14 A44,44 0 0,1 14.86,76.48 L21.25,71.66 A36,36 0 0,1 14.35,55.01 L6.43,56.12 A44,44 0 0,1 6.43,43.88 L14.35,44.99 A36,36 0 0,1 21.25,28.34 L14.86,23.52 A44,44 0 0,1 23.52,14.86 L28.34,21.25 A36,36 0 0,1 44.99,14.35 Z"/>
  </svg>`;

  /* ── Build sidebar HTML ─────────────────────────────────────── */
  function buildSidebar(activeId, user) {
    const items = NAV.map(n => {
      const isActive = n.id === activeId;
      return `<a href="${n.href}" class="sidebar-item${isActive ? ' sidebar-item--active' : ''}" title="${n.label}">
        ${isActive ? '<span class="sidebar-dot"></span>' : ''}
        <span class="md-icon" style="font-size:22px">${n.icon}</span>
        <span class="sidebar-label">${n.label}</span>
      </a>`;
    }).join('');

    const initials = user ? user.initials : '?';
    const avatarContent = (user && user.avatarUrl)
      ? `<img src="${user.avatarUrl}" alt="${user.name}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`
      : `<span style="font-size:13px;font-weight:800;color:#0b0f17">${initials}</span>`;

    const themeIcon = (localStorage.getItem('cd-theme') || 'dark') === 'dark' ? 'light_mode' : 'dark_mode';

    return `
      <a href="index.html" class="sidebar-logo" title="ClearDesk">${LOGO_SVG}</a>
      ${items}
      <div class="sidebar-spacer"></div>
      <button class="sidebar-item" id="sb-theme-btn" title="Toggle theme">
        <span class="md-icon" id="sb-theme-icon" style="font-size:20px">${themeIcon}</span>
        <span class="sidebar-label">Theme</span>
      </button>
      <div class="sidebar-avatar-wrap" id="sb-avatar" title="${user ? user.name : 'Sign out'}"
           onclick="if(typeof signOut==='function')signOut()">
        ${avatarContent}
      </div>`;
  }

  /* ── Inject ambient canvas ──────────────────────────────────── */
  function injectAmbient() {
    if (document.querySelector('.ambient-canvas')) return; // already present (old pages have .ambient-bg)
    const el = document.createElement('div');
    el.className = 'ambient-canvas';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="orb orb-1"></div><div class="orb orb-2"></div><div class="orb orb-3"></div><div class="grid-overlay"></div>';
    document.body.insertBefore(el, document.body.firstChild);
  }

  /* ── Main init ──────────────────────────────────────────────── */
  function init() {
    const activeId = document.body.dataset.sidebarActive || 'dashboard';

    /* Remove old ambient-bg div if present */
    const oldAmbient = document.querySelector('.ambient-bg');
    if (oldAmbient) oldAmbient.remove();
    injectAmbient();

    /* Remove old top nav if still in DOM */
    const oldNav = document.querySelector('nav.glass-nav, nav.sticky');
    if (oldNav) oldNav.remove();

    /* Gather all remaining direct body children (skip ambient-canvas) */
    const bodyChildren = Array.from(document.body.children).filter(
      el => !el.classList.contains('ambient-canvas') && !el.id.startsWith('sb-')
    );

    /* Build dash-shell */
    const shell = document.createElement('div');
    shell.className = 'dash-shell';

    /* Sidebar */
    const sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.setAttribute('aria-label', 'Primary navigation');
    sidebar.innerHTML = buildSidebar(activeId, null);

    /* Workspace canvas — move existing children in */
    const canvas = document.createElement('div');
    canvas.className = 'workspace-canvas';
    const pageContent = document.createElement('div');
    pageContent.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';
    bodyChildren.forEach(el => pageContent.appendChild(el));
    canvas.appendChild(pageContent);

    shell.appendChild(sidebar);
    shell.appendChild(canvas);
    document.body.appendChild(shell);

    /* Theme toggle handler */
    document.getElementById('sb-theme-btn').addEventListener('click', () => {
      const curr = localStorage.getItem('cd-theme') || 'dark';
      const next = curr === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cd-theme', next);
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(next === 'light' ? 'theme-light' : 'theme-dark');
      const icon = document.getElementById('sb-theme-icon');
      if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    });

    /* Load user async → update avatar after Supabase ready */
    (async () => {
      try {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (!session) return;
        const meta = session.user.user_metadata || {};
        let name = meta.full_name || meta.display_name || meta.name || '';
        if (!name) name = (session.user.email || '').split('@')[0];
        name = name.replace(/\b\w/g, c => c.toUpperCase());
        const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
        const avatarUrl = meta.avatar_url ||
          `https://api.dicebear.com/8.x/adventurer/svg?seed=${encodeURIComponent(name)}&backgroundColor=transparent`;

        const el = document.getElementById('sb-avatar');
        if (el) {
          el.title = name;
          el.innerHTML = `<img src="${avatarUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover"
            onerror="this.outerHTML='<span style=\\"font-size:13px;font-weight:800;color:#0b0f17\\">${initials}</span>'">`;
        }
      } catch (_) {}
    })();
  }

  /* Run after DOM ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
