// BEGIN LOCAL FAST SWITCH
;
/* Sidebar Fast switch button + theme-adaptive popover above Settings. */
;(() => {
  'use strict';
  if (window.self !== window.top) return;
  if (window.__agyFastSwitchInstalled) return;
  window.__agyFastSwitchInstalled = true;

  const ipc = typeof electron_1 !== 'undefined' ? electron_1.ipcRenderer : null;
  if (!ipc || typeof ipc.invoke !== 'function') return;

  const api = {
    list: () => ipc.invoke('fast-switch:list'),
    syncCurrent: (u) => ipc.invoke('fast-switch:sync-current', u),
    switchTo: (p) => ipc.invoke('fast-switch:switch', p),
    addAccount: (p) => ipc.invoke('fast-switch:add-account', p),
    signOut: (p) => ipc.invoke('fast-switch:sign-out', p),
    remove: (p) => ipc.invoke('fast-switch:remove', p),
  };

  let alive = true;
  let open = false;
  let busy = false;
  let busyText = '';
  let errorText = '';
  let confirmRemoveId = '';
  let currentUser = null;
  let savedAccounts = [];
  let hasActiveCred = false;
  let csrf = '';
  let lastSyncedKey = '';
  let host = null;
  let shadow = null;
  let btnHost = null;
  let btnShadow = null;
  let observer = null;
  let mountTimer = 0;
  let syncTimer = 0;
  let settingsEl = null;

  const clean = (v) => {
    const s = String(v || '').trim();
    return s && s !== '[REDACTED]' ? s : '';
  };

  async function getCsrf(force = false) {
    const find = (s) => clean(String(s || '').match(/"?csrfToken"?\s*:\s*"([^"]+)"/)?.[1]);
    const fromStore = (skip = '') => {
      const out = [];
      try { out.push(clean(localStorage.getItem('agy_session_csrf_token'))); } catch {}
      if (typeof document.cookie === 'string') {
        try {
          const hit = document.cookie.split('; ').find((x) => x.startsWith('csrfToken='));
          if (hit) out.push(clean(hit.slice(10)));
        } catch {}
      }
      return out.find((v) => v && v !== skip) || '';
    };
    const prev = force ? csrf : '';
    if (force) csrf = '';
    if (!csrf && !force) {
      csrf = fromStore() || [...document.scripts].map((s) => find(s.textContent)).find(Boolean) || '';
    }
    if (!csrf) {
      try {
        const r = await fetch('/', { cache: 'no-store' });
        if (r.ok) csrf = find(await r.text());
      } catch {}
    }
    if (!csrf && force) csrf = fromStore(prev);
    return csrf;
  }

  async function lsRpc(method, body = '{}') {
    if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(location.origin)) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getCsrf(attempt > 0);
      if (!token) return null;
      const r = await fetch('/exa.language_server_pb.LanguageServerService/' + method, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': token,
        },
        body,
      }).catch(() => null);
      if (!r) return null;
      if (r.status === 401 || r.status === 403) {
        csrf = '';
        continue;
      }
      return r.ok ? r.json().catch(() => null) : null;
    }
    return null;
  }

  function extractPlan(st) {
    const raw =
      st?.userTier?.name ||
      st?.planStatus?.planInfo?.planName ||
      st?.planInfo?.planName ||
      (st?.pro ? 'Pro' : '');
    return String(raw || '').trim();
  }

  async function refreshState(sync = true) {
    if (!alive) return;
    try {
      const userRes = await lsRpc('GetUserStatus');
      const st = userRes?.userStatus;
      if (st && typeof st.email === 'string' && st.email.includes('@')) {
        currentUser = {
          email: st.email.trim(),
          name: String(st.name || '').trim() || st.email.split('@')[0],
          plan: extractPlan(st),
        };
        const syncKey = `${currentUser.email}|${currentUser.name}|${currentUser.plan}`;
        if (sync && syncKey !== lastSyncedKey) {
          lastSyncedKey = syncKey;
          await api.syncCurrent(currentUser).catch(() => {});
        }
      } else {
        currentUser = null;
      }
      const listRes = await api.list();
      savedAccounts = Array.isArray(listRes?.accounts) ? listRes.accounts : [];
      hasActiveCred = Boolean(listRes?.hasActiveCred);
    } catch {}
    render();
  }

  function readThemePalette() {
    const shell = document.querySelector('.agy-shell') || document.body;
    const cs = getComputedStyle(shell);
    const bodyCs = getComputedStyle(document.body);
    const pick = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim() || bodyCs.getPropertyValue(name).trim();
      return v || fallback;
    };
    const isLight = document.body.dataset.awMode === 'light';
    return {
      isLight,
      panel: pick('--popover', isLight ? '#f6f7fb' : '#0a081e'),
      card: pick('--card', isLight ? '#ffffff' : '#181436'),
      border: pick('--border', isLight ? '#d0d5e2' : '#3c3570'),
      fg: pick('--foreground', isLight ? '#171923' : '#eeeaff'),
      muted: pick('--muted-foreground', isLight ? '#5a6275' : '#b8b0d8'),
      accent: pick('--primary', isLight ? '#5b46c4' : '#b9a3ff'),
      sidebar: pick('--sidebar', isLight ? '#eef0f6' : '#09071c'),
      font: bodyCs.fontFamily || 'system-ui, -apple-system, sans-serif',
    };
  }

  function findSettingsButton() {
    const sidebar =
      document.querySelector('[aria-label="Sidebar"]') ||
      document.querySelector('nav.bg-sidebar') ||
      document.querySelector('.agy-inset-shell > div:first-child');
    const root = sidebar || document;
    const candidates = root.querySelectorAll('button, a, [role="button"]');
    let best = null;
    for (const el of candidates) {
      if (el.id === 'agy-fast-switch-btn-host' || el.closest('#agy-fast-switch-btn-host')) continue;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Settings$/i.test(txt)) {
        const r = el.getBoundingClientRect();
        if (r.width > 16 && r.height > 16 && r.left < 380 && r.top > window.innerHeight * 0.45) {
          best = el;
        }
      }
    }
    return best;
  }

  function svgEl(paths, size = 15, strokeWidth = 1.65) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', String(strokeWidth));
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const p = document.createElementNS(ns, d.tag || 'path');
      for (const [k, v] of Object.entries(d)) {
        if (k !== 'tag') p.setAttribute(k, String(v));
      }
      s.appendChild(p);
    }
    return s;
  }

  function iconSwitch(size = 15) {
    return svgEl([
      { d: 'M16 3l4 4-4 4' },
      { d: 'M20 7H9a4 4 0 0 0-4 4v1' },
      { d: 'M8 21l-4-4 4-4' },
      { d: 'M4 17h11a4 4 0 0 0 4-4v-1' },
    ], size);
  }

  function iconUserPlus(size = 14) {
    return svgEl([
      { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
      { tag: 'circle', cx: '9', cy: '7', r: '4' },
      { d: 'M19 8v6' },
      { d: 'M22 11h-6' },
    ], size);
  }

  function iconTrash(size = 13) {
    return svgEl([
      { d: 'M3 6h18' },
      { d: 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' },
      { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' },
    ], size);
  }

  function iconRefresh(size = 13) {
    return svgEl([
      { d: 'M21 12a9 9 0 1 1-2.64-6.36' },
      { d: 'M21 3v6h-6' },
    ], size);
  }

  function iconLogOut(size = 13) {
    return svgEl([
      { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' },
      { d: 'M16 17l5-5-5-5' },
      { d: 'M21 12H9' },
    ], size);
  }

  function iconCheck(size = 12) {
    return svgEl([{ d: 'M20 6L9 17l-5-5' }], size, 2);
  }

  function iconX(size = 12) {
    return svgEl([{ d: 'M18 6L6 18' }, { d: 'M6 6l12 12' }], size, 2);
  }

  function initialsOf(acc) {
    const src = (acc?.name || acc?.email || '?').trim();
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  }

  function shortPlan(plan) {
    if (!plan) return '';
    return plan
      .replace(/^Google\s+AI\s+/i, '')
      .replace(/^Antigravity\s+/i, '')
      .trim() || plan;
  }

  function ensurePopoverHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'agy-fast-switch-host';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        .fs-panel {
          position: fixed;
          pointer-events: auto;
          width: 308px;
          max-width: calc(100vw - 20px);
          max-height: min(440px, calc(100vh - 88px));
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px;
          border-radius: 10px;
          font-family: var(--fs-font);
          color: var(--fs-fg);
          background: color-mix(in srgb, var(--fs-panel) 90%, transparent);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid color-mix(in srgb, var(--fs-border) 55%, transparent);
          box-shadow: 0 14px 40px rgba(0,0,0,0.48), 0 0 0 1px color-mix(in srgb, var(--fs-accent) 14%, transparent);
          transform-origin: bottom left;
        }
        .fs-panel[hidden] { display: none; }
        .fs-panel:not([hidden]) { animation: fs-pop .14s cubic-bezier(.16,1,.3,1); }
        @keyframes fs-pop {
          from { opacity: 0; transform: translateY(6px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .fs-head {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 2px 4px 4px;
          border-bottom: 1px solid color-mix(in srgb, var(--fs-border) 35%, transparent);
        }
        .fs-head-title {
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .fs-count {
          font-size: 10.5px;
          color: var(--fs-muted);
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--fs-fg) 8%, transparent);
          font-variant-numeric: tabular-nums;
        }
        .fs-spacer { flex: 1; }
        .fs-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--fs-muted);
          cursor: pointer;
          transition: background .12s ease, color .12s ease;
        }
        .fs-icon-btn:hover {
          background: color-mix(in srgb, var(--fs-fg) 10%, transparent);
          color: var(--fs-fg);
        }
        .fs-icon-btn.danger:hover {
          background: color-mix(in srgb, #ff5d73 16%, transparent);
          color: #ff7b8d;
        }
        .fs-list {
          display: flex;
          flex-direction: column;
          gap: 5px;
          overflow-y: auto;
          max-height: 260px;
          padding-right: 2px;
          scrollbar-width: thin;
        }
        .fs-row {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 8px;
          border-radius: 8px;
          border: 1px solid color-mix(in srgb, var(--fs-border) 32%, transparent);
          background: color-mix(in srgb, var(--fs-card) 58%, transparent);
          cursor: pointer;
          text-align: left;
          transition: background .12s ease, border-color .12s ease;
          min-width: 0;
        }
        .fs-row:hover {
          background: color-mix(in srgb, var(--fs-card) 88%, transparent);
          border-color: color-mix(in srgb, var(--fs-accent) 42%, transparent);
        }
        .fs-row[data-active="true"] {
          background: color-mix(in srgb, var(--fs-accent) 14%, var(--fs-card));
          border-color: color-mix(in srgb, var(--fs-accent) 48%, transparent);
        }
        .fs-row[data-disabled="true"] {
          opacity: 0.6;
          cursor: default;
        }
        .fs-avatar {
          position: relative;
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: var(--fs-fg);
          background: color-mix(in srgb, var(--fs-accent) 22%, var(--fs-card));
          border: 1px solid color-mix(in srgb, var(--fs-accent) 40%, transparent);
        }
        .fs-dot {
          position: absolute;
          right: -1px;
          bottom: -1px;
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #5eead4;
          border: 1.5px solid var(--fs-panel);
          box-shadow: 0 0 8px rgba(94, 234, 212, 0.55);
        }
        .fs-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .fs-top {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }
        .fs-name {
          font-size: 12px;
          font-weight: 500;
          color: var(--fs-fg);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fs-tier {
          flex-shrink: 0;
          font-size: 10px;
          font-weight: 500;
          padding: 1px 5px;
          border-radius: 4px;
          color: var(--fs-accent);
          background: color-mix(in srgb, var(--fs-accent) 16%, transparent);
          border: 1px solid color-mix(in srgb, var(--fs-accent) 28%, transparent);
        }
        .fs-email {
          font-size: 11px;
          color: var(--fs-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fs-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }
        .fs-active-pill {
          font-size: 10px;
          font-weight: 600;
          color: var(--fs-accent);
          padding: 2px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--fs-accent) 14%, transparent);
        }
        .fs-empty {
          padding: 14px 8px;
          text-align: center;
          font-size: 11.5px;
          color: var(--fs-muted);
          line-height: 1.45;
        }
        .fs-foot {
          display: flex;
          align-items: center;
          gap: 6px;
          padding-top: 4px;
          border-top: 1px solid color-mix(in srgb, var(--fs-border) 35%, transparent);
        }
        .fs-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 30px;
          padding: 0 10px;
          border-radius: 7px;
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background .12s ease, border-color .12s ease, opacity .12s ease;
        }
        .fs-btn-primary {
          flex: 1;
          color: var(--fs-fg);
          background: color-mix(in srgb, var(--fs-accent) 16%, var(--fs-card));
          border: 1px solid color-mix(in srgb, var(--fs-accent) 42%, transparent);
        }
        .fs-btn-primary:hover:not(:disabled) {
          background: color-mix(in srgb, var(--fs-accent) 24%, var(--fs-card));
          border-color: var(--fs-accent);
        }
        .fs-btn-ghost {
          color: var(--fs-muted);
          background: transparent;
          border: 1px solid color-mix(in srgb, var(--fs-border) 40%, transparent);
        }
        .fs-btn-ghost:hover:not(:disabled) {
          color: var(--fs-fg);
          background: color-mix(in srgb, var(--fs-fg) 8%, transparent);
        }
        .fs-btn:disabled { opacity: 0.5; cursor: wait; }
        .fs-status {
          font-size: 11px;
          color: var(--fs-muted);
          padding: 2px 4px 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fs-status.err { color: #ff8596; }
      </style>
      <div class="fs-panel" hidden role="dialog" aria-label="Fast switch accounts"></div>
    `;
    document.body.appendChild(host);
  }

  function applyPaletteVars() {
    const p = readThemePalette();
    if (host) {
      host.style.setProperty('--fs-panel', p.panel);
      host.style.setProperty('--fs-card', p.card);
      host.style.setProperty('--fs-border', p.border);
      host.style.setProperty('--fs-fg', p.fg);
      host.style.setProperty('--fs-muted', p.muted);
      host.style.setProperty('--fs-accent', p.accent);
      host.style.setProperty('--fs-font', p.font);
    }
    if (btnHost) {
      btnHost.style.setProperty('--fs-fg', p.fg);
      btnHost.style.setProperty('--fs-muted', p.muted);
      btnHost.style.setProperty('--fs-accent', p.accent);
      btnHost.style.setProperty('--fs-card', p.card);
      btnHost.style.setProperty('--fs-font', p.font);
    }
  }

  function positionPanel() {
    if (!shadow || !open) return;
    const panel = shadow.querySelector('.fs-panel');
    if (!panel || !btnHost) return;
    const r = btnHost.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 318));
    const bottom = Math.max(12, window.innerHeight - r.top + 8);
    panel.style.left = Math.round(left) + 'px';
    panel.style.bottom = Math.round(bottom) + 'px';
  }

  function togglePanel(next) {
    open = typeof next === 'boolean' ? next : !open;
    confirmRemoveId = '';
    errorText = '';
    if (open) {
      ensurePopoverHost();
      applyPaletteVars();
      render();
      positionPanel();
      void refreshState(true);
    } else {
      render();
    }
  }

  async function runAction(label, fn) {
    if (busy) return;
    busy = true;
    busyText = label;
    errorText = '';
    render();
    try {
      await fn();
      open = false;
      confirmRemoveId = '';
    } catch (e) {
      errorText = String(e?.message || e || 'Operation failed');
    } finally {
      busy = false;
      busyText = '';
      render();
    }
  }

  function renderButton() {
    if (!btnShadow) return;
    const btn = btnShadow.querySelector('.fs-nav-btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', String(open));
    btn.toggleAttribute('data-open', open);
    const narrow = btnHost && btnHost.getBoundingClientRect().width < 96;
    const label = btnShadow.querySelector('.fs-nav-label');
    const pill = btnShadow.querySelector('.fs-nav-pill');
    if (label) label.hidden = Boolean(narrow);
    if (pill) {
      const activeText = currentUser?.email ? currentUser.email.split('@')[0] : '';
      pill.textContent = activeText;
      pill.hidden = Boolean(narrow || !activeText);
      pill.title = currentUser?.email || '';
    }
  }

  function render() {
    applyPaletteVars();
    renderButton();
    if (!shadow) return;
    const panel = shadow.querySelector('.fs-panel');
    if (!panel) return;
    panel.hidden = !open;
    if (!open) return;

    const head = document.createElement('div');
    head.className = 'fs-head';
    const title = document.createElement('span');
    title.className = 'fs-head-title';
    title.textContent = 'Fast switch';
    const count = document.createElement('span');
    count.className = 'fs-count';
    count.textContent = String(savedAccounts.length);
    const spacer = document.createElement('span');
    spacer.className = 'fs-spacer';
    const refBtn = document.createElement('button');
    refBtn.type = 'button';
    refBtn.className = 'fs-icon-btn';
    refBtn.title = 'Refresh';
    refBtn.setAttribute('aria-label', 'Refresh');
    refBtn.appendChild(iconRefresh(13));
    refBtn.onclick = () => void refreshState(true);
    head.append(iconSwitch(14), title, count, spacer, refBtn);

    const list = document.createElement('div');
    list.className = 'fs-list';

    const curEmail = (currentUser?.email || '').toLowerCase();
    const displayList = [...savedAccounts];
    if (currentUser && !displayList.some((a) => a.email.toLowerCase() === curEmail)) {
      displayList.unshift({
        id: '',
        email: currentUser.email,
        name: currentUser.name,
        plan: currentUser.plan,
        hasCred: hasActiveCred,
        unsaved: true,
      });
    }

    if (!displayList.length) {
      const empty = document.createElement('div');
      empty.className = 'fs-empty';
      empty.textContent = 'No saved accounts yet. Sign in or click Add account below.';
      list.appendChild(empty);
    } else {
      for (const acc of displayList) {
        const isActive = Boolean(curEmail && acc.email.toLowerCase() === curEmail);
        const canSwitch = !busy && !isActive && acc.hasCred && acc.id;
        const row = document.createElement('div');
        row.className = 'fs-row';
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', canSwitch ? '0' : '-1');
        row.setAttribute('data-active', String(isActive));
        row.setAttribute('data-disabled', String(!isActive && !acc.hasCred));

        const avatar = document.createElement('div');
        avatar.className = 'fs-avatar';
        avatar.textContent = initialsOf(acc);
        if (isActive) {
          const dot = document.createElement('span');
          dot.className = 'fs-dot';
          avatar.appendChild(dot);
        }

        const info = document.createElement('div');
        info.className = 'fs-info';
        const top = document.createElement('div');
        top.className = 'fs-top';
        const name = document.createElement('span');
        name.className = 'fs-name';
        name.textContent = acc.name || acc.email.split('@')[0];
        top.appendChild(name);
        const tierText = shortPlan(acc.plan);
        if (tierText) {
          const tier = document.createElement('span');
          tier.className = 'fs-tier';
          tier.textContent = tierText;
          top.appendChild(tier);
        }
        const emailEl = document.createElement('div');
        emailEl.className = 'fs-email';
        emailEl.textContent = acc.email;
        info.append(top, emailEl);

        const actions = document.createElement('div');
        actions.className = 'fs-actions';
        if (isActive) {
          const pill = document.createElement('span');
          pill.className = 'fs-active-pill';
          pill.textContent = 'Active';
          actions.appendChild(pill);
        }
        if (acc.id) {
          if (confirmRemoveId === acc.id) {
            const okDel = document.createElement('button');
            okDel.type = 'button';
            okDel.className = 'fs-icon-btn danger';
            okDel.title = 'Confirm remove';
            okDel.appendChild(iconCheck(12));
            okDel.onclick = (e) => {
              e.stopPropagation();
              confirmRemoveId = '';
              void runAction('Removing...', async () => {
                await api.remove({ id: acc.id });
                await refreshState(false);
              });
            };
            const cancelDel = document.createElement('button');
            cancelDel.type = 'button';
            cancelDel.className = 'fs-icon-btn';
            cancelDel.title = 'Cancel';
            cancelDel.appendChild(iconX(12));
            cancelDel.onclick = (e) => {
              e.stopPropagation();
              confirmRemoveId = '';
              render();
            };
            actions.append(okDel, cancelDel);
          } else {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'fs-icon-btn danger';
            delBtn.title = 'Remove account';
            delBtn.setAttribute('aria-label', 'Remove account');
            delBtn.appendChild(iconTrash(13));
            delBtn.onclick = (e) => {
              e.stopPropagation();
              confirmRemoveId = acc.id;
              render();
            };
            actions.appendChild(delBtn);
          }
        }

        if (canSwitch) {
          const doSwitch = () =>
            void runAction(`Switching to ${acc.email}...`, async () => {
              await api.switchTo({ id: acc.id, currentUser });
            });
          row.onclick = doSwitch;
          row.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              doSwitch();
            }
          };
        }

        row.append(avatar, info, actions);
        list.appendChild(row);
      }
    }

    const foot = document.createElement('div');
    foot.className = 'fs-foot';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fs-btn fs-btn-primary';
    addBtn.disabled = busy;
    addBtn.append(iconUserPlus(14), document.createTextNode('Add account'));
    addBtn.onclick = () =>
      void runAction('Opening Google sign-in...', async () => {
        await lsRpc('AuthLogout').catch(() => {});
        await api.addAccount({ currentUser });
      });
    foot.appendChild(addBtn);

    if (currentUser || hasActiveCred) {
      const outBtn = document.createElement('button');
      outBtn.type = 'button';
      outBtn.className = 'fs-btn fs-btn-ghost';
      outBtn.title = 'Sign out';
      outBtn.setAttribute('aria-label', 'Sign out');
      outBtn.disabled = busy;
      outBtn.appendChild(iconLogOut(13));
      outBtn.onclick = () =>
        void runAction('Signing out...', async () => {
          await lsRpc('AuthLogout').catch(() => {});
          await api.signOut({ currentUser });
        });
      foot.appendChild(outBtn);
    }

    const children = [head, list, foot];
    if (busyText || errorText) {
      const status = document.createElement('div');
      status.className = 'fs-status' + (errorText ? ' err' : '');
      status.textContent = errorText || busyText;
      children.push(status);
    }

    panel.replaceChildren(...children);
    positionPanel();
  }

  function mountButton() {
    if (!alive) return;
    const found = findSettingsButton();
    if (!found) return;
    settingsEl = found;

    // Match native sidebar button geometry & typography dynamically
    const scs = getComputedStyle(settingsEl);
    if (!btnHost) {
      btnHost = document.createElement('div');
      btnHost.id = 'agy-fast-switch-btn-host';
      btnHost.style.cssText = 'display:block;width:100%;margin-bottom:2px;';
      btnShadow = btnHost.attachShadow({ mode: 'open' });
      btnShadow.innerHTML = `
        <style>
          :host { all: initial; display: block; width: 100%; }
          *, *::before, *::after { box-sizing: border-box; }
          .fs-nav-btn {
            display: flex;
            align-items: center;
            width: 100%;
            border: 0;
            background: transparent;
            color: var(--fs-muted);
            font-family: var(--fs-font);
            font-size: var(--fs-btn-size, 13px);
            font-weight: var(--fs-btn-weight, 500);
            line-height: 1.3;
            padding: var(--fs-btn-pad, 6px 10px);
            min-height: var(--fs-btn-h, 30px);
            border-radius: var(--fs-btn-rad, 6px);
            gap: 8px;
            cursor: pointer;
            text-align: left;
            transition: background .12s ease, color .12s ease;
            overflow: hidden;
          }
          .fs-nav-btn:hover, .fs-nav-btn[data-open="true"] {
            background: color-mix(in srgb, var(--fs-fg) 8%, transparent);
            color: var(--fs-fg);
          }
          .fs-nav-btn svg { flex-shrink: 0; opacity: 0.9; }
          .fs-nav-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .fs-nav-pill {
            margin-left: auto;
            max-width: 92px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 10.5px;
            color: var(--fs-muted);
            opacity: 0.78;
          }
        </style>
        <button class="fs-nav-btn" type="button" aria-expanded="false">
          <span class="fs-nav-ico"></span>
          <span class="fs-nav-label">Fast switch</span>
          <span class="fs-nav-pill" hidden></span>
        </button>
      `;
      btnShadow.querySelector('.fs-nav-ico').appendChild(iconSwitch(15));
      btnShadow.querySelector('.fs-nav-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanel();
      });
    }

    btnHost.style.setProperty('--fs-btn-size', scs.fontSize || '13px');
    btnHost.style.setProperty('--fs-btn-weight', scs.fontWeight || '500');
    btnHost.style.setProperty('--fs-btn-pad', scs.padding || '6px 10px');
    btnHost.style.setProperty('--fs-btn-h', scs.height && parseFloat(scs.height) >= 24 ? scs.height : '30px');
    btnHost.style.setProperty('--fs-btn-rad', scs.borderRadius || '6px');

    const parent = settingsEl.parentElement;
    if (!parent) return;
    // If Settings sits inside a horizontal flex container, climb one wrapper if that wrapper is a single-child row
    let anchor = settingsEl;
    const pcs = getComputedStyle(parent);
    if (pcs.display.includes('flex') && pcs.flexDirection === 'row' && parent.parentElement) {
      anchor = parent;
    }
    if (btnHost.previousSibling !== anchor && btnHost.nextSibling !== anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(btnHost, anchor);
    }
    applyPaletteVars();
    renderButton();
  }

  function start() {
    ensurePopoverHost();
    mountButton();
    void refreshState(true);
    observer = new MutationObserver(() => {
      if (!mountTimer) {
        mountTimer = setTimeout(() => {
          mountTimer = 0;
          mountButton();
          applyPaletteVars();
        }, 120);
      }
    });
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-aw-theme', 'data-aw-mode'],
    });
    syncTimer = setInterval(() => void refreshState(true), 15000);
    window.addEventListener('resize', () => {
      positionPanel();
      renderButton();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!open) return;
      const path = e.composedPath();
      if (path.includes(host) || path.includes(btnHost)) return;
      togglePanel(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        togglePanel(false);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
// END LOCAL FAST SWITCH
