'use strict';

/*
 * Napojení na desktopovou aplikaci (WebView2 <-> C#).
 * C# hlídá LoL klient (LCU API) a běžící hru (Live Client Data API) a posílá sem zprávy:
 *   {type:'client', connected, phase}
 *   {type:'me', me}                       – přihlášený účet (jméno, ikona, úroveň, rank)
 *   {type:'champSelect', championId, locked, position, gameMode}
 *   {type:'game', champion, position, gameMode}
 *   {type:'result', id, ok, message}
 *   {type:'appStatus', autostart, backup}
 *   {type:'navigate', hash}               – např. "Nastavení" z ikony v oznamovací oblasti
 * Odsud jdou zpět: ready, settings (overlay, jazyk, texty pro tray a overlay), import a overlayBuild.
 * V obyčejném prohlížeči se nic z toho nezobrazí.
 */
const Desktop = (() => {
  const host = window.chrome?.webview;
  const client = { connected: false, phase: 'None' };
  let appStatus = null;
  const pending = new Map();
  let reqId = 0;
  let lastOpenKey = null;
  let lastImportKey = null;
  let champSelect = null;
  const demo = { overlay: false, panel: false };

  const POST_GAME = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);
  const phaseText = p => (POST_GAME.has(p) ? t('phase.post') : t(`phase.${p}`) === `phase.${p}` ? p : t(`phase.${p}`));
  const LABELS = { runes: () => t('imp.runes'), spells: () => t('imp.spells'), itemset: () => t('imp.itemset') };

  const send = msg => host?.postMessage(msg);
  const changed = () => window.dispatchEvent(new CustomEvent('notlol-status'));
  function request(msg) {
    const id = ++reqId;
    return new Promise(resolve => {
      pending.set(id, resolve);
      send({ ...msg, id });
      setTimeout(() => {
        if (pending.delete(id)) resolve({ ok: false, message: t('client.noReply') });
      }, 15000);
    });
  }

  // ---------- Start ----------

  function init() {
    if (!host) return;
    document.body.classList.add('desktop');
    $('#clientChip').hidden = false;
    host.addEventListener('message', e => onMessage(e.data));
    paintStatus();
    sendSettings();
    send({ type: 'ready' });
  }

  // Nastavení pro desktopovou část: overlay, jazyk a přeložené texty (tray, overlay, hlášky)
  const sendSettings = () => send({
    type: 'settings', overlay: !!state.overlay, cards: state.cardLabels !== false,
    lang: I18N.code, accent: state.accent, native: I18N.native(),
  });

  function paintStatus() {
    const chip = $('#clientChip');
    if (!chip) return;
    chip.classList.toggle('ok', client.connected);
    chip.classList.toggle('busy', client.connected && ['ChampSelect', 'InProgress', 'GameStart'].includes(client.phase));
    $('#clientText').textContent = client.connected ? phaseText(client.phase) : t('client.off');
    chip.title = client.connected ? t('client.onLong', { phase: phaseText(client.phase) }) : t('client.offLong');
    Players.setOnline(client.connected);
    refreshImportBar();
  }

  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'client':
        client.connected = !!m.connected;
        client.phase = m.phase || 'None';
        if (client.phase !== 'ChampSelect') {
          champSelect = null;
          lastOpenKey = null;
          lastImportKey = null;
          document.getElementById('selectHelper')?.remove();
        }
        paintStatus();
        changed();
        break;
      case 'me':
        if (m.me) Players.setMe(m.me);
        break;
      case 'navigate':
        if (typeof m.hash === 'string' && m.hash.startsWith('#/')) location.hash = m.hash;
        break;
      case 'champSelect':
        onChampSelect(m).catch(() => {});
        break;
      case 'game':
        onGame(m).catch(() => send({ type: 'overlayBuild', build: null }));
        break;
      case 'result': {
        const resolve = pending.get(m.id);
        if (resolve) {
          pending.delete(m.id);
          resolve(m);
        }
        break;
      }
      case 'appStatus':
        appStatus = m;
        changed();
        break;
      case 'backup':
        runBackup().catch(() => send({ type: 'backupDone', ok: 0, fail: 1 }));
        break;
    }
  }

  // ---------- Ukázky overlaye a herního panelu (z Nastavení) ----------

  async function toggleOverlayDemo() {
    try {
      if (demo.overlay) {
        send({ type: 'overlayDemo', build: null });
      } else {
        // Build šampiona, na kterého se zrovna díváš (jinak Jinx)
        let data = currentChamp?.build?.matches ? currentChamp : null;
        if (!data) {
          const st = await API.getStatic(state.patch);
          data = await loadChampData(st.champBySlug.get('jinx'), 'adc', filtersFor('ranked_solo_5x5'));
        }
        // Na stránce šampiona v Areně / Mayhemu se v ukázce hledají i karty na obrazovce
        send({ type: 'overlayDemo', build: overlayBuild(data), augScan: await augScanFor(data, null).catch(() => null) });
      }
      demo.overlay = !demo.overlay;
    } catch {
      toast(t('toast.overlayFail'), false);
    }
    changed();
  }

  async function togglePanelDemo() {
    try {
      if (demo.panel) send({ type: 'panelDemo', info: null });
      else send({ type: 'panelDemo', ...(await panelDemoData()) });
      demo.panel = !demo.panel;
    } catch {
      toast(t('toast.panelFail'), false);
    }
    changed();
  }

  // ---------- Hodinová záloha ----------
  // Stáhne všechno důležité znovu – desktopová appka každou odpověď uloží na disk
  // (a ptá se serveru "změnilo se to?", takže nezměněná data se znovu nestahují).
  let backupRunning = false;

  async function runBackup() {
    if (backupRunning) return;
    backupRunning = true;
    let ok = 0;
    let fail = 0;
    const track = async promise => {
      try {
        await promise;
        ok++;
      } catch {
        fail++;
      }
    };
    // Několik souběžných stahování, ať to netrvá věčnost, ale ani nezahltí u.gg
    const pool = async (items, size, fn) => {
      let i = 0;
      await Promise.all(Array.from({ length: size }, async () => {
        while (i < items.length) await track(fn(items[i++]));
      }));
    };

    try {
      API.clearCaches();
      allPatches = await API.getPatches();
      const patch = state.patch || allPatches[0];
      const st = await API.getStatic(patch);
      await track(API.getAugments());

      // Tier listy všech módů (s tvým regionem a rankem) + výchozí Emerald+ svět
      const tierJobs = API.QUEUES.map(q => filtersFor(q.key));
      tierJobs.push({ patch, region: 'world', rank: 'emerald_plus', queue: 'ranked_solo_5x5' });
      await pool(tierJobs, 3, f => loadTierList(f));

      // Buildy, runy a matchupy všech šampionů pro tvůj mód na Summoner's Rift
      // (+ pro ARAM / Mayhem / Arenu, pokud ho máš zrovna nastavený)
      const queues = [queue().noRoles ? 'ranked_solo_5x5' : state.queue];
      if (queue().noRoles) queues.push(queue().mayhem ? 'normal_aram' : state.queue);
      const champs = st.champList;
      for (const qk of queues) {
        await pool(champs, 4, c => withPatchFallback(patch, `ov:${qk}:${c.key}`,
          p => API.getChampionStats({ patch: p, queue: qk, champId: c.key })));
      }
      if (queue().mayhem) {
        await pool(champs, 4, c => withPatchFallback(patch, `aug:${c.key}`, p => API.getMayhemAugments(p, c.key)));
      }
      if (queue().arena) {
        await pool(champs, 4, c => API.getArenaChampion(c.key));
      }
      // Ikony schopností (Data Dragon)
      await pool(champs, 4, c => API.getChampionKit(st, c));
    } finally {
      backupRunning = false;
      send({ type: 'backupDone', ok, fail });
    }
  }

  // ARAM, Mayhem a Arena mají vlastní data; na Summoner's Rift zůstane mód, který má hráč nastavený
  function queueFor(gameMode, queueId) {
    return API.queueForGame(gameMode, queueId)
      || (API.queueByKey(state.queue).noRoles ? 'ranked_solo_5x5' : state.queue);
  }
  function syncQueue(gameMode, queueId) {
    const before = state.queue;
    state.queue = queueFor(gameMode, queueId);
    if (state.queue !== before) savePrefs();
    return state.queue !== before;
  }

  // ---------- Výběr šampiona ----------

  async function onChampSelect(m) {
    champSelect = m;
    refreshImportBar();
    if (!m.championId) return;
    const st = await API.getStatic(state.patch);
    const champ = st.champs.get(m.championId);
    if (!champ) return;
    const queueChanged = syncQueue(m.gameMode, m.queueId);
    renderSelectHelper(m, st).catch(() => {});
    const role = API.roleFromPosition(m.position);

    const openKey = `${m.championId}:${role?.key}:${state.queue}`;
    if (state.autoOpen && openKey !== lastOpenKey) {
      lastOpenKey = openKey;
      const href = champHref(champ, role?.key);
      if (location.hash === href) {
        if (queueChanged) route();
      } else {
        location.hash = href;
      }
    }

    const importKey = `${m.championId}:${role?.key}:${state.queue}`;
    if (state.autoImport && m.locked && importKey !== lastImportKey) {
      lastImportKey = importKey;
      const data = await loadChampData(champ, role?.key);
      await importAll(data);
    }
  }

  // ---------- Pomocník ve výběru šampiona (ARAM, Mayhem, Arena) ----------

  let helperReq = 0;

  async function renderSelectHelper(m, st) {
    const q = API.queueByKey(queueFor(m.gameMode, m.queueId));
    const id = ++helperReq;
    const html = q.arena ? await arenaHelper(m, st) : q.noRoles ? await benchHelper(m, st, q) : '';
    if (id !== helperReq) return;
    let box = document.getElementById('selectHelper');
    if (!html) return box?.remove();
    if (!box) {
      box = document.createElement('div');
      box.id = 'selectHelper';
      box.className = 'select-helper';
      document.querySelector('.topbar').after(box);
    }
    box.innerHTML = html;
  }

  // ARAM / Mayhem: tvůj šampion, lavička a spoluhráči seřazení podle síly
  async function benchHelper(m, st, q) {
    const tl = (await loadTierList(filtersFor(q.key)).catch(() => null))?.data;
    if (tl?.roles) for (const rows of Object.values(tl.roles)) API.scoreRole(rows, MIN_PICK);
    const rowFor = cid => (tl?.rows || tl?.roles?.none || []).find(r => r.champId === cid) || null;
    const entries = [
      { id: m.championId, who: t('sh.you'), kind: 'me' },
      ...(m.bench || []).map(cid => ({ id: cid, who: t('sh.bench'), kind: 'bench' })),
      ...(m.team || []).map(cid => ({ id: cid, who: t('sh.mate'), kind: 'mate' })),
    ].map(e => ({ ...e, champ: st.champs.get(e.id), row: rowFor(e.id) })).filter(e => e.champ);
    if (entries.length < 2) return '';
    const score = e => (e.row ? e.row.z ?? 0 : -99);
    const mine = entries[0];
    const better = e => e !== mine && e.kind === 'bench' && score(e) > score(mine) + 0.05;
    const swap = e => e.kind === 'mate' && score(e) > score(mine) + 0.05;
    entries.sort((a, b) => score(b) - score(a));
    const anyBetter = entries.some(better);
    const wrText = e => (e.row?.wr != null && !q.mayhem ? ' · ' + pct(e.row.wr) : '');
    return `<div class="sh-inner">
      <span class="sh-title">${icon(QUEUE_ICONS[q.key] || 'snow', 16)}${esc(t('sh.title', { mode: q.label }))}</span>
      <div class="sh-list">${entries.map(e => `<a class="sh-champ ${e === mine ? 'me' : ''} ${better(e) ? 'better' : ''} ${swap(e) ? 'swap' : ''}"
          href="${champHref(e.champ)}" title="${esc(e.champ.name)} · ${esc(e.who)}${wrText(e)}">
          <img src="${e.champ.icon}" alt="">${tierBadge(e.row?.tier)}
          <span><b>${esc(e.champ.name)}</b><small>${esc(e.who)}${wrText(e)}</small></span></a>`).join('')}</div>
      <span class="sh-hint">${anyBetter ? t('sh.better') : entries.some(swap) ? t('sh.swap') : t('sh.best')}</span>
    </div>`;
  }

  // Arena: jak ti to jde s parťákem a kdo jsou nejlepší parťáci
  async function arenaHelper(m, st) {
    const me = st.champs.get(m.championId);
    if (!me) return '';
    const a = await API.getArenaChampion(me.key).catch(() => null);
    if (!a) return '';
    const syn = a.synergies.slice();
    API.scorePlacement(syn, 25, 5);
    const partner = (m.team || []).map(cid => st.champs.get(cid)).find(Boolean);
    const together = partner ? syn.find(s => s.champId === partner.key) : null;
    const best = syn.filter(s => s.eligible).sort((x, y) => y.z - x.z).slice(0, 6);
    const placeTxt = p => t('place.short', { p: Arena.place(p) });
    return `<div class="sh-inner">
      <span class="sh-title">${icon('flame', 16)}${esc(t('sh.arena', { champ: me.name }))}</span>
      ${partner ? `<span class="sh-duo">${t('sh.partner', { name: `<b>${esc(partner.name)}</b>` })} ${together
        ? `<b class="${Arena.placeClass(together.avgPlace)}">${placeTxt(together.avgPlace)}</b> · ${t('sh.partnerStat', { wr: pct(together.wr), games: Arena.games(together.matches) })}`
        : t('sh.partnerFew')}</span>` : ''}
      <span class="sh-hint">${t('sh.bestPartners')}</span>
      <div class="sh-list">${best.map(s => {
        const c = champOf(st, s.champId);
        return `<a class="sh-champ" href="${champHref(c)}" title="${esc(c.name)} · ${placeTxt(s.avgPlace)} · ${pct(s.wr)} top 4">
          <img src="${c.icon}" alt=""><span><b>${esc(c.name)}</b><small class="${Arena.placeClass(s.avgPlace)}">${placeTxt(s.avgPlace)}</small></span></a>`;
      }).join('')}</div>
    </div>`;
  }

  // ---------- Hra (overlay) ----------

  async function onGame(m) {
    const st = await API.getStatic(state.patch);
    const champ = st.champBySlug.get(String(m.champion || '').toLowerCase());
    if (!champ) return send({ type: 'overlayBuild', build: null });
    const data = await loadChampData(champ, API.roleFromPosition(m.position)?.key, filtersFor(queueFor(m.gameMode, m.queueId)));
    let ingame = null;
    try { ingame = await ingameInfo(m, data); } catch { /* panel ukáže aspoň živá data */ }
    const augScan = await augScanFor(data, m.locale).catch(() => null);
    send({ type: 'overlayBuild', build: overlayBuild(data), ingame, augScan });
  }

  // ---------- Karty na obrazovce (Arena, ARAM: Mayhem) ----------
  // Desktopová appka čte názvy nabízených karet z obrazovky (OCR) – potřebuje k tomu názvy
  // v jazyce hry (+ anglicky a v jazyce appky) a hodnocení každé karty pro tvého šampiona.

  const VERDICT = { splus: 'aug.v.splus', s: 'aug.v.s', a: 'aug.v.a', b: 'aug.v.b', c: 'aug.v.c', d: 'aug.v.d' };
  const cdLangOf = locale => (!locale ? null : /^en_us$/i.test(locale) ? 'default' : locale.toLowerCase());

  async function augScanFor(data, locale) {
    const groups = data.augments || [];
    if (!(groups.length || data.arena?.prism?.length) || !(data.q.arena || data.q.mayhem)) return null;
    const langs = [...new Set([cdLangOf(locale), I18N.lang.cd, 'default'].filter(Boolean))];
    const maps = await Promise.all(langs.map(l => API.getAugmentNames(l).catch(() => null)));
    const names = new Map();
    for (const m of maps) {
      for (const [id, n] of m || []) {
        if (!names.has(id)) names.set(id, new Set());
        names.get(id).add(n);
      }
    }
    const tierIndex = tier => (tier ? API.TIERS.findIndex(x => x.key === tier.key) : -1);
    const ratings = {};
    for (const g of groups) {
      g.items.forEach((a, i) => {
        if (a.id == null || ratings[a.id]) return;
        const ti = tierIndex(a.tier);
        ratings[a.id] = {
          tier: a.tier?.key || '',
          cls: a.tier?.cls || 'none',
          verdict: t(a.tier ? VERDICT[a.tier.cls] : 'aug.v.none', { champ: data.champ.name }),
          stat: a.stat || '',
          // Pro výběr nejlepší z nabídky: tier, pak pořadí v seznamu
          score: (ti >= 0 ? API.TIERS.length - ti : 0) + (1 - i / Math.max(1, g.items.length)) * 0.9,
        };
      });
    }
    // Arena: prizmatické itemy z kovadliny – top 10 pro šampiona z OP.GG, ostatní „mimo top 10“
    if (data.arena?.prism?.length) {
      const prism = data.arena.prism.slice();
      API.scorePlacement(prism, 30, 1);
      prism.sort((x, y) => y.z - x.z);
      prism.forEach((x, i) => {
        const id = x.ids[0];
        const ti = tierIndex(x.tier);
        ratings[id] = {
          kind: 'item',
          tier: x.tier?.key || '',
          cls: x.tier?.cls || 'none',
          verdict: t(x.tier ? VERDICT[x.tier.cls] : 'aug.v.none', { champ: data.champ.name }),
          stat: t('stat.placeGames', { p: Arena.place(x.avgPlace), games: Arena.games(x.matches) }),
          score: (ti >= 0 ? API.TIERS.length - ti : 0) + (1 - i / prism.length) * 0.9,
        };
      });
      const ddLangs = [...new Set([locale, I18N.lang.dd, 'en_US'].filter(Boolean))];
      const itemMaps = await Promise.all(ddLangs.map(l => API.getItemNames(data.st.itemVersion, l).catch(() => null)));
      for (const m of itemMaps) {
        for (const [id, n] of m || []) {
          const isPrism = id >= 440000 && id < 450000;
          if (!isPrism && !ratings[id]) continue;
          if (!names.has(id)) names.set(id, new Set());
          names.get(id).add(n);
          ratings[id] ??= { kind: 'item', tier: '', cls: 'none', verdict: t('prism.v.none', { champ: data.champ.name }), stat: '', score: 0 };
        }
      }
    }

    // Stejný název mívá víc augmentů (verze pro Arenu a pro Mayhem mají jiné id) –
    // když má hodnocení jen jedna z nich, čtečka dostane jen tu
    const byName = new Map();
    for (const [id, set] of names) {
      for (const n of set) {
        const k = API.normalize(n);
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push({ id, n });
      }
    }
    for (const list of byName.values()) {
      if (list.length < 2 || !list.some(x => ratings[x.id])) continue;
      for (const x of list) if (!ratings[x.id]) names.get(x.id).delete(x.n);
    }
    return {
      names: [...names].filter(([, set]) => set.size).map(([id, set]) => [id, ...set]),
      ratings,
      noData: t('aug.v.none', { champ: data.champ.name }),
    };
  }

  // Data pro herní panel (Ctrl+X): šampioni všech hráčů s tierem/WR a tvůj podrobný build
  async function ingameInfo(m, data) {
    const { st, q, f } = data;
    let tl = null;
    try {
      tl = (await loadTierList(f)).data;
      if (tl.roles) for (const rows of Object.values(tl.roles)) API.scoreRole(rows, MIN_PICK);
    } catch { /* bez tier listu */ }

    const statFor = (champId, role) => {
      if (!tl) return null;
      // Mayhem (jen tier) a Arena z OP.GG (průměrné umístění)
      if (tl.rows) {
        const r = tl.rows.find(x => x.champId === champId);
        return r ? { tier: r.tier?.key || null, cls: r.tier?.cls || 'none', place: r.avgPlace ?? null, wr: q.arena ? r.wr : null } : null;
      }
      let r = (q.noRoles ? tl.roles.none : role ? tl.roles[role.key] : null)?.find(x => x.champId === champId);
      // Bez známé pozice vezmi roli, kde ho hraje nejvíc lidí
      if (!r && !q.noRoles) r = Object.values(tl.roles).flat().filter(x => x.champId === champId).sort((a, b) => b.matches - a.matches)[0];
      return r ? { tier: r.tier?.key || null, cls: r.tier?.cls || 'none', wr: r.wr, games: r.matches } : null;
    };

    const players = {};
    for (const p of m.players || []) {
      const c = st.champBySlug.get(String(p.champion || '').toLowerCase());
      const role = API.roleFromPosition(p.position);
      players[p.riotId] = {
        champ: c ? { name: c.name, icon: c.icon } : { name: p.champion || '?', icon: '' },
        role: role?.label || '',
        stats: c ? statFor(c.key, role) : null,
      };
    }
    // "SummonerFlash" -> ikona (z URL ikony v Data Dragonu)
    const spells = Object.fromEntries([...st.spells.values()].map(s => [s.icon.split('/').pop().replace('.png', ''), s.icon]));

    const b = data.build;
    const item = id => ({ id, name: st.itemName(id) || t('item.unknown', { id }), icon: st.itemIcon(id) });
    const runeOf = id => {
      const r = st.runes.get(id);
      return r ? { name: r.name, icon: r.icon } : null;
    };
    return {
      mode: q.label,
      wrLabel: q.arena ? 'Top 4' : 'WR',
      patch: API.patchLabel(data.tierPatch || data.dataPatch || f.patch),
      me: m.me,
      itemBase: `https://ddragon.leagueoflegends.com/cdn/${st.itemVersion}/img/item/`,
      spells,
      players,
      build: b && b.matches ? {
        ...overlayBuild(data),
        options: b.options.map(list => list.slice().sort((x, y) => y.matches - x.matches).slice(0, 3)
          .map(o => ({ ...item(o.id), wr: o.wins / o.matches, games: o.matches }))),
        runes: q.arena || !b.runes?.perks?.length ? [] : b.runes.perks.slice(0, 6).map(runeOf).filter(Boolean),
        // Celé pořadí karet (záložka „Karty“ v panelu) a prizmatické itemy (Arena)
        cards: (data.augments || []).map(g => ({
          key: g.key, label: g.label,
          items: g.items.map(a => ({ name: a.name, icon: a.icon, tier: a.tier ? { key: a.tier.key, cls: a.tier.cls } : null, stat: a.stat, old: !!a.old })),
        })),
        prismTop: (data.prism || []).map(p => ({ id: p.id, name: p.name, icon: p.icon, avgPlace: p.avgPlace, wr: p.wr, games: p.games })),
      } : null,
      arena: !!q.arena,
      mayhem: !!q.mayhem,
    };
  }

  // Ukázka herního panelu: tvůj šampion + 9 silných šampionů z tier listu, vymyšlené statistiky
  async function panelDemoData() {
    const st = await API.getStatic(state.patch);
    let data = currentChamp?.build?.matches ? currentChamp : null;
    if (!data) data = await loadChampData(st.champBySlug.get('jinx'), 'adc', filtersFor('ranked_solo_5x5'));
    if (data.q.arena) return arenaDemoData(st, data);
    const tl = (await withPatchFallback(state.patch, 'tl:ranked_solo_5x5:world:emerald_plus',
      p => API.getTierList({ patch: p, region: 'world', rank: 'emerald_plus', queue: 'ranked_solo_5x5' }))).data;
    const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
    const picks = [];
    for (const pos of positions) {
      const role = API.roleFromPosition(pos);
      const list = (tl.roles[role.key] || []).filter(r => r.champId !== data.champ.key)
        .sort((a, b) => b.matches - a.matches);
      picks.push({ pos, ids: list.slice(0, 2).map(r => r.champId) });
    }
    const myPos = { top: 'TOP', jungle: 'JUNGLE', mid: 'MIDDLE', adc: 'BOTTOM', supp: 'UTILITY' }[data.role?.key] || 'BOTTOM';
    const tiers = ['GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'EMERALD', 'PLATINUM', 'MASTER', 'EMERALD', 'GOLD', 'DIAMOND'];
    const divs = ['II', 'IV', 'I', 'III'];
    const commonItems = [3006, 3031, 3157, 3071, 3742, 6672, 3020, 3111, 6653, 3068, 2065, 3047, 3153, 4645];
    const you = `${t('demo.you')}#DEMO`;
    const players = [];
    const ranks = {};
    let n = 0;
    for (const team of ['ORDER', 'CHAOS']) {
      for (const { pos, ids } of picks) {
        const mine = team === 'ORDER' && pos === myPos;
        const champ = mine ? data.champ : st.champs.get(ids[team === 'ORDER' ? 0 : 1]);
        if (!champ) continue;
        const riotId = mine ? you : `${t('demo.player', { n: n + 1 })}#DEMO`;
        const k = (n * 7) % 9, d = (n * 5) % 6 + 1, a = (n * 11) % 13;
        players.push({
          riotId, champion: champ.id, team, position: pos, isBot: false, level: 9 + (n % 4),
          kills: k, deaths: d, assists: a, cs: pos === 'UTILITY' ? 20 + n : pos === 'JUNGLE' ? 90 + n * 3 : 120 + n * 6,
          items: mine ? (data.build?.core?.items || []).slice(0, 2).concat([3340]) : [commonItems[n % 14], commonItems[(n + 5) % 14], 3340],
          spells: ['SummonerFlash', pos === 'JUNGLE' ? 'SummonerSmite' : 'SummonerDot'],
          isDead: n === 7, respawn: n === 7 ? 23 : 0,
        });
        ranks[riotId] = { solo: { tier: tiers[n % 10], division: tiers[n % 10] === 'MASTER' ? 'NA' : divs[n % 4], lp: (n * 23) % 100, wins: 40 + n * 7, losses: 38 + n * 6 } };
        n++;
      }
    }
    const me = players.find(p => p.riotId === you);
    const live = {
      champion: data.champ.id, position: myPos, gameMode: 'CLASSIC', gameTime: 912, level: me?.level || 10,
      skills: { Q: 4, W: 2, E: 2, R: 1 }, items: me?.items || [], riotId: you, players,
    };
    const info = await ingameInfo({ me: you, players }, data);
    info.demo = true;
    return { info, live, ranks };
  }

  // Ukázka Areny: 16 hráčů v 8 dvojicích
  async function arenaDemoData(st, data) {
    const tl = (await loadTierList(filtersFor('arena'))).data;
    const rows = (tl.rows || Object.values(tl.roles || {}).flat())
      .filter(r => r.champId !== data.champ.key).sort((a, b) => b.matches - a.matches).slice(0, 15);
    const champs = [data.champ, ...rows.map(r => st.champs.get(r.champId)).filter(Boolean)].slice(0, 16);
    const arenaItems = [223031, 223153, 226672, 223072, 223085, 223036, 226653, 223089, 223157, 223068];
    const tiers = ['GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'SILVER', 'EMERALD', 'MASTER', 'PLATINUM'];
    const you = `${t('demo.you')}#DEMO`;
    const players = [];
    const ranks = {};
    champs.forEach((champ, n) => {
      const mine = n === 0;
      const riotId = mine ? you : `${t('demo.player', { n })}#DEMO`;
      players.push({
        riotId, champion: champ.id, team: 'ORDER', subteam: String(Math.floor(n / 2) + 1), position: '', isBot: false,
        level: 8 + (n % 6), kills: (n * 3) % 7, deaths: (n * 5) % 5, assists: (n * 7) % 9, cs: 0,
        items: mine ? [...(data.build?.core?.items || []).slice(0, 2), ...(data.prism || []).slice(0, 1).map(p => p.id)]
          : [arenaItems[n % 10], arenaItems[(n + 3) % 10]],
        spells: [], isDead: n === 5, respawn: n === 5 ? 8 : 0,
      });
      const tier = tiers[n % 8];
      ranks[riotId] = { solo: { tier, division: ['I', 'II', 'III', 'IV'][n % 4], lp: (n * 17) % 100, wins: 30 + n * 5, losses: 28 + n * 4 } };
    });
    const live = {
      champion: data.champ.id, position: '', gameMode: 'CHERRY', gameTime: 640, level: 9,
      skills: { Q: 3, W: 2, E: 2, R: 1 }, items: players[0].items, riotId: you, players,
    };
    const info = await ingameInfo({ me: you, players }, data);
    info.demo = true;
    return { info, live, ranks };
  }

  // ---------- Hledání hráčů (přes LoL klient) ----------

  async function lookupPlayer(gameName, tagLine) {
    if (!host) return { ok: false, message: t('lookup.desktopOnly') };
    if (!client.connected) return { ok: false, message: t('lookup.needClient') };
    return request({ type: 'lookup', gameName, tagLine });
  }

  function overlayBuild({ st, champ, kit, role, build: b, f, q, augments, prism, dataPatch, tierPatch }) {
    if (!b || !b.matches) return null;
    const item = id => ({ id, name: st.itemName(id) || t('item.unknown', { id }), icon: st.itemIcon(id) });
    const coreIds = new Set(b.core?.items || []);
    const next = [];
    for (const list of b.options) {
      for (const o of list.slice().sort((x, y) => y.matches - x.matches).slice(0, 2)) {
        if (!coreIds.has(o.id) && !next.some(n => n.id === o.id)) next.push(item(o.id));
      }
    }
    const keystone = q.arena ? null : st.runes.get(b.runes?.perks?.[0]);
    // Augmenty: dvě nejlepší (aktuální data) z každé vzácnosti
    const augs = (augments || []).flatMap(g => g.items.filter(a => !a.old).slice(0, 2)
      .map(a => ({ id: 0, name: a.name, icon: a.icon, rarity: g.key })));
    return {
      champion: { name: champ.name, icon: champ.icon },
      subtitle: [role && role.key !== 'none' ? role.label : q.label, t('patch.n', { p: API.patchLabel(tierPatch || dataPatch || f.patch) }),
        q.mayhem ? null : `${pct(b.wins / b.matches)} ${q.arena ? 'top 4' : 'WR'}`].filter(Boolean).join(' · '),
      augments: augs,
      prism: (prism || []).slice(0, 3).map(p => ({ id: p.id, name: p.name, icon: p.icon })),
      skills: {
        order: (b.skills?.order || []).slice(0, 18),
        priority: b.skills?.priority || '',
        icons: Object.fromEntries((kit?.spells || []).map(s => [s.key, s.icon])),
      },
      start: (b.start?.items || []).map(item),
      core: (b.core?.items || []).map(item),
      next: next.slice(0, 6),
      spells: q.arena ? [] : (b.spells?.ids || []).map(id => st.spells.get(id)).filter(Boolean).map(s => ({ name: s.name, icon: s.icon })),
      keystone: keystone ? { name: keystone.name, icon: keystone.icon } : null,
    };
  }

  // ---------- Import do klienta ----------

  function payload(what, { champ, role, build: b, f, arena, prism }) {
    if (what === 'runes') {
      const perks = b.runes?.perks || [];
      const shards = b.shards?.ids || [];
      if (perks.length < 6 || shards.length < 3) return null;
      return {
        page: {
          name: `NotLoL ${champ.name}`.slice(0, 25),
          primaryStyleId: b.runes.primary,
          subStyleId: b.runes.sub,
          selectedPerkIds: [...perks.slice(0, 6), ...shards.slice(0, 3)],
        },
      };
    }
    if (what === 'spells') {
      const ids = b.spells?.ids || [];
      return ids.length === 2 ? { spells: ids } : null;
    }
    if (what === 'itemset') {
      const counted = ids => {
        const m = new Map();
        ids.forEach(id => m.set(id, (m.get(id) || 0) + 1));
        return [...m].map(([id, count]) => ({ id: String(id), count }));
      };
      const q = API.queueByKey(f.queue);
      const wr = o => (o?.matches ? ` (${pct(o.wins / o.matches)} ${q.arena ? 'top 4' : 'WR'})` : '');
      const blocks = [];
      if (arena) {
        // Arena (OP.GG): boty, core, prizmatické itemy a nejčastější itemy
        const ids = list => list.map(id => ({ id: String(id), count: 1 }));
        if (arena.boots[0]) blocks.push({ type: t('iset.boots'), items: ids(arena.boots.slice(0, 2).map(x => x.ids[0])) });
        if (arena.core[0]) blocks.push({ type: `${t('iset.core')}${wr(b.core)}`, items: ids(arena.core[0].ids) });
        if (prism?.length) blocks.push({ type: t('iset.prism'), items: ids(prism.slice(0, 6).map(p => p.id)) });
        const extra = arena.items.map(x => x.ids[0]).filter(id => !arena.core[0]?.ids.includes(id)).slice(0, 8);
        if (extra.length) blocks.push({ type: t('iset.more'), items: ids(extra) });
      } else {
        if (b.start?.items.length) blocks.push({ type: `${t('iset.start')}${wr(b.start)}`, items: counted(b.start.items) });
        if (b.core?.items.length) blocks.push({ type: `${t('iset.core')}${wr(b.core)}`, items: counted(b.core.items) });
        [4, 5, 6].forEach((n, i) => {
          const list = (b.options[i] || []).slice().sort((x, y) => y.matches - x.matches).slice(0, 4);
          if (list.length) blocks.push({ type: t('items.nth', { n }), items: list.map(o => ({ id: String(o.id), count: 1 })) });
        });
      }
      if (!blocks.length) return null;
      return {
        set: {
          title: `NotLoL ${champ.name}${role && role.key !== 'none' ? ' ' + role.label : ''}`,
          championId: champ.key,
          // 11 = Summoner's Rift, 12 = Howling Abyss (ARAM i Mayhem), 30 = Arena
          maps: q.arena ? [30] : q.noRoles ? [12] : [11],
          blocks,
        },
      };
    }
    return null;
  }

  async function importOne(what, data) {
    const p = payload(what, data);
    const label = LABELS[what]();
    if (!p) return { ok: false, message: t('imp.missing', { what: label }) };
    const r = await request({ type: 'import', what, ...p });
    return { ok: !!r.ok, message: r.message || t(r.ok ? 'imp.done' : 'imp.fail', { what: label }) };
  }

  async function importAll(data) {
    // V Areně se runy ani kouzla nevybírají
    const what = data.q.arena ? ['itemset']
      : client.phase === 'ChampSelect' ? ['runes', 'spells', 'itemset'] : ['runes', 'itemset'];
    const results = [];
    for (const w of what) results.push(await importOne(w, data));
    const ok = results.every(r => r.ok);
    toast(results.map(r => r.message).join('\n'), ok);
  }

  function importBarHtml(q) {
    if (!host) return '';
    const buttons = q.arena
      ? `<button class="btn small primary" data-import="itemset">${icon('download', 15)}${t('imp.itemset')}</button>`
      : `<button class="btn small" data-import="runes">${t('imp.runes')}</button>
        <button class="btn small" data-import="spells">${t('imp.spells')}</button>
        <button class="btn small" data-import="itemset">${t('imp.itemset')}</button>
        <button class="btn small primary" data-import="all">${icon('download', 15)}${t('imp.all')}</button>`;
    return `<div class="import-bar" id="importBar">
      <span class="ib-label">${icon('gamepad', 18)}${t('imp.title')}</span>
      <div class="ib-buttons">${buttons}</div>
      <span class="ib-hint" id="importHint"></span>
    </div>`;
  }

  function bindImportBar(root, data) {
    const bar = root.querySelector('#importBar');
    if (!bar) return;
    bar.addEventListener('click', async e => {
      const btn = e.target.closest('[data-import]');
      if (!btn || btn.disabled) return;
      bar.querySelectorAll('button').forEach(b => (b.disabled = true));
      try {
        if (btn.dataset.import === 'all') {
          await importAll(data);
        } else {
          const r = await importOne(btn.dataset.import, data);
          toast(r.message, r.ok);
        }
      } finally {
        refreshImportBar();
      }
    });
    refreshImportBar();
  }

  function refreshImportBar() {
    const bar = document.getElementById('importBar');
    if (!bar) return;
    const inSelect = client.phase === 'ChampSelect';
    bar.querySelectorAll('[data-import]').forEach(b => {
      b.disabled = !client.connected || (b.dataset.import === 'spells' && !inSelect);
    });
    let hint = '';
    if (!client.connected) hint = t('imp.needClient');
    else if (bar.querySelector('[data-import="spells"]') && !inSelect) hint = t('imp.spellsOnlySelect');
    else if (champSelect?.championId && currentChamp && champSelect.championId !== currentChamp.champ.key) hint = t('imp.otherChamp');
    $('#importHint').textContent = hint;
  }

  return {
    init, importBarHtml, bindImportBar, lookupPlayer, sendSettings, phaseText,
    toggleOverlayDemo, togglePanelDemo,
    setAutostart: on => send({ type: 'setAutostart', enabled: !!on }),
    backupNow: () => send({ type: 'backupNow' }),
    active: !!host,
    get client() { return client; },
    get appStatus() { return appStatus; },
    get demo() { return demo; },
  };
})();
