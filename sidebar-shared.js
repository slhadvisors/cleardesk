/**
 * sidebar-shared.js — ClearDesk app shell (sidebar + topbar)
 * Rebuilt: reliable, no PJAX. Injects a persistent left rail + topbar and
 * wraps existing page content. Styled by theme-hub.css (.dash-shell, .sidebar,
 * .sidebar-item, .workspace-canvas, .shared-topbar ...).
 *
 * Usage: <body data-sidebar-active="dashboard">
 *   ids: dashboard campaigns contacts calls sms teams agents settings profile
 */
(function () {
  'use strict';

  /* Pages that get the app shell. Everything else (marketing, auth, ops,
     developer, settings' own layout) is left untouched. */
  var SHELL_PAGES = [
    'app.html', 'campaigns.html', 'contacts.html', 'call-logs.html',
    'sms-logs.html', 'team-management.html', 'agent-detail.html',
    'agents.html', 'profile.html'
  ];

  var file = (window.location.pathname.split('/').pop() || 'app.html');
  var savedTheme = localStorage.getItem('cd-theme') || 'dark';

  function applyTheme(t) {
    document.body.classList.remove('theme-dark', 'theme-light', 'text-on-surface');
    document.body.classList.add(t === 'light' ? 'theme-light' : 'theme-dark');
  }

  if (SHELL_PAGES.indexOf(file) === -1) {
    if (document.body) applyTheme(savedTheme);
    return; /* not an app page — do nothing else */
  }

  var LOGO = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h13" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>';

  var NAV = [
    { label: null, items: [
      { id: 'dashboard', icon: 'grid_view', label: 'Dashboard', href: 'app.html' }
    ]},
    { label: 'Outreach', items: [
      { id: 'campaigns', icon: 'campaign',  label: 'Campaigns', href: 'campaigns.html' },
      { id: 'contacts',  icon: 'contacts',  label: 'Contacts',  href: 'contacts.html' }
    ]},
    { label: 'Activity', items: [
      { id: 'calls', icon: 'call', label: 'Calls', href: 'call-logs.html' },
      { id: 'sms',   icon: 'sms',  label: 'SMS',   href: 'sms-logs.html' }
    ]},
    { label: 'Workspace', items: [
      { id: 'teams',  icon: 'group',         label: 'Teams',  href: 'team-management.html' },
      { id: 'agents', icon: 'support_agent', label: 'Agents', href: 'agent-detail.html' }
    ]},
    { label: 'Account', items: [
      { id: 'settings', icon: 'settings', label: 'Settings', href: 'settings.html' }
    ]}
  ];

  var MOBILE = ['dashboard', 'campaigns', 'contacts', 'calls', 'sms'];

  function icon(name, size) { return '<span class="md-icon" style="font-size:' + (size || 20) + 'px">' + name + '</span>'; }

  function sidebarHTML(active) {
    var groups = NAV.map(function (g) {
      var lbl = g.label ? '<span class="sidebar-section-label">' + g.label + '</span>' : '';
      var items = g.items.map(function (n) {
        var on = n.id === active ? ' sidebar-item--active' : '';
        return '<a href="' + n.href + '" class="sidebar-item' + on + '" data-nav="' + n.id + '" title="' + n.label + '">' +
                 icon(n.icon) + '<span class="sidebar-label">' + n.label + '</span></a>';
      }).join('');
      return '<div class="sidebar-group">' + lbl + items + '</div>';
    }).join('');

    var themeIcon = (savedTheme === 'dark') ? 'light_mode' : 'dark_mode';
    return '' +
      '<a href="app.html" class="sidebar-brand" title="ClearDesk">' +
        '<div class="sidebar-brand-icon">' + LOGO + '</div>' +
        '<span class="sidebar-brand-name">ClearDesk</span>' +
      '</a>' +
      groups +
      '<div class="sidebar-spacer"></div>' +
      '<button class="sidebar-item" id="sb-theme-btn" title="Toggle theme" type="button">' +
        icon(themeIcon) + '<span class="sidebar-label" id="sb-theme-label">Theme</span>' +
      '</button>' +
      '<a href="profile.html" class="sidebar-footer" title="My profile">' +
        '<div class="sidebar-avatar-wrap" id="sb-avatar"><span id="sb-initials" style="font-size:13px;font-weight:700">—</span></div>' +
        '<span class="sidebar-avatar-name" id="sb-avatar-name">Profile</span>' +
      '</a>';
  }

  function topbarHTML(active) {
    var title = 'Dashboard';
    NAV.forEach(function (g) { g.items.forEach(function (n) { if (n.id === active) title = n.label; }); });
    return '' +
      '<div class="st-left"><span class="st-page-title">' + title + '</span></div>' +
      '<div class="st-right">' +
        '<a class="st-icon-btn" href="help.html" title="Help" aria-label="Help">' + icon('help', 18) + '</a>' +
        '<div class="st-profile-chip">' +
          '<div class="st-avatar" id="sb-topbar-avatar"><span id="sb-topbar-initials">—</span></div>' +
          '<div class="st-profile-info">' +
            '<div class="st-name" id="sb-topbar-name">—</div>' +
            '<div class="st-role" id="sb-topbar-role">—</div>' +
          '</div>' +
          '<button class="st-logout" id="sb-logout" title="Sign out" aria-label="Sign out" type="button">' + icon('logout', 14) + '</button>' +
        '</div>' +
      '</div>';
  }

  function mobileNavHTML(active) {
    return MOBILE.map(function (id) {
      var n; NAV.forEach(function (g) { g.items.forEach(function (x) { if (x.id === id) n = x; }); });
      if (!n) return '';
      var on = id === active ? ' mob-nav-item--active' : '';
      return '<a class="mob-nav-item' + on + '" href="' + n.href + '" aria-label="' + n.label + '">' +
               icon(n.icon, 22) + '<span>' + n.label + '</span></a>';
    }).join('');
  }

  function build() {
    applyTheme(savedTheme);
    var active = document.body.dataset.sidebarActive || 'dashboard';

    var children = Array.prototype.slice.call(document.body.children).filter(function (el) {
      return el.tagName !== 'SCRIPT';
    });

    var shell = document.createElement('div');
    shell.className = 'dash-shell';

    var sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.setAttribute('aria-label', 'Primary navigation');
    sidebar.innerHTML = sidebarHTML(active);

    var canvas = document.createElement('div');
    canvas.className = 'workspace-canvas';

    var topbar = document.createElement('header');
    topbar.className = 'shared-topbar';
    topbar.innerHTML = topbarHTML(active);
    canvas.appendChild(topbar);

    var page = document.createElement('div');
    page.className = 'page-content';
    page.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';
    children.forEach(function (el) { page.appendChild(el); });
    canvas.appendChild(page);

    shell.appendChild(sidebar);
    shell.appendChild(canvas);
    document.body.appendChild(shell);

    var mob = document.createElement('nav');
    mob.className = 'mob-nav';
    mob.setAttribute('aria-label', 'Mobile navigation');
    mob.innerHTML = mobileNavHTML(active);
    document.body.appendChild(mob);

    wire();
    hydrateUser();
  }

  function wire() {
    var tbtn = document.getElementById('sb-theme-btn');
    if (tbtn) tbtn.addEventListener('click', function () {
      var next = (localStorage.getItem('cd-theme') || 'dark') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cd-theme', next);
      savedTheme = next;
      applyTheme(next);
      var ic = tbtn.querySelector('.md-icon');
      if (ic) ic.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    });
    var lo = document.getElementById('sb-logout');
    if (lo) lo.addEventListener('click', async function () {
      try { if (window.supabase) await window.supabase.auth.signOut(); } catch (e) {}
      window.location.href = 'login.html';
    });
  }

  async function hydrateUser() {
    if (!window.supabase || !window.supabase.auth) return;
    try {
      var res = await window.supabase.auth.getSession();
      var session = res && res.data ? res.data.session : null;
      if (!session) return;
      var u = session.user || {};
      var meta = u.user_metadata || {};
      var app = u.app_metadata || {};
      var name = meta.full_name || meta.display_name || (u.email || '').split('@')[0] || 'User';
      name = name.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      var initials = name.split(' ').map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
      var role = (app.user_role || 'ORG_STAFF').replace('ORG_', '').replace(/_/g, ' ');
      role = role.charAt(0) + role.slice(1).toLowerCase();
      var firm = meta.firm_name || '';

      set('sb-initials', initials); set('sb-avatar-name', name.split(' ')[0]);
      set('sb-topbar-initials', initials); set('sb-topbar-name', name);
      set('sb-topbar-role', firm ? (role + ' · ' + firm) : role);
      if (meta.avatar_url) {
        var img = '<img src="' + meta.avatar_url + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.remove()">';
        var a = document.getElementById('sb-avatar'); if (a) a.innerHTML = img + a.innerHTML;
        var b = document.getElementById('sb-topbar-avatar'); if (b) b.innerHTML = img;
      }
    } catch (e) {}
  }
  function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
