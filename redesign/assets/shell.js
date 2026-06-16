/* ClearDesk redesign — AppShell injector (reference prototype)
   Renders the floating sidebar, topbar and mobile bottom nav.
   Usage: <body data-page="campaigns"> ... <script src="assets/shell.js"></script>
   In production this becomes a React <AppShell> component. */
(function () {
  var I = {
    dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    campaigns:'<path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    contacts:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    calls:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    sms:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    teams:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    agents:'<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    help:'<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu:'<path d="M3 12h18M3 6h18M3 18h18"/>'
  };
  var NAV = [
    {g:null,        items:[['dashboard','Dashboard','app.html']]},
    {g:'Outreach',  items:[['campaigns','Campaigns','campaigns.html','4'],['contacts','Contacts','contacts.html']]},
    {g:'Activity',  items:[['calls','Calls','call-logs.html','28'],['sms','SMS','sms-logs.html']]},
    {g:'Workspace', items:[['teams','Teams','team-management.html'],['agents','Agents','agents.html']]},
    {g:'Account',   items:[['settings','Settings','settings.html']]}
  ];
  var MOB = [['dashboard','Home','app.html'],['campaigns','Campaigns','campaigns.html'],['contacts','Contacts','contacts.html'],['calls','Calls','call-logs.html'],['sms','SMS','sms-logs.html']];
  var page = document.body.getAttribute('data-page') || 'dashboard';
  function svg(p){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}

  // SIDEBAR
  var nav = '';
  NAV.forEach(function(grp){
    nav += '<div class="sb-group">'+(grp.g?'<p class="sb-label">'+grp.g+'</p>':'');
    grp.items.forEach(function(it){
      var act = it[0]===page?' active':'';
      nav += '<a class="sb-item'+act+'" href="'+it[2]+'">'+svg(I[it[0]])+it[1]+(it[3]?'<span class="sb-badge">'+it[3]+'</span>':'')+'</a>';
    });
    nav += '</div>';
  });
  var sidebar =
    '<aside class="sidebar">'+
      '<div class="sb-brand"><span class="sb-logo"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h13" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></span><span class="sb-word">ClearDesk</span></div>'+
      '<nav class="sb-nav">'+nav+'</nav>'+
      '<div class="sb-foot"><div class="credit"><div class="ct">Credit balance</div><div class="cv mono">$1,284.50</div><div class="cb"><i></i></div><a href="settings.html">Manage billing &rarr;</a></div></div>'+
    '</aside>';

  // TOPBAR
  var topbar =
    '<header class="topbar">'+
      '<button class="icon-btn mtop" aria-label="Menu">'+svg(I.menu)+'</button>'+
      '<div class="search">'+svg(I.search)+'<input type="text" placeholder="Search campaigns, contacts, calls…" aria-label="Search"/></div>'+
      '<div class="tb-right">'+
        '<button class="icon-btn" aria-label="Notifications"><span class="dot"></span>'+svg(I.bell)+'</button>'+
        '<button class="icon-btn" aria-label="Help">'+svg(I.help)+'</button>'+
        '<a class="avatar" href="profile.html" title="Justin Rao">JR</a>'+
      '</div>'+
    '</header>';

  // MOBILE BOTTOM NAV
  var mob = '<nav class="mobnav">';
  MOB.forEach(function(it){
    var act = it[0]===page?' active':'';
    mob += '<a class="mob-item'+act+'" href="'+it[2]+'" aria-label="'+it[1]+'">'+svg(I[it[0]])+'<span>'+it[1]+'</span></a>';
  });
  mob += '</nav>';

  // MOUNT: shell wraps an existing <main class="main"> ... </main> placed by the page
  var app = document.querySelector('.app');
  if (app) {
    app.insertAdjacentHTML('afterbegin', sidebar);
    var main = app.querySelector('.main');
    if (main) main.insertAdjacentHTML('afterbegin', topbar);
    document.body.insertAdjacentHTML('beforeend', mob);
  }
})();
