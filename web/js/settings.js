'use strict';

/*
 * Stránka Nastavení: jazyk (podle zařízení nebo ručně), vzhled, výchozí rank a region,
 * propojení s LoL klientem (overlay, import, zkratky), spouštění s Windows, záloha dat a účet.
 */
const Settings = (() => {
  const ACCENTS = ['blue', 'hextech', 'violet', 'gold', 'rose', 'emerald'];

  const toggle = (key, label, on, hint = '', id = '') => `<label class="switch-row">
      <span class="switch"><input type="checkbox" ${id ? `id="${id}"` : `data-setting="${key}"`} ${on ? 'checked' : ''}><i></i></span>
      <span class="switch-text">${label}${hint ? `<small>${hint}</small>` : ''}</span>
    </label>`;
  const kbd = keys => keys.map(k => `<kbd>${k === 'Ctrl' ? t('kbd.ctrl') : k === 'Shift' ? t('kbd.shift') : k}</kbd>`).join('<span class="plus">+</span>');

  function langCard() {
    const device = I18N.LANGS.find(l => l.code === I18N.detect());
    const opts = [{ code: 'auto', name: t('lang.auto'), sub: device?.name }, ...I18N.LANGS];
    return `<article class="card set-card">
      <h2>${icon('globe')}${t('st.lang')}</h2>
      <div class="lang-list">${opts.map(l => `
        <label class="lang-opt ${I18N.pref === l.code ? 'on' : ''}">
          <input type="radio" name="lang" value="${l.code}" ${I18N.pref === l.code ? 'checked' : ''}>
          <span class="lang-code">${l.code === 'auto' ? icon('monitor', 17) : l.code.toUpperCase()}</span>
          <span class="lang-name"><b>${esc(l.name)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</span>
          <span class="lang-check">${icon('check', 16)}</span>
        </label>`).join('')}
      </div>
      <p class="hint">${t('st.langHint')}</p>
    </article>`;
  }

  function lookCard() {
    return `<article class="card set-card">
      <h2>${icon('palette')}${t('st.look')}</h2>
      <h3>${t('st.accent')}</h3>
      <div class="swatches">${ACCENTS.map(a => `<button type="button" class="swatch sw-${a} ${state.accent === a ? 'on' : ''}" data-accent="${a}">
          <i></i><span>${t('accent.' + a)}</span></button>`).join('')}</div>
      ${toggle('motion', t('st.motion'), state.motion !== false)}
      <h3>${t('st.defaults')}</h3>
      <div class="selects">
        ${selectHtml('rank', API.RANKS.filter(r => r.key !== 'overall'), state.rank, t('f.rank'))}
        ${selectHtml('region', API.REGIONS, state.region, t('f.region'))}
      </div>
      <p class="hint">${t('st.defaultsHint')}</p>
    </article>`;
  }

  function clientCard() {
    const c = Desktop.client;
    const demo = Desktop.demo;
    return `<h2>${icon('gamepad')}${t('st.client')}</h2>
      <p class="status-line ${c.connected ? 'ok' : ''}"><span class="dot"></span>
        ${c.connected ? t('client.onLong', { phase: Desktop.phaseText(c.phase) }) : t('client.offLong')}</p>
      ${toggle('autoOpen', t('st.autoOpen'), state.autoOpen)}
      ${toggle('autoImport', t('st.autoImport'), state.autoImport, t('st.runesNote'))}
      ${toggle('overlay', t('st.overlay'), state.overlay)}
      ${toggle('cardLabels', t('st.cardLabels'), state.cardLabels !== false, t('st.cardLabelsHint'))}
      <h3>${t('st.hotkeys')}</h3>
      <div class="keys">
        <div class="key-row">${kbd(['Ctrl', 'X'])}<span>${t('key.panel')}</span></div>
        <div class="key-row">${kbd(['Ctrl', 'Shift', 'H'])}<span>${t('key.overlay')}</span></div>
        <div class="key-row">${kbd(['Ctrl', 'Shift', 'M'])}<span>${t('key.move')}</span></div>
      </div>
      <p class="hint">${t('st.borderless')}</p>
      <div class="btn-row">
        <button type="button" class="btn small ${demo.overlay ? 'primary' : ''}" id="overlayDemo">${demo.overlay ? t('demo.overlayDone') : t('demo.overlay')}</button>
        <button type="button" class="btn small ${demo.panel ? 'primary' : ''}" id="panelDemo">${demo.panel ? t('demo.panelClose') : t('demo.panel')}</button>
      </div>`;
  }

  function appCard() {
    const s = Desktop.appStatus;
    const b = s?.backup || {};
    const info = b.running ? t('backup.running')
      : b.last ? t('backup.last', { date: fmtDate(b.last), files: t('backup.files', { n: b.files || 0 }), mb: nf1.format((b.bytes || 0) / 1048576) })
        : t('backup.none');
    return `<h2>${icon('monitor')}${t('st.app')}</h2>
      ${toggle('', t('st.autostart'), !!s?.autostart, t('st.autostartHint'), 'autostart')}
      ${updateHtml()}
      <h3>${t('st.backup')}</h3>
      <p class="hint">${t('backup.desc')}</p>
      <div class="backup-row">
        <span class="backup-info ${b.running ? 'running' : ''}">${icon(b.running ? 'refresh' : 'database', 16)}${esc(info)}</span>
        <button type="button" class="btn small" id="backupNow" ${b.running ? 'disabled' : ''}>${t('backup.now')}</button>
      </div>`;
  }

  // Verze a aktualizace: nové verze se stahují samy, nainstalují se po restartu
  const RELEASES = 'https://github.com/NotTerraCZ/NotLoL/releases/latest';

  function updateHtml() {
    const u = Desktop.update;
    if (!u) return '';
    const head = `<h3>${t('st.updates')}</h3>`;
    if (u.state === 'off') {
      const link = `<a href="${RELEASES}" target="_blank" rel="noopener">GitHub</a>`;
      return `${head}<p class="hint">${t('upd.off', { v: esc(u.current || '?'), link })}</p>`;
    }
    const busy = u.state === 'checking' || u.state === 'downloading';
    const info = {
      idle: t('upd.idle'),
      checking: t('upd.checking'),
      downloading: t('upd.downloading', { v: u.version, p: u.progress || 0 }),
      ready: t('upd.ready', { v: u.version }),
      latest: t('upd.latest', { date: fmtDate(u.checkedAt) }),
      error: t('upd.error'),
    }[u.state] || '';
    const ico = busy ? 'refresh' : { ready: 'download', error: 'alert', latest: 'check' }[u.state] || 'info';
    const btn = u.state === 'ready'
      ? `<button type="button" class="btn small primary" id="updateApply">${icon('refresh', 15)}${t('upd.restart')}</button>`
      : `<button type="button" class="btn small" id="updateCheck" ${busy ? 'disabled' : ''}>${t('upd.check')}</button>`;
    return `${head}
      <p class="hint">${t('upd.desc', { v: esc(u.current) })}</p>
      <div class="backup-row">
        <span class="backup-info ${busy ? 'running' : ''} ${u.state === 'error' ? 'err' : ''}">${icon(ico, 16)}${esc(info)}</span>
        ${btn}
      </div>
      ${u.error ? `<p class="hint">${esc(u.error)}</p>` : ''}`;
  }

  function accountCard() {
    return `<h2>${icon('user')}${t('st.account')}</h2>
      ${Players.me ? `${Players.meCardHtml()}
        <div class="btn-row"><button type="button" class="btn small ghost" id="forgetMe">${t('me.forget')}</button></div>`
        : `<p class="muted">${t('me.none')}</p>`}`;
  }

  function render() {
    document.title = `${t('title.settings')} – NotLoL`;
    Players.setNav('settings');
    const desktop = Desktop.active;
    view.innerHTML = `<section class="page settings" id="settingsPage">
      <div class="page-head"><div><h1>${t('st.title')}</h1><p class="sub">${t('st.sub')}</p></div></div>
      <div class="settings-grid">
        ${langCard()}
        ${lookCard()}
        ${desktop ? `<article class="card set-card" id="setClient">${clientCard()}</article>
          <div class="set-stack">
            <article class="card set-card" id="setAccount">${accountCard()}</article>
            <article class="card set-card" id="setApp">${appCard()}</article>
          </div>`
          : `<article class="card set-card"><h2>${icon('gamepad')}${t('st.client')}</h2><p class="muted">${t('st.browserOnly')}</p></article>`}
        <article class="card set-card card-wide about">
          <h2>${icon('info')}${t('st.about')}</h2>
          <p class="muted">${footerText()}</p>
        </article>
      </div>
    </section>`;
    bind($('#settingsPage'));
  }

  // Živé části (stav klienta, záloha, účet) se překreslí bez zbytku stránky
  function refresh() {
    if (!document.getElementById('settingsPage') || !Desktop.active) return;
    $('#setClient').innerHTML = clientCard();
    $('#setApp').innerHTML = appCard();
    $('#setAccount').innerHTML = accountCard();
  }
  window.addEventListener('notlol-status', refresh);
  window.addEventListener('notlol-me', refresh);

  function bind(page) {
    page.addEventListener('change', e => {
      const el = e.target;
      if (el.name === 'lang') {
        // Jiný jazyk = jiná data (jména šampionů, itemů…) – nejjednodušší je načíst appku znovu
        I18N.setPref(el.value);
        location.reload();
      } else if (el.dataset.setting) {
        state[el.dataset.setting] = el.checked;
        savePrefs();
        applyLook();
        Desktop.sendSettings();
      } else if (el.dataset.filter) {
        state[el.dataset.filter] = el.value;
        savePrefs();
      } else if (el.id === 'autostart') {
        Desktop.setAutostart(el.checked);
      }
    });
    page.addEventListener('click', async e => {
      // Jen barevné vzorky – data-accent má i <html> (aktuální barva), takže obecný selektor by chytil každý klik
      const sw = e.target.closest('.swatch[data-accent]');
      if (sw) {
        state.accent = sw.dataset.accent;
        savePrefs();
        applyLook();
        Desktop.sendSettings();
        page.querySelectorAll('[data-accent]').forEach(x => x.classList.toggle('on', x === sw));
        return;
      }
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.id === 'backupNow') Desktop.backupNow();
      else if (btn.id === 'updateCheck') Desktop.checkUpdate();
      else if (btn.id === 'updateApply') {
        btn.disabled = true;
        Desktop.applyUpdate();
      } else if (btn.id === 'overlayDemo' || btn.id === 'panelDemo') {
        btn.disabled = true;
        await (btn.id === 'overlayDemo' ? Desktop.toggleOverlayDemo() : Desktop.togglePanelDemo());
        refresh();
      } else if (btn.id === 'forgetMe') {
        Players.forgetMe();
        toast(t('me.forgotten'));
      }
    });
  }

  return { render };
})();
