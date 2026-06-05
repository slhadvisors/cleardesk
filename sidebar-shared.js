/**
 * sidebar-shared.js — ClearDesk Neo-Glass Sidebar + PJAX Navigation
 *
 * Injects sidebar nav + workspace shell. Provides:
 *   • Sliding .sb-glider indicator (mirrors topbar capsule-pill, vertical axis)
 *   • PJAX client-side navigation — zero full-page reloads between views
 *   • Browser back/forward via popstate
 *   • Theme toggle (dark ↔ light) persisted to localStorage
 *
 * Usage: <body data-sidebar-active="campaigns">
 *   Supported values: dashboard, campaigns, contacts, calls, sms,
 *                     teams, agents, settings, dev
 *
 * Legacy (hard-navigated, never PJAX): settings.html, ops.html,
 *   developer-portal.html, login.html, reset-password.html, invite.html
 */
(function () {
  'use strict';

  /* ── Theme ──────────────────────────────────────────────────── */
  const savedTheme = localStorage.getItem('cd-theme') || 'dark';
  if (document.body) {
    document.body.classList.remove('theme-dark', 'theme-light', 'text-on-surface');
    document.body.classList.add(savedTheme === 'light' ? 'theme-light' : 'theme-dark');
  }

  /* ── Nav items ──────────────────────────────────────────────── */
  const NAV = [
    { id: 'dashboard',  icon: 'grid_view',      label: 'Dashboard', href: 'index.html' },
    { id: 'campaigns',  icon: 'campaign',        label: 'Campaigns', href: 'campaigns.html' },
    { id: 'contacts',   icon: 'contacts',        label: 'Contacts',  href: 'contacts.html' },
    { id: 'calls',      icon: 'call',            label: 'Calls',     href: 'call-logs.html' },
    { id: 'sms',        icon: 'sms',             label: 'SMS',       href: 'sms-logs.html' },
    { id: 'teams',      icon: 'group',           label: 'Teams',     href: 'team-management.html' },
    { id: 'agents',     icon: 'support_agent',   label: 'Agents',    href: 'agent-detail.html' },
    { id: 'settings',   icon: 'settings',        label: 'Settings',  href: 'settings.html' },
  ];

  /* Pages that must do a full hard-navigation (legacy / security isolation) */
  const HARD_NAV_PAGES = [
    'settings.html', 'ops.html', 'developer-portal.html',
    'login.html', 'reset-password.html', 'invite.html',
  ];

  /* ── Logo SVG ───────────────────────────────────────────────── */
  const LOGO_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none" style="width:20px;height:20px">
    <defs><mask id="sbm"><rect width="100" height="100" fill="white"/>
    <circle cx="50" cy="50" r="20.5" fill="black"/>
    <polygon points="19.5,73.5 61.5,31.5 74,24 66.5,36.5 24.5,78.5" fill="black"/></mask></defs>
    <path fill="currentColor" mask="url(#sbm)" d="M43.88,6.43 A44,44 0 0,1 56.12,6.43 L55.01,14.35 A36,36 0 0,1 71.66,21.25 L76.48,14.86 A44,44 0 0,1 85.14,23.52 L78.75,28.34 A36,36 0 0,1 85.65,44.99 L93.57,43.88 A44,44 0 0,1 93.57,56.12 L85.65,55.01 A36,36 0 0,1 78.75,71.66 L85.14,76.48 A44,44 0 0,1 76.48,85.14 L71.66,78.75 A36,36 0 0,1 55.01,85.65 L56.12,93.57 A44,44 0 0,1 43.88,93.57 L44.99,85.65 A36,36 0 0,1 28.34,78.75 L23.52,85.14 A44,44 0 0,1 14.86,76.48 L21.25,71.66 A36,36 0 0,1 14.35,55.01 L6.43,56.12 A44,44 0 0,1 6.43,43.88 L14.35,44.99 A36,36 0 0,1 21.25,28.34 L14.86,23.52 A44,44 0 0,1 23.52,14.86 L28.34,21.25 A36,36 0 0,1 44.99,14.35 Z"/>
  </svg>`;

  /* ── Helpers ────────────────────────────────────────────────── */
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getSidebarIdFromHref(href) {
    const file = href.split('/').pop().split('?')[0];
    const match = NAV.find(n => n.href === file);
    return match ? match.id : 'dashboard';
  }

  function isHardNav(href) {
    const file = href.split('/').pop().split('?')[0];
    return HARD_NAV_PAGES.includes(file);
  }

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
      <a href="index.html" class="sidebar-brand" title="ClearDesk">
        <div class="sidebar-brand-icon">${LOGO_SVG}</div>
        <span class="sidebar-brand-name">ClearDesk</span>
      </a>
      <div class="sb-glider" aria-hidden="true"></div>
      ${items}
      <div class="sidebar-spacer"></div>
      <button class="sidebar-item" id="sb-theme-btn" title="Toggle theme">
        <span class="md-icon" id="sb-theme-icon" style="font-size:20px">${themeIcon}</span>
        <span class="sidebar-label">Theme</span>
      </button>
      <div class="sidebar-footer">
        <div class="sidebar-avatar-wrap" id="sb-avatar" title="${user ? user.name : 'Sign out'}"
             onclick="if(typeof signOut==='function')signOut()">
          ${avatarContent}
        </div>
        <span class="sidebar-avatar-name" id="sb-avatar-name">${user ? user.name : ''}</span>
      </div>`;
  }

  /* ── Glider positioning ─────────────────────────────────────── */
  function positionGlider(targetItem, instant) {
    const glider = document.querySelector('.sb-glider');
    if (!glider || !targetItem) return;
    if (instant) {
      glider.style.transition = 'none';
      glider.style.top = targetItem.offsetTop + 'px';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        glider.style.transition = '';
      }));
    } else {
      glider.style.top = targetItem.offsetTop + 'px';
    }
  }

  /* ── Update sidebar active state ────────────────────────────── */
  let _sidebar = null; // set in init()

  function setActiveNav(newId) {
    if (!_sidebar) return;
    _sidebar.querySelectorAll('.sidebar-item--active').forEach(el => {
      el.classList.remove('sidebar-item--active');
      const dot = el.querySelector('.sidebar-dot');
      if (dot) dot.remove();
    });
    const target = _sidebar.querySelector(`a[href="${NAV.find(n => n.id === newId)?.href || ''}"]`);
    if (!target) return;
    target.classList.add('sidebar-item--active');
    const dot = document.createElement('span');
    dot.className = 'sidebar-dot';
    target.insertBefore(dot, target.firstChild);
    positionGlider(target, false);
    document.body.dataset.sidebarActive = newId;
  }

  /* ── PJAX content loader ────────────────────────────────────── */
  async function pjaxNavigate(href) {
    /* Hard-nav for legacy/security pages */
    if (isHardNav(href)) {
      document.body.classList.add('page-exiting');
      await sleep(200);
      window.location.href = href;
      return;
    }

    const canvas = document.querySelector('.workspace-canvas > div');
    if (!canvas) { window.location.href = href; return; }

    /* ── Transition out ── */
    canvas.style.cssText += ';transition:opacity .18s ease,transform .18s ease;opacity:0;transform:translateY(8px);';
    await sleep(180);

    try {
      const res = await fetch(href, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      /* Determine new active sidebar id */
      const newId = doc.body.dataset.sidebarActive || getSidebarIdFromHref(href);

      /* Extract <main> or outermost content wrapper */
      const newMain = doc.querySelector('main') ||
                      doc.querySelector('.relative.z-10') ||
                      doc.querySelector('[class*="min-h-screen"]');
      if (!newMain) throw new Error('No main content found');

      /* ── Remove previous PJAX scripts to avoid re-declaration errors ── */
      document.querySelectorAll('script[data-pjax]').forEach(s => s.remove());

      /* ── Swap content ── */
      canvas.innerHTML = newMain.outerHTML;

      /* ── Collect & execute page scripts ──
         Monkey-patch addEventListener so DOMContentLoaded handlers
         are captured instead of registered (they'd never fire in PJAX).
         We call them manually after injection.
      ── */
      const initFns = [];
      const _origAddEL = document.addEventListener.bind(document);
      document.addEventListener = function (type, fn, ...rest) {
        if (type === 'DOMContentLoaded') { initFns.push(fn); return; }
        _origAddEL(type, fn, ...rest);
      };

      /* Collect non-CDN, non-tailwind inline scripts from the fetched page */
      const scripts = Array.from(doc.querySelectorAll('script:not([src])'))
        .filter(s => {
          const t = s.textContent.trim();
          return t.length > 60 &&
            !t.startsWith('tailwind.config') &&
            !t.includes('tailwind.config =');
        });

      for (const s of scripts) {
        let code = s.textContent;

        /* Convert module-level let/const to var so re-navigation doesn't
           throw "already been declared" errors */
        code = code.replace(/^let\s+/gm, 'var ');
        code = code.replace(/^const\s+/gm, 'var ');

        /* Handle JSX/React scripts (type="text/babel") */
        if (s.type === 'text/babel' && window.Babel) {
          try {
            code = window.Babel.transform(code, { presets: ['react'] }).code;
          } catch (e) {
            console.warn('[PJAX] Babel transform failed:', e);
            continue;
          }
        }

        const tag = document.createElement('script');
        tag.setAttribute('data-pjax', '1');
        tag.textContent = code;
        try {
          document.body.appendChild(tag);
        } catch (e) {
          console.warn('[PJAX] Script injection error:', e);
        }
      }

      /* Restore addEventListener */
      document.addEventListener = _origAddEL;

      /* Call captured DOMContentLoaded init functions */
      for (const fn of initFns) {
        try { await fn(); } catch (e) {
          console.warn('[PJAX] Init function error:', e);
        }
      }

      /* ── Update URL + sidebar + title ── */
      history.pushState({ href, pjax: true }, doc.title, href);
      document.title = doc.title;
      setActiveNav(newId);

      /* ── Transition in ── */
      canvas.style.opacity = '0';
      canvas.style.transform = 'translateY(8px)';
      await sleep(16); // one frame
      canvas.style.transition = 'opacity .26s cubic-bezier(0.25,1,0.5,1), transform .26s cubic-bezier(0.25,1,0.5,1)';
      canvas.style.opacity = '1';
      canvas.style.transform = 'translateY(0)';
      setTimeout(() => { canvas.style.transition = ''; }, 300);

      /* Scroll content to top */
      canvas.scrollTop = 0;

    } catch (e) {
      console.warn('[PJAX] Navigation failed, hard-navigating:', e);
      window.location.href = href;
    }
  }

  /* ── Inject ambient canvas ──────────────────────────────────── */
  function injectAmbient() {
    if (document.querySelector('.ambient-canvas')) return;
    const el = document.createElement('div');
    el.className = 'ambient-canvas';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="orb orb-1"></div><div class="orb orb-2"></div><div class="orb orb-3"></div><div class="grid-overlay"></div>';
    document.body.insertBefore(el, document.body.firstChild);
  }

  /* ── Main init ──────────────────────────────────────────────── */
  function init() {
    /* Legacy pages keep their own layout entirely — no shell injection */
    const currentFile = window.location.pathname.split('/').pop() || 'index.html';
    const LEGACY_LAYOUT_PAGES = ['settings.html', 'ops.html', 'developer-portal.html'];
    if (LEGACY_LAYOUT_PAGES.includes(currentFile)) {
      document.body.classList.remove('theme-dark', 'theme-light', 'text-on-surface');
      document.body.classList.add(savedTheme === 'light' ? 'theme-light' : 'theme-dark');
      return;
    }

    document.body.classList.remove('theme-dark', 'theme-light', 'text-on-surface');
    document.body.classList.add(savedTheme === 'light' ? 'theme-light' : 'theme-dark');

    const activeId = document.body.dataset.sidebarActive || 'dashboard';

    const oldAmbient = document.querySelector('.ambient-bg');
    if (oldAmbient) oldAmbient.remove();
    injectAmbient();

    const oldNav = document.querySelector('nav.glass-nav, nav.sticky');
    if (oldNav) oldNav.remove();

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
    _sidebar = sidebar; // store ref for setActiveNav

    /* Workspace canvas */
    const canvas = document.createElement('div');
    canvas.className = 'workspace-canvas';
    const pageContent = document.createElement('div');
    pageContent.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';
    bodyChildren.forEach(el => pageContent.appendChild(el));
    canvas.appendChild(pageContent);

    shell.appendChild(sidebar);
    shell.appendChild(canvas);
    document.body.appendChild(shell);

    /* Snap glider to active item */
    const activeItem = sidebar.querySelector('.sidebar-item--active');
    positionGlider(activeItem, true);

    /* ── PJAX nav link handler ── */
    sidebar.querySelectorAll('a.sidebar-item').forEach(link => {
      link.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (!href || href === '#') return;

        /* Same page — no-op */
        const currentFile = window.location.pathname.split('/').pop() || 'index.html';
        if (href === currentFile) return;

        e.preventDefault();

        /* Optimistic sidebar update */
        positionGlider(this, false);
        sidebar.querySelectorAll('.sidebar-item--active').forEach(el => {
          el.classList.remove('sidebar-item--active');
          const dot = el.querySelector('.sidebar-dot');
          if (dot) dot.remove();
        });
        this.classList.add('sidebar-item--active');
        const dot = document.createElement('span');
        dot.className = 'sidebar-dot';
        this.insertBefore(dot, this.firstChild);

        pjaxNavigate(href);
      });
    });

    /* ── Logo click → PJAX to dashboard ── */
    const logoLink = sidebar.querySelector('.sidebar-logo');
    if (logoLink) {
      logoLink.addEventListener('click', function (e) {
        const currentFile = window.location.pathname.split('/').pop() || 'index.html';
        if (currentFile === 'index.html') return;
        e.preventDefault();
        pjaxNavigate('index.html');
      });
    }

    /* ── Browser back/forward (popstate) ── */
    window.addEventListener('popstate', function (e) {
      const href = (e.state && e.state.href) || window.location.pathname.split('/').pop() || 'index.html';
      if (!e.state || !e.state.pjax) {
        /* Initial entry — hard reload is fine */
        window.location.reload();
        return;
      }
      pjaxNavigate(href);
    });

    /* ── Resize: re-snap glider ── */
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const active = sidebar.querySelector('.sidebar-item--active');
        positionGlider(active, true);
      }, 80);
    });

    /* ── Theme toggle ── */
    document.getElementById('sb-theme-btn').addEventListener('click', () => {
      const curr = localStorage.getItem('cd-theme') || 'dark';
      const next = curr === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cd-theme', next);
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(next === 'light' ? 'theme-light' : 'theme-dark');
      const icon = document.getElementById('sb-theme-icon');
      if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    });

    /* ── Load avatar async ── */
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
        const nameEl = document.getElementById('sb-avatar-name');
        if (nameEl) nameEl.textContent = name.split(' ')[0]; /* first name only */
      } catch (_) {}
    })();
  }

  /* ── Run after DOM ready ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
