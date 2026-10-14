'use strict';

/*
 * Herní panel (Ctrl+X). Jen vykresluje data, která posílá desktopová appka:
 *   {type:'info', info}   – šampioni s tierem/WR, ikony run a kouzel, tvůj build, karty a prizmatické itemy
 *   {type:'live', live}   – živá data ze hry (hráči, KDA, CS, itemy, runy, úroveň) – chodí každou sekundu
 *   {type:'ranks', ranks} – hráči z LoL klienta { "Jméno#TAG": {ranked, solo, flex, level, privacy, history} | null };
 *                           history (posledních 20 zápasů) přichází až po rankách
 *   {type:'prefs', lang, accent, panelKey} – jazyk, barva a zkratka panelu z nastavení hlavního okna
 * Každá část se překresluje zvlášť a jen když se změní, takže scrollování neskáče nahoru.
 */
const host = window.chrome?.webview;
const S = { info: null, live: null, ranks: {}, tab: 'match' };
const app = document.getElementById('app');

const CREST = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/';
const TIER_NAMES = {
  IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum', EMERALD: 'Emerald',
  DIAMOND: 'Diamond', MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
};
const TIER_SHORT = { IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P', EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };
const DIV_NUM = { I: 1, II: 2, III: 3, IV: 4 };
const SKILL_KEYS = ['Q', 'W', 'E', 'R'];

const nf1 = x => I18N.num(x, 1);
const nf2 = x => I18N.num(x, 2);
const pct = x => I18N.pct(x);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wrClass = wr => (wr >= 0.53 ? 'wr-great' : wr >= 0.51 ? 'wr-good' : wr >= 0.49 ? 'wr-mid' : wr >= 0.47 ? 'wr-low' : 'wr-bad');
const placeClass = p => (p <= 3.6 ? 'wr-great' : p <= 4.1 ? 'wr-good' : p <= 4.6 ? 'wr-mid' : p <= 5 ? 'wr-low' : 'wr-bad');
const clock = secs => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
// Zkratka panelu z nastavení (popisek už v jazyce appky, např. "Strg+X")
const keysHtml = label => label.split('+').map(k => `<kbd>${esc(k)}</kbd>`).join('+');

// Barva zvýraznění (stejné úložiště jako hlavní okno)
function setAccent(accent) {
  document.documentElement.dataset.accent = accent || 'red';
}
try { setAccent(JSON.parse(localStorage.getItem('notlol.prefs.v1'))?.accent); } catch { setAccent('red'); }

host?.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'info') S.info = m.info;
  else if (m.type === 'live') S.live = m.live;
  else if (m.type === 'ranks') S.ranks = m.ranks || {};
  else if (m.type === 'prefs') {
    if (m.lang) I18N.set(m.lang);
    if (m.panelKey) S.panelKey = m.panelKey;
    setAccent(m.accent);
    for (const k in last) delete last[k]; // jiný jazyk = překreslit vše
  }
  render();
});
host?.postMessage({ type: 'ready' });

document.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) host?.postMessage({ type: 'close' });
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    S.tab = tab.dataset.tab;
    render();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') host?.postMessage({ type: 'close' });
});

// ---------- Kostra: hlavička + jednotlivé části (překreslují se zvlášť) ----------

app.innerHTML = `<header id="head"></header><main id="main">
    <div class="pane match-pane" id="paneMatch"><div class="teams" id="teams"></div><aside class="build" id="build"></aside></div>
    <div class="pane" id="paneCards" hidden></div>
    <div class="pane" id="panePrism" hidden></div>
  </main>
  <div class="wait" id="waitMsg">${t('ig.waitData')}</div>`;

const last = {};
// Nastaví HTML jen když se změnilo a zachová posun (scroll) kontejneru
function patch(id, html) {
  if (last[id] === html) return false;
  last[id] = html;
  const el = document.getElementById(id);
  const top = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = top;
  return true;
}

function render() {
  if (!S.live && !S.info) return;
  document.getElementById('waitMsg')?.remove();
  const b = S.info?.build;
  const tabs = [['match', t('ig.match')]];
  if (b?.cards?.length) tabs.push(['cards', t('ig.cards')]);
  if (b?.prismTop?.length) tabs.push(['prism', t('ig.prism')]);
  if (!tabs.some(x => x[0] === S.tab)) S.tab = 'match';

  patch('head', `
    <span class="brand"><img src="img/logo.png" alt="">Not<span>LoL</span></span>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <span class="mode">${esc(S.info?.mode || '')}${S.info?.patch ? ` · ${esc(t('patch.n', { p: S.info.patch }))}` : ''}${S.info?.demo ? ` · <b class="demo">${t('ig.demo')}</b>` : ''}</span>
    <span class="time">${S.live ? clock(S.live.gameTime || 0) : ''}</span>
    <span class="hint">${keysHtml(S.panelKey || `${t('kbd.ctrl')}+X`)} ${t('ig.close')}</span>
    <button class="close" data-close title="${esc(t('close'))}">×</button>`);

  document.getElementById('paneMatch').hidden = S.tab !== 'match';
  document.getElementById('paneCards').hidden = S.tab !== 'cards';
  document.getElementById('panePrism').hidden = S.tab !== 'prism';

  if (S.tab === 'match') {
    patch('teams', teamsHtml());
    patch('build', buildHtml());
  } else if (S.tab === 'cards') {
    // Karty se překreslí jen při nových datech (jinak by se smazalo hledání)
    if (patch('paneCards', `<h2>${esc(t('ig.cardsTitle', { champ: b.champion.name }))}</h2>
        ${Cards.html(b.cards, { hint: S.info.arena ? t('ig.cardsHintArena') : t('ig.cardsHintMayhem') })}`)) {
      Cards.bind(document.getElementById('paneCards'), { onFocus: () => host?.postMessage({ type: 'focus' }) });
    }
  } else if (S.tab === 'prism') {
    patch('panePrism', prismHtml());
  }
}

// ---------- Hráči ----------

// Arena itemy mají ID 220000+; když ikona chybí, zkus běžný item
function itemImg(id, cls = 'it') {
  const base = S.info?.itemBase || 'https://ddragon.leagueoflegends.com/cdn/latest/img/item/';
  const fallback = id > 220000 ? `this.onerror=null;this.src='${base}${id - 220000}.png'` : "this.style.visibility='hidden'";
  return `<img class="${cls}" src="${base}${id}.png" alt="" onerror="${fallback}">`;
}

// Údaje o hráčích z LoL klienta (MainForm.FetchRanksAsync): ranky, úroveň účtu a posledních 20 zápasů.
// Klíč chybí = ještě se načítá, null = nepodařilo se
const seasonText = q => (q?.prevTier && TIER_NAMES[q.prevTier]
  ? t('pl.lastSeason', { rank: TIER_NAMES[q.prevTier] + (q.prevDivision && q.prevDivision !== 'NA' ? ' ' + q.prevDivision : '') }) : '');

function rankOf(riotId) {
  if (!(riotId in S.ranks)) return { loading: true };
  const r = S.ranks[riotId];
  if (r?.ranked === false) return {}; // ranky nepřišly (zbytek se ukáže)
  const q = r?.solo?.tier ? { ...r.solo, flex: false } : r?.flex?.tier ? { ...r.flex, flex: true } : null;
  return q ? { q } : { none: !!r, prev: seasonText(r?.solo) || seasonText(r?.flex) };
}

function rankHtml(riotId, isBot, compact) {
  if (isBot) return `<span class="rank muted">${t('bot')}</span>`;
  const { loading, q, none, prev } = rankOf(riotId);
  if (loading) return '<span class="rank muted"><span class="dots">…</span></span>';
  // Bez ranku v téhle sezóně: aspoň rank z minulé
  if (!q) {
    return `<span class="rank muted" title="${esc(prev || '')}"><span>${none ? t('unranked') : '—'}${prev && !compact ? `<br><small>${esc(prev)}</small>` : ''}</span></span>`;
  }
  // Výhry a prohry ostatních hráčů Riot neposílá (null) – win rate z rankedu jde jen u vlastního účtu,
  // u ostatních je forma z posledních zápasů ve vedlejším sloupci
  const games = q.losses != null ? q.wins + q.losses : 0;
  const wr = games ? `<small class="${wrClass(q.wins / games)}">${pct(q.wins / games)}</small>` : '';
  const div = q.division && q.division !== 'NA' ? q.division : '';
  const crest = `<img class="crest" src="${CREST}${q.tier.toLowerCase()}.svg" alt="" onerror="this.remove()">`;
  const tip = [seasonText(q), q.losses == null ? t('ig.lossesHidden') : ''].filter(Boolean).join('\n');
  if (compact) {
    return `<span class="rank" title="${esc(tip)}">${crest}<b>${TIER_SHORT[q.tier] || q.tier}${DIV_NUM[div] || ''}</b>${wr}</span>`;
  }
  return `<span class="rank" title="${esc(tip)}">${crest}
    <span><b>${q.flex ? 'Flex · ' : ''}${TIER_NAMES[q.tier] || q.tier}${div ? ' ' + div : ''}</b> <small>${q.lp} LP</small>${games
      ? `<br>${wr} <small class="muted">${t('games', { n: games })}</small>` : ''}</span>
  </span>`;
}

// ---------- Forma z posledních zápasů ----------

const CUSTOM_QUEUES = new Set([0, 3100]);
// Celá procenta – u 20 zápasů jsou desetiny zbytečné (formát podle jazyka, ten se může změnit)
const pct0Fmt = {};
const pct0 = x => (pct0Fmt[I18N.intl] ??= new Intl.NumberFormat(I18N.intl, { style: 'percent', maximumFractionDigits: 0 })).format(x);

// Poslední zápasy (bez remaků, vlastních her a tréninku), nejnovější první
function formOf(riotId, champId) {
  const games = (S.ranks[riotId]?.history || [])
    .filter(g => g.dur >= 300 && !CUSTOM_QUEUES.has(g.queue) && g.mode !== 'PRACTICETOOL')
    .sort((a, b) => b.time - a.time);
  if (!games.length) return null;
  const wins = games.filter(g => g.win).length;
  let streak = 1;
  while (streak < games.length && games[streak].win === games[0].win) streak++;
  return {
    games, wins, losses: games.length - wins, wr: wins / games.length,
    streak: games[0].win ? streak : -streak,
    onChamp: champId ? games.filter(g => g.champ === champId) : null,
  };
}

// Tooltip s podrobnostmi (normálně u sloupce s formou, v Areně u jména)
function formTip(f, champ) {
  const tips = [t('ig.formTip', { games: t('games', { n: f.games.length }), wl: t('pl.wl', { w: f.wins, l: f.losses }), wr: pct(f.wr) })];
  if (Math.abs(f.streak) >= 3) tips.push(t(f.streak > 0 ? 'ig.streakTipW' : 'ig.streakTipL', { n: Math.abs(f.streak) }));
  if (f.onChamp) {
    const cg = f.onChamp.length;
    tips.push(cg
      ? t('ig.champTip', { champ: champ.name, games: t('games', { n: cg }), n: f.games.length, wr: pct(f.onChamp.filter(g => g.win).length / cg) })
      : t('ig.champTipNone', { champ: champ.name, n: f.games.length }));
  }
  return tips.join('\n');
}

function formHtml(p, champ) {
  if (p.isBot) return '';
  const r = S.ranks[p.riotId];
  // Historie chodí až po rankách (r.history chybí = ještě se načítá)
  if (!(p.riotId in S.ranks) || (r && r.history === undefined)) return '<span class="muted"><span class="dots">…</span></span>';
  const f = formOf(p.riotId, champ.id);
  if (!f) return `<small class="muted">${!r ? '—' : r.privacy === 'PRIVATE' ? t('ig.historyHidden') : t('ig.noHistory')}</small>`;
  // Proužek posledních 10 zápasů: nejstarší vlevo, nejnovější vpravo
  const strip = f.games.slice(0, 10).reverse().map(g => `<i class="${g.win ? 'w' : 'l'}"></i>`).join('');
  const n = Math.abs(f.streak);
  const streak = n >= 3 ? `<span class="streak ${f.streak > 0 ? 'w' : 'l'}">${t(f.streak > 0 ? 'ig.streakW' : 'ig.streakL', { n })}</span>` : '';
  const cg = f.onChamp?.length;
  return `<div class="form" title="${esc(formTip(f, champ))}">
    <span class="form-top"><span class="fstrip">${strip}</span>${f.games.length >= 5
      ? `<b class="${wrClass(f.wr)}">${pct0(f.wr)}</b>` : `<small>${t('pl.wl', { w: f.wins, l: f.losses })}</small>`}${streak}</span>
    ${f.onChamp ? `<small class="${cg ? '' : 'new'}">${esc(champ.name)}: ${t('games', { n: cg })}</small>` : ''}
  </div>`;
}

function champStat(st) {
  if (!st) return '';
  return `${st.tier ? `<span class="tier t-${st.cls}">${esc(st.tier)}</span>` : ''}
    ${st.place != null ? `<small class="${placeClass(st.place)}">${t('place.short', { p: nf2(st.place) })}</small>`
      : st.wr != null ? `<small class="${wrClass(st.wr)}">${pct(st.wr)}</small>` : ''}`;
}

function playerRow(p, isMe, compact) {
  const pi = S.info?.players?.[playerKey(p)];
  const champ = pi?.champ || { name: p.champion, icon: '' };
  const name = p.riotId.split('#')[0] || champ.name;
  const items = (p.items || []).slice(0, 7).map(id => itemImg(id)).join('');
  const spells = compact ? '' : (p.spells || []).map(s => S.info?.spells?.[s] ? `<img class="sp" src="${S.info.spells[s]}" alt="">` : '').join('');
  // Keystone a vedlejší strom run (hra je posílá u všech hráčů, v Areně ne)
  const runes = compact ? '' : [[p.keystone, 'ks'], [p.subStyle, 'sub']]
    .map(([id, cls]) => S.info?.runes?.[id] ? `<img class="${cls}" src="${S.info.runes[id].icon}" alt="" title="${esc(S.info.runes[id].name)}">` : '').join('');
  const minutes = (S.live?.gameTime || 0) / 60;
  const kda = p.deaths ? (p.kills + p.assists) / p.deaths : p.kills + p.assists;
  // Úroveň účtu (z LoL klienta) – u ikony šampiona je úroveň ve hře
  const level = S.ranks[p.riotId]?.level;
  // Pod 30 nejde hrát ranked – nový (nebo nový druhý) účet
  const lvl = level ? `<span class="acc-lvl ${level < 30 ? 'low' : ''}" title="${esc(t('ig.lvlTip', { n: level }))}">${t('ig.lvl', { n: level })}</span>` : '';
  const f = compact ? formOf(p.riotId, champ.id) : null;
  return `<div class="row ${compact ? 'compact' : ''} ${isMe ? 'me' : ''} ${p.isDead ? 'dead' : ''}">
    <div class="champ">
      ${champ.icon ? `<img src="${champ.icon}" alt="">` : '<span class="ph"></span>'}
      <span class="lvl" title="${esc(t('ig.champLvlTip'))}">${p.level}</span>
      ${p.isDead ? `<span class="respawn">${Math.ceil(p.respawn)}</span>` : ''}
    </div>
    ${compact ? '' : `<div class="spells">${spells}</div><div class="prunes">${runes}</div>`}
    <div class="who"${f ? ` title="${esc(formTip(f, champ))}"` : ''}><span class="nm"><b>${esc(name)}</b>${compact ? '' : lvl}</span>
      <small>${esc(champ.name)}${pi?.role && !compact ? ' · ' + esc(pi.role) : ''}${compact && level ? ' · ' + t('ig.lvl', { n: level }) : ''}</small></div>
    <div class="rank-cell">${rankHtml(p.riotId, p.isBot, compact)}</div>
    ${compact ? '' : `<div class="form-cell">${formHtml(p, champ)}</div>`}
    <div class="cstat">${champStat(pi?.stats)}</div>
    <div class="kda"><b>${p.kills}/${p.deaths}/${p.assists}</b>${compact ? '' : `<small>${nf1(kda)} KDA</small>`}</div>
    ${compact ? '' : `<div class="cs" title="CS"><b>${p.cs}</b><small>${minutes >= 2 ? t('pl.perMin', { n: nf1(p.cs / minutes) }) : 'CS'}</small></div>`}
    <div class="items">${items}</div>
  </div>`;
}

function teamsHtml() {
  const live = S.live;
  if (!live?.players?.length) return `<div class="wait">${t('ig.waitPlayers')}</div>`;
  const me = live.players.find(p => p.riotId === live.riotId);
  // Arena: seskupit podle dvojic (pokud je hra posílá), jinak podle týmu
  const useSub = live.players.some(p => p.subteam);
  const keyOf = p => (useSub ? p.subteam : p.team);
  const myKey = me ? keyOf(me) : null;
  const teams = new Map();
  for (const p of live.players) {
    if (!teams.has(keyOf(p))) teams.set(keyOf(p), []);
    teams.get(keyOf(p)).push(p);
  }
  const ordered = [...teams.entries()].sort(([a], [b]) => (a === myKey ? -1 : b === myKey ? 1 : 0));
  const many = live.players.length > 10;
  const compact = many;
  const two = ordered.length === 2;
  return `<div class="${many ? 'team-grid' : 'team-stack'}">${ordered.map(([key, players], i) => {
    const kills = players.reduce((s, p) => s + p.kills, 0);
    const label = key === myKey ? (useSub ? t('ig.myDuo') : t('ig.myTeam')) : two ? t('ig.enemies') : t(useSub ? 'ig.duoN' : 'ig.teamN', { n: i + 1 });
    return `<section class="team ${key === myKey ? 'mine' : 'enemy'}">
      <h2>${label} <small>${t('ig.kills', { n: kills })}</small></h2>
      ${players.map(p => playerRow(p, p.riotId === live.riotId, compact)).join('')}
    </section>`;
  }).join('')}</div>`;
}

// ---------- Tvůj build ----------

function buildHtml() {
  const b = S.info?.build;
  if (!b) return `<div class="wait small">${t('ig.buildLoading')}</div>`;
  const live = S.live;
  const owned = new Set(live?.items || []);
  const level = live?.level || 1;
  const spent = live?.skills ? SKILL_KEYS.reduce((s, k) => s + (live.skills[k] || 0), 0) : 0;
  const pending = live && spent < level;
  const idx = live ? (pending ? spent : level) : 0;
  const next = b.skills.order[idx];
  const iconOf = k => b.skills.icons?.[k];

  const skill = next ? `<div class="next-skill ${pending ? 'go' : ''}">
      ${iconOf(next) ? `<img src="${iconOf(next)}" alt="">` : ''}<span class="key k-${next}">${next}</span>
      <div><b>${pending ? t('ig.levelUp', { k: next }) : t('ig.atLevel', { lvl: Math.min(level + 1, 18), k: next })}</b>
      <small>${esc(t('ig.priority', { p: b.skills.priority.split('').join(' › ') }))}</small></div>
    </div>` : '';
  const strip = `<div class="strip">${b.skills.order.slice(0, 18).map((k, i) =>
    `<span class="c k-${k} ${live && i < spent ? 'done' : ''} ${live && i === idx ? 'cur' : ''}">${k}</span>`).join('')}</div>`;

  const itemBox = (it, extra = '') => `<div class="ib ${owned.has(it.id) ? 'own' : ''}" title="${esc(it.name)}">
      <img src="${it.icon}" alt="">${owned.has(it.id) ? '<span class="tick">✓</span>' : ''}${extra}</div>`;
  const core = b.core.map(it => itemBox(it)).join('<span class="chev">›</span>');
  const opts = S.info.arena ? '' : (b.options || []).map((list, i) => list.length ? `<div class="opt-col"><small>${t('items.nth', { n: i + 4 })}</small>
      ${list.map(it => `<div class="opt">${itemBox(it)}<span class="${wrClass(it.wr)}">${pct(it.wr)}</span></div>`).join('')}</div>` : '').join('');

  // Nejlepší karty z každé vzácnosti (celé pořadí je v záložce Karty)
  const topCards = (b.cards || []).map(g => `<div class="aug-group r-${g.key}"><small>${esc(g.label)}</small>
      ${g.items.filter(a => !a.old).slice(0, 3).map(a => `<div class="aug"><span class="tier t-${a.tier?.cls || 'none'}">${a.tier?.key || '–'}</span>
        ${a.icon ? `<img src="${a.icon}" alt="">` : ''}<span class="an">${esc(a.name)}</span></div>`).join('')}</div>`).join('');
  const prism = (b.prismTop || []).slice(0, 3).map(p => `<div class="aug prism ${owned.has(p.id) ? 'own' : ''}">
      <img src="${p.icon}" alt=""><span class="an">${owned.has(p.id) ? '✓ ' : ''}${esc(p.name)}</span><em class="${placeClass(p.avgPlace)}">${t('place.short', { p: nf2(p.avgPlace) })}</em></div>`).join('');

  const runes = (b.runes || []).map((r, i) => `<img class="${i === 0 ? 'ks' : ''}" src="${r.icon}" alt="" title="${esc(r.name)}">`).join('');
  const spells = (b.spells || []).map(s => `<img src="${s.icon}" alt="" title="${esc(s.name)}">`).join('');

  return `<div class="me-head">
      <img src="${b.champion.icon}" alt="">
      <div><b>${esc(b.champion.name)}</b><small>${esc(b.subtitle)}</small></div>
    </div>
    ${skill}${strip}
    ${topCards ? `<h3>${t('ig.bestCards')} <button class="link" data-tab="cards">${t('ig.allCards')}</button></h3><div class="augs">${topCards}</div>` : ''}
    ${prism ? `<h3>${t('ig.prism')} <button class="link" data-tab="prism">${t('ig.top10')}</button></h3><div class="augs">${prism}</div>` : ''}
    <h3>${t('items.core')}</h3><div class="core">${core}</div>
    ${opts ? `<h3>${t('items.more')}</h3><div class="opts">${opts}</div>` : ''}
    ${runes || spells ? `<h3>${t('ig.runesSpells')}</h3><div class="runes">${runes}<span class="gap"></span>${spells}</div>` : ''}`;
}

// ---------- Prizmatické itemy (Arena) ----------

function prismHtml() {
  const b = S.info?.build;
  const owned = new Set(S.live?.items || []);
  return `<h2>${esc(t('ig.prismTitle', { champ: b.champion.name }))}</h2>
    <p class="hint">${t('ig.prismHint')}</p>
    <div class="prism-list">${b.prismTop.map((p, i) => `<div class="prism-item ${owned.has(p.id) ? 'own' : ''}">
      <span class="pr-rank">${i + 1}.</span><img src="${p.icon}" alt="">
      <span class="pr-name">${owned.has(p.id) ? '✓ ' : ''}${esc(p.name)}</span>
      <span class="pr-place ${placeClass(p.avgPlace)}">${t('place.short', { p: nf2(p.avgPlace) })}</span>
      <span class="pr-sub">${t('stat.top4Games', { wr: pct(p.wr), games: t('games', { n: p.games }) })}</span>
    </div>`).join('')}</div>`;
}
