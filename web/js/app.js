'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

// ---------- Stav a preference ----------

const PREFS_KEY = 'notlol.prefs.v1';
const PREF_FIELDS = ['region', 'rank', 'queue', 'role', 'showAll', 'layout', 'sortKey', 'sortDir',
  'autoOpen', 'autoImport', 'overlay', 'cardLabels', 'accent', 'motion', 'hotkeys', 'look'];
const MIN_PICK = 0.005;

const state = Object.assign(
  { patch: null, region: 'world', rank: 'emerald_plus', queue: 'ranked_solo_5x5', role: 'all',
    showAll: false, layout: 'table', sortKey: 'score', sortDir: -1,
    // Desktop: napojení na LoL klient
    autoOpen: true, autoImport: false, overlay: true, cardLabels: true, hotkeys: {},
    // Vzhled (look = verze vzhledu, kvůli jednorázovému přechodu na nový)
    accent: 'red', motion: true, look: 2 },
  loadPrefs(),
);
savePrefs(); // uloží případný přechod na nový vzhled (čte ho i herní panel)
let patches = [];     // patche v nabídce
let allPatches = [];  // všechny patche (pro dohledání starších dat, např. Arena mimo rotaci)
let tierFilter = '';
let tierData = null;
let tierReq = 0;
let champReq = 0;
let currentChamp = null;
let freshPatch = null; // { patch, games } – nejnovější patch, který má zatím málo her

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    // Nový vzhled (1.6): kdo měl původní výchozí modrou, dostane novou výchozí červenou
    if (!p.look) {
      if (p.accent === 'blue') p.accent = 'red';
      p.look = 2;
    }
    return Object.fromEntries(PREF_FIELDS.filter(k => k in p).map(k => [k, p[k]]));
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(PREF_FIELDS.map(k => [k, state[k]]))));
  } catch { /* soukromé okno apod. */ }
}

// Barva zvýraznění a animace (Nastavení → Vzhled)
function applyLook() {
  document.documentElement.dataset.accent = state.accent || 'red';
  document.documentElement.dataset.motion = state.motion === false ? 'off' : 'on';
}
applyLook();

const queue = () => API.queueByKey(state.queue);
function filtersFor(queueKey) {
  const q = API.queueByKey(queueKey);
  return {
    patch: state.patch,
    region: q.worldOnly ? 'world' : state.region,
    rank: q.overallOnly ? 'overall' : state.rank,
    queue: q.key,
  };
}
const filters = () => filtersFor(state.queue);

// Když pro vybraný patch u.gg data nemá (nový patch, Arena mimo rotaci…), vezmi nejbližší starší
const patchMemo = new Map();
const isMissing = err => err instanceof API.HttpError && (err.status === 403 || err.status === 404);
async function withPatchFallback(patch, key, load) {
  const memoKey = `${key}@${patch}`;
  const list = allPatches.length ? allPatches : [patch];
  const from = Math.max(0, list.indexOf(patchMemo.get(memoKey) || patch));
  const [first, ...older] = list.slice(from, from + 16);
  try {
    const data = await load(first);
    patchMemo.set(memoKey, first);
    return { data, patch: first };
  } catch (err) {
    if (!isMissing(err) || !older.length) throw err;
  }
  // Starší patche zkusíme najednou a vezmeme nejnovější, který data má
  const results = await Promise.allSettled(older.map(p => load(p)));
  const i = results.findIndex(r => r.status === 'fulfilled');
  if (i < 0) {
    const hard = results.find(r => !isMissing(r.reason));
    throw hard ? hard.reason : results[0].reason;
  }
  patchMemo.set(memoKey, older[i]);
  return { data: results[i].value, patch: older[i] };
}

// ---------- Formátování ----------

const nf1 = { format: x => I18N.num(x, 1) };
const nf2 = { format: x => I18N.num(x, 2) };
const nfInt = { format: n => I18N.int(n) };
const pct = x => I18N.pct(x);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wrClass = wr => (wr >= 0.53 ? 'wr-great' : wr >= 0.51 ? 'wr-good' : wr >= 0.49 ? 'wr-mid' : wr >= 0.47 ? 'wr-low' : 'wr-bad');
const fmtDate = iso => I18N.date(iso);
const games = n => t('games', { n });
const champHref = (champ, roleKey) => `#/champ/${champ.slug}${roleKey && roleKey !== 'none' ? '/' + roleKey : ''}`;
// V Areně u.gg počítá „výhru“ jako umístění v top 4
const wrLabel = q => (q.arena ? t('col.top4') : t('col.wr'));
let wrShort = 'WR';

function champOf(st, id) {
  return st.champs.get(id) || { key: id, slug: String(id), name: t('champ.unknown', { id: String(id) }), title: '', icon: '', norm: '', alt: '' };
}
const champMatches = (c, needle) => c.norm.includes(needle) || c.alt?.includes(needle);

const footerText = () => t('footer', {
  ugg: '<a href="https://u.gg" target="_blank" rel="noopener">u.gg</a>',
  opgg: '<a href="https://op.gg/lol/modes/arena" target="_blank" rel="noopener">OP.GG</a>',
});

const loadingBlock = (text = t('loading')) => `<div class="state"><div class="spinner"></div><p>${esc(text)}</p></div>`;
function errorBlock(err) {
  let msg = t('err.generic');
  if (err instanceof API.HttpError && (err.status === 403 || err.status === 404)) msg = t('err.missing');
  else if (err instanceof TypeError) msg = t('err.offline');
  else if (err?.message) msg = err.message;
  return `<div class="state error">${icon('alert', 28)}<p>${esc(msg)}</p><button class="btn" data-action="retry">${icon('refresh', 16)}${t('retry')}</button></div>`;
}
view.addEventListener('click', e => {
  if (!e.target.closest('[data-action="retry"]')) return;
  if (state.patch) route();
  else location.reload();
});

function selectHtml(name, options, value, label, disabled = false) {
  return `<label class="select"><span>${esc(label)}</span>
    <select data-filter="${name}" ${disabled ? 'disabled' : ''}>
      ${options.map(o => `<option value="${esc(o.key)}" ${o.key === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select></label>`;
}

function filterSelects(withQueue = true) {
  const q = queue();
  const f = filters();
  return (withQueue ? selectHtml('queue', API.QUEUES, state.queue, t('f.mode')) : '')
    + selectHtml('rank', API.RANKS, f.rank, t('f.rank'), q.overallOnly)
    + selectHtml('region', API.REGIONS, f.region, t('f.region'), q.worldOnly);
}

function bindFilterSelects(root, onChange) {
  root.querySelectorAll('select[data-filter]').forEach(sel => {
    sel.addEventListener('change', () => {
      state[sel.dataset.filter] = sel.value;
      savePrefs();
      onChange();
    });
  });
}

// Přepínač módů nad tier listem
function modeSwitchHtml() {
  return `<div class="mode-switch" role="tablist">${API.QUEUES.map(q => `
    <button type="button" role="tab" class="mode-btn ${state.queue === q.key ? 'on' : ''}" data-queue="${q.key}" aria-selected="${state.queue === q.key}">
      ${icon(QUEUE_ICONS[q.key] || 'tier', 16)}<span>${esc(q.label)}</span></button>`).join('')}
  </div>`;
}

// Upozornění, když data nejsou z vybraného patche
function patchNote(q, requested, used) {
  if (!used || used === requested) return '';
  const text = q.arena
    ? t('note.arenaOff', { p: API.patchLabel(used) })
    : t('note.noPatchData', { req: API.patchLabel(requested), mode: esc(q.label), used: API.patchLabel(used) });
  return `<div class="banner info">${icon('info', 18)}<p>${text}</p></div>`;
}

// ---------- Router ----------

function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  window.scrollTo(0, 0);
  if (parts[0] === 'settings') return Settings.render();
  if (parts[0] === 'players') return Players.renderSearchPage();
  if (parts[0] === 'compare') {
    return Compare.render(parts.slice(1).map(x => {
      try { return decodeURIComponent(x); } catch { return x; } // ručně upravená adresa
    }));
  }
  if (parts[0] === 'player' && parts[1] && parts[2]) {
    return Players.renderProfile(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
  }
  Players.setNav('tier');
  if (parts[0] === 'champ' && parts[1]) renderChampPage(decodeURIComponent(parts[1]), parts[2]);
  else renderTierPage();
}

// ---------- Tier list ----------

const SORTS = {
  score: r => r.z,
  name: r => r.name,
  wr: r => r.wr,
  pick: r => r.pickRate,
  ban: r => r.banRate,
  kda: r => r.kda,
  games: r => r.matches,
};

function renderTierPage() {
  document.title = `${t('tier.title')} – NotLoL`;
  const q = queue();
  const roleBtns = [{ key: 'all', label: t('role.all'), icon: 'fill' }, ...API.ROLES]
    .map(r => `<button class="role-btn ${state.role === r.key ? 'on' : ''}" data-role="${r.key}">
        <img src="${API.roleIcon(r.icon)}" alt="" onerror="this.remove()"><span>${esc(r.label)}</span></button>`)
    .join('');

  view.innerHTML = `
  <section class="page">
    <div class="page-head">
      <div>
        <h1>${t('tier.title')}</h1>
        <p class="sub" id="tierSub">&nbsp;</p>
      </div>
      ${q.mayhem ? '' : `<div class="seg" role="group" aria-label="${esc(t('tier.view'))}">
        <button data-layout="table" class="${state.layout === 'table' ? 'on' : ''}">${icon('table', 15)}${t('tier.table')}</button>
        <button data-layout="grid" class="${state.layout === 'grid' ? 'on' : ''}">${icon('grid', 15)}${t('tier.grid')}</button>
      </div>`}
    </div>
    ${modeSwitchHtml()}
    ${q.noRoles ? '' : freshPatchBanner()}
    <div id="patchNote"></div>
    <div class="filters">
      ${q.noRoles ? '' : `<div class="roles">${roleBtns}</div>`}
      <div class="filter-row">
        <div class="selects">${filterSelects(false)}</div>
        <label class="filter-search">${icon('search', 16)}
          <input id="tierSearch" class="input" type="search" placeholder="${esc(t('tier.filter'))}" value="${esc(tierFilter)}"></label>
        ${q.mayhem ? '' : `<label class="check"><input type="checkbox" id="showAll" ${state.showAll ? 'checked' : ''}>
          ${t('tier.showAll', { pct: pct(MIN_PICK) })}</label>`}
      </div>
    </div>
    <div id="podium"></div>
    <div id="tierBody">${loadingBlock(t('loading.data'))}</div>
  </section>`;

  view.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => {
    if (state.queue === b.dataset.queue) return;
    state.queue = b.dataset.queue;
    savePrefs();
    renderTierPage();
  }));
  view.querySelectorAll('.role-btn').forEach(b => b.addEventListener('click', () => {
    state.role = b.dataset.role;
    savePrefs();
    view.querySelectorAll('.role-btn').forEach(x => x.classList.toggle('on', x === b));
    renderTierBody();
  }));
  view.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    state.layout = b.dataset.layout;
    savePrefs();
    view.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    renderTierBody();
  }));
  bindFilterSelects(view, renderTierPage);
  $('#tierSearch').addEventListener('input', e => {
    tierFilter = e.target.value;
    renderTierBody();
  });
  $('#showAll')?.addEventListener('change', e => {
    state.showAll = e.target.checked;
    savePrefs();
    renderTierBody();
  });

  loadTierData();
}

async function loadTierData() {
  const id = ++tierReq;
  const f = filters();
  const q = API.queueByKey(f.queue);
  try {
    const [st, res] = await Promise.all([API.getStatic(f.patch), loadTierList(f)]);
    if (id !== tierReq) return;
    const tl = res.data;
    if (tl.roles) for (const rows of Object.values(tl.roles)) API.scoreRole(rows, MIN_PICK);
    tierData = { st, tl, f: { ...f, patch: res.patch }, requested: f.patch, q };
    const note = $('#patchNote');
    if (note) note.innerHTML = patchNote(q, f.patch, res.patch);
    renderTierBody();
  } catch (err) {
    if (id !== tierReq) return;
    tierData = null;
    const body = $('#tierBody');
    if (body) body.innerHTML = errorBlock(err);
  }
}

// Tier list pro daný filtr: Mayhem a Arena mají vlastní zdroje, ostatní u.gg
function loadTierList(f) {
  const q = API.queueByKey(f.queue);
  if (q.mayhem) return withPatchFallback(f.patch, 'mayhem', p => API.getMayhemTierList(p));
  const ugg = () => withPatchFallback(f.patch, `tl:${f.queue}:${f.region}:${f.rank}`, p => API.getTierList({ ...f, patch: p }));
  // Arena: aktuální data z OP.GG, když nejdou, poslední data z u.gg
  if (q.arena) return API.getArenaTierList().then(data => ({ data, patch: f.patch })).catch(ugg);
  return ugg();
}

function tierRows() {
  const { st, tl, q } = tierData;
  let rows;
  if (q.mayhem) rows = tl.rows.slice();
  else if (tl.rows) rows = tl.rows.filter(r => (state.showAll ? r.matches > 0 : r.eligible));
  else if (q.noRoles) rows = (tl.roles.none || Object.values(tl.roles)[0] || []).filter(r => (state.showAll ? r.matches > 0 : r.eligible));
  else {
    rows = state.role === 'all' ? Object.values(tl.roles).flat() : tl.roles[state.role] || [];
    rows = rows.filter(r => (state.showAll ? r.matches > 0 : r.eligible));
  }
  rows.sort((a, b) => b.z - a.z);
  rows.forEach((r, i) => {
    r.pos = i + 1;
    r.champ = champOf(st, r.champId);
    r.name = r.champ.name;
  });
  return rows;
}

function renderTierBody() {
  const body = $('#tierBody');
  if (!body || !tierData) return;
  const { tl, f, q } = tierData;
  let rows = tierRows();

  const sub = [q.overallOnly ? null : API.rankByKey(f.rank).label, q.worldOnly ? null : API.regionByKey(f.region).label,
    t('patch.n', { p: API.patchLabel(f.patch) }), tl.totalGames ? games(tl.totalGames) : null,
    tl.updated ? t('updated', { date: fmtDate(tl.updated) }) : null, tl.source ? t('source', { src: tl.source }) : null];
  sub.unshift(q.label);
  $('#tierSub').textContent = sub.filter(Boolean).join(' · ');

  const needle = API.normalize(tierFilter);
  if (needle) rows = rows.filter(r => champMatches(r.champ, needle));

  const podium = $('#podium');
  if (podium) podium.innerHTML = needle || rows.length < 3 ? '' : podiumHtml(rows.slice(0, 3));

  if (!rows.length) {
    body.innerHTML = `<div class="state"><p>${t('tier.empty')} ${needle ? t('tier.emptySearch') : t('tier.emptyAll')}</p></div>`;
    return;
  }
  body.innerHTML = q.mayhem || state.layout === 'grid' ? gridHtml(rows)
    : tl.source === 'OP.GG' ? Arena.tableHtml(rows, tierData.st) : tableHtml(rows);

  body.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.sortDir *= -1;
    else {
      state.sortKey = k;
      state.sortDir = k === 'name' ? 1 : -1;
    }
    savePrefs();
    renderTierBody();
  }));
  body.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  }));
}

// Tři nejsilnější šampioni s obrázkem (splash art) nad tabulkou
function podiumHtml(top) {
  const { q } = tierData;
  const showRole = !q.noRoles && state.role === 'all';
  return `<div class="podium">${top.map((r, i) => {
    const role = API.roleByKey(r.role);
    const stat = r.avgPlace != null
      ? `<b class="${Arena.placeClass(r.avgPlace)}">${t('place.short', { p: Arena.place(r.avgPlace) })}</b><small>${pct(r.wr)} top 4</small>`
      : q.mayhem ? '' : `<b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small>${wrLabel(q)}</small>`;
    return `<a class="podium-card p${i + 1}" href="${champHref(r.champ, r.role)}" style="--splash:url('${r.champ.splash}')">
      <span class="podium-rank">${i + 1}</span>
      <img class="podium-icon" src="${r.champ.icon}" alt="">
      <span class="podium-text">
        <b>${esc(r.name)}</b>
        <span class="podium-meta">${tierBadge(r.tier)}${showRole && role ? `<img src="${API.roleIcon(role.icon)}" alt="" title="${esc(role.label)}" onerror="this.remove()">` : ''}</span>
      </span>
      <span class="podium-stat">${stat}</span>
    </a>`;
  }).join('')}</div>`;
}

function tableHtml(rows) {
  const { st, q } = tierData;
  const showRole = !q.noRoles && state.role === 'all';
  const showBan = !q.aram;
  const get = SORTS[state.sortKey] || SORTS.score;
  const dir = state.sortDir;
  rows = rows.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    return (typeof x === 'string' ? I18N.compare(x, y) : x - y) * dir;
  });

  const th = (key, label, cls = '') => {
    const on = state.sortKey === key;
    return `<th class="${cls} sortable ${on ? 'sorted' : ''}" data-sort="${key}" aria-sort="${on ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">
      ${label}<span class="arrow">${on ? (dir > 0 ? '▲' : '▼') : ''}</span></th>`;
  };

  const body = rows.map(r => {
    const role = API.roleByKey(r.role);
    const href = champHref(r.champ, r.role);
    const vs = r.counters.slice(0, 4).map(v => {
      const c = champOf(st, v.champId);
      return `<a href="${champHref(c, r.role)}" title="${esc(t('tier.counterTip', { name: c.name, wr: pct(v.wr), games: games(v.matches) }))}">
        <img class="mini" src="${c.icon}" alt="${esc(c.name)}" loading="lazy"></a>`;
    }).join('');
    return `<tr data-href="${href}" class="tr-${r.tier?.cls || 'none'}">
      <td class="c-pos">${r.pos}</td>
      ${showRole ? `<td class="c-role"><img src="${API.roleIcon(role?.icon || 'fill')}" alt="${esc(role?.label || '')}" title="${esc(role?.label || '')}" onerror="this.remove()"></td>` : ''}
      <td class="c-champ"><a href="${href}"><img src="${r.champ.icon}" alt="" loading="lazy"><span>${esc(r.name)}</span></a></td>
      <td class="c-tier">${tierBadge(r.tier)}</td>
      <td class="num ${wrClass(r.wr)}"><b>${pct(r.wr)}</b></td>
      <td class="num">${pct(r.pickRate)}</td>
      ${showBan ? `<td class="num c-ban">${pct(r.banRate)}</td>` : ''}
      <td class="num c-kda">${nf2.format(r.kda)}</td>
      <td class="c-vs"><div class="vs">${vs}</div></td>
      <td class="num c-games">${nfInt.format(r.matches)}</td>
    </tr>`;
  }).join('');

  const note = t('tier.note', { basis: t(q.arena ? 'tier.basis.top4' : 'tier.basis.wr'), scope: q.noRoles ? '' : t('tier.scope') })
    + (q.arena ? t('tier.arenaNote') : '');
  return `<div class="table-wrap"><table class="tier-table">
    <thead><tr>
      <th class="c-pos">#</th>
      ${showRole ? `<th class="c-role">${t('col.role')}</th>` : ''}
      ${th('name', t('col.champ'), 'c-champ')}
      ${th('score', t('col.tier'), 'c-tier')}
      ${th('wr', wrLabel(q), 'num')}
      ${th('pick', t('col.pick'), 'num')}
      ${showBan ? th('ban', t('col.ban'), 'num c-ban') : ''}
      ${th('kda', t('col.kda'), 'num c-kda')}
      <th class="c-vs" title="${esc(t('col.countersTip'))}">${t('col.counters')}</th>
      ${th('games', t('col.games'), 'num c-games')}
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  <p class="note">${note}</p>`;
}

function gridHtml(rows) {
  const { q } = tierData;
  const showRole = !q.noRoles && state.role === 'all';
  const groups = API.TIERS.map(tier => ({ label: tier.key, cls: tier.cls, rows: rows.filter(r => r.tier === tier) }));
  const rest = rows.filter(r => !r.tier);
  if (rest.length) groups.push({ label: '–', cls: 'none', rows: rest });

  return `<div class="tier-grid">${groups.map(g => `
    <div class="tier-line tl-${g.cls}">
      <div class="tier-label t-${g.cls}">${g.label}</div>
      <div class="tier-champs">${g.rows.map(r => {
        const role = API.roleByKey(r.role);
        const placed = r.avgPlace != null;
        const stats = q.mayhem ? '' : placed
          ? ' · ' + t('tip.place', { p: Arena.place(r.avgPlace), wr: pct(r.wr) })
          : ' · ' + t('tip.wr', { label: q.arena ? 'Top 4' : 'WR', wr: pct(r.wr), pr: pct(r.pickRate) });
        return `<a class="tile" href="${champHref(r.champ, r.role)}"
            title="${esc(r.name)}${role && showRole ? ' · ' + esc(role.label) : ''}${stats}">
          <img src="${r.champ.icon}" alt="${esc(r.name)}" loading="lazy">
          ${showRole && role ? `<img class="tile-role" src="${API.roleIcon(role.icon)}" alt="" onerror="this.remove()">` : ''}
          ${q.mayhem ? '' : placed
            ? `<span class="tile-wr ${Arena.placeClass(r.avgPlace)}">${t('place.short', { p: Arena.place(r.avgPlace) })}</span>`
            : `<span class="tile-wr ${wrClass(r.wr)}">${nf1.format(r.wr * 100)}</span>`}
        </a>`;
      }).join('') || '<span class="muted">—</span>'}</div>
    </div>`).join('')}</div>
  ${q.mayhem ? `<p class="note">${t('tier.mayhemNote')}</p>` : ''}`;
}

function tierBadge(tier, big = false) {
  if (!tier) return `<span class="tier t-none ${big ? 'big' : ''}">–</span>`;
  return `<span class="tier t-${tier.cls} ${big ? 'big' : ''}">${tier.key}</span>`;
}

// ---------- Detail šampiona ----------

async function renderChampPage(slug, roleKey) {
  const id = ++champReq;
  view.innerHTML = loadingBlock(t('loading.champ'));
  try {
    const st = await API.getStatic(state.patch);
    const champ = st.champBySlug.get(slug);
    if (!champ) {
      view.innerHTML = `<div class="state error"><p>${esc(t('champ.notFound', { slug }))}</p><a class="btn" href="#/">${t('champ.backTier')}</a></div>`;
      return;
    }
    document.title = `${champ.name} – NotLoL`;

    const data = await loadChampData(champ, roleKey);
    if (id !== champReq) return;
    currentChamp = data;
    view.innerHTML = champPageHtml(data);
    bindFilterSelects(view, () => renderChampPage(slug, data.role?.key));
    Desktop.bindImportBar(view, data);
    Cards.bind(view);
  } catch (err) {
    if (id === champReq) view.innerHTML = errorBlock(err);
  }
}

// Všechna data pro stránku šampiona (používá i import do klienta a herní overlay)
async function loadChampData(champ, roleKey, f = filters()) {
  const q = API.queueByKey(f.queue);
  // Arena: aktuální data z OP.GG (když nejdou, spadne to na poslední data z u.gg níž)
  if (q.arena) {
    const arena = await loadArenaChampData(champ, f).catch(() => null);
    if (arena) return arena;
  }
  const st = await API.getStatic(f.patch);
  // Build pro ARAM: Mayhem bere u.gg z běžného ARAMu – děláme to stejně
  const statsQueue = q.mayhem ? 'normal_aram' : f.queue;
  const statsF = { ...f, queue: statsQueue };

  const [statsRes, tlRes, kit, augMeta, mayhemAug] = await Promise.all([
    withPatchFallback(f.patch, `ov:${statsQueue}:${champ.key}`,
      p => API.getChampionStats({ patch: p, queue: statsQueue, champId: champ.key })).catch(err => (q.mayhem ? null : Promise.reject(err))),
    (q.mayhem
      ? withPatchFallback(f.patch, 'mayhem', p => API.getMayhemTierList(p))
      : withPatchFallback(f.patch, `tl:${f.queue}:${f.region}:${f.rank}`, p => API.getTierList({ ...f, patch: p }))
    ).catch(() => null),
    API.getChampionKit(st, champ).catch(() => null),
    q.mayhem || q.arena ? API.getAugments().catch(() => null) : null,
    q.mayhem ? withPatchFallback(f.patch, `aug:${champ.key}`, p => API.getMayhemAugments(p, champ.key)).catch(() => null) : null,
  ]);

  const stats = statsRes?.data || { ov: null, mu: null };
  const regionId = API.regionByKey(statsF.region).id;
  const rankId = API.rankByKey(statsF.rank).id;
  const roles = API.championRoles(stats, regionId, rankId);
  let role = q.noRoles ? API.ARAM_ROLE : API.roleByKey(roleKey);
  if (!q.noRoles && (!role || !roles.some(r => r.role.key === role.key))) role = roles[0]?.role || null;

  let tierRow = null;
  if (tlRes && q.mayhem) {
    const i = tlRes.data.rows.findIndex(r => r.champId === champ.key);
    if (i >= 0) tierRow = { ...tlRes.data.rows[i], roleRank: i + 1, roleTotal: tlRes.data.rows.length };
  } else if (tlRes && role) {
    const list = tlRes.data.roles[role.key] || [];
    API.scoreRole(list, MIN_PICK);
    tierRow = list.find(r => r.champId === champ.key) || null;
  }

  const build = role ? API.championBuild(stats, regionId, rankId, role.id) : null;
  const matchups = role && !q.noRoles ? API.championMatchups(stats, regionId, rankId, role.id) : [];

  // Karty (augmenty) – celé pořadí s tiery, a duo partneři v Areně
  let augments = null;
  let duos = null;
  if (q.arena && role) {
    const arena = API.championArena(stats, regionId, rankId, role.id);
    duos = arena.duos;
    augments = Arena.arenaCardGroups(augMeta, [], arena.augments, API.patchLabel(statsRes?.patch || f.patch));
  } else if (q.mayhem && mayhemAug) {
    augments = Arena.mayhemCardGroups(augMeta, mayhemAug.data);
  }

  return {
    st, champ, kit, roles, role, build, matchups, tierRow, f, q, augments, duos,
    dataPatch: statsRes?.patch || f.patch,
    tierPatch: tlRes?.patch,
    augPatch: mayhemAug?.patch,
  };
}

// Arena z OP.GG: aktuální patch, prizmatické itemy, umístění, karty, parťáci
async function loadArenaChampData(champ, f) {
  const st = await API.getStatic(f.patch);
  const [a, tl, kit, augMeta, ugg] = await Promise.all([
    API.getArenaChampion(champ.key),
    API.getArenaTierList().catch(() => null),
    API.getChampionKit(st, champ).catch(() => null),
    API.getAugments().catch(() => null),
    // Starší, ale velká data z u.gg doplní karty, které OP.GG zatím nemá
    withPatchFallback(f.patch, `ov:arena:${champ.key}`, p => API.getChampionStats({ patch: p, queue: 'arena', champId: champ.key })).catch(() => null),
  ]);
  if (!a.summary?.matches) throw new Error('OP.GG: no data');

  const older = ugg ? API.championArena(ugg.data, 12, 8, 6).augments : [];
  const augments = Arena.arenaCardGroups(augMeta, a.augments, older, ugg ? API.patchLabel(ugg.patch) : '');
  let tierRow = null;
  if (tl) {
    const sorted = tl.rows.filter(r => r.eligible).sort((x, y) => y.z - x.z);
    const i = sorted.findIndex(r => r.champId === champ.key);
    if (i >= 0) tierRow = { ...sorted[i], roleRank: i + 1, roleTotal: sorted.length };
  }
  return {
    st, champ, kit, roles: [], role: API.ARAM_ROLE, build: Arena.toBuild(a), matchups: [], tierRow, f,
    q: API.queueByKey('arena'), augments, duos: null, arena: a, prism: Arena.bestPrism(a, st),
    dataPatch: f.patch, tierPatch: f.patch,
  };
}

function heroHtml(champ, extra, stats, tierRow) {
  return `<header class="hero ${tierRow?.tier ? 'hero-' + tierRow.tier.cls : ''}" style="--splash:url('${champ.splash}')">
      <img class="portrait" src="${champ.icon}" alt="">
      <div class="hero-main">
        <h1>${esc(champ.name)}</h1>
        <p class="hero-title">${esc(champ.title)}</p>
        ${extra}
      </div>
      <div class="hero-stats">${stats}</div>
    </header>`;
}

function arenaPageHtml(data) {
  const { champ, build, f, q, arena } = data;
  const few = arena.summary.matches < 1000;
  const patch = arena.version ? API.patchLabel(arena.version.replace('.', '_')) : API.patchLabel(f.patch);
  return `
  <section class="page champ-page">
    <a class="back" href="#/">${icon('back', 16)}${t('tier.title')}</a>
    ${heroHtml(champ, `<span class="mode-tag">${icon('flame', 14)}Arena</span>`, Arena.heroStats(data), data.tierRow)}
    ${few ? `<div class="banner info">${icon('info', 18)}<p>${t('champ.arenaFew', { champ: esc(champ.name), games: games(arena.summary.matches) })}</p></div>` : ''}
    <div class="filters compact">
      <div class="selects">${filterSelects()}</div>
      <p class="sub">${t('arena.sub', { p: esc(patch) })}</p>
    </div>
    ${build?.matches ? Desktop.importBarHtml(q) : ''}
    <div class="champ-grid">${Arena.pageCards(data)}</div>
  </section>`;
}

function champPageHtml(data) {
  if (data.arena) return arenaPageHtml(data);
  const { st, champ, kit, roles, role, build, matchups, tierRow, f, q, augments, duos } = data;
  wrShort = q.arena ? 'Top 4' : 'WR';
  const hasBuild = !!(build && build.matches);

  const totalRoleGames = roles.reduce((s, r) => s + r.matches, 0);
  const roleTabs = q.noRoles ? '' : roles
    .filter(r => r.matches / totalRoleGames >= 0.02 || r.role.key === role?.key)
    .map(r => `<a class="role-tab ${r.role.key === role?.key ? 'on' : ''}" href="${champHref(champ, r.role.key)}">
        <img src="${API.roleIcon(r.role.icon)}" alt="" onerror="this.remove()">
        <span>${esc(r.role.label)}</span><small>${pct(r.matches / totalRoleGames)}</small></a>`)
    .join('');

  const stat = (value, label, cls = '') => `<div class="stat"><b class="${cls}">${value}</b><span>${label}</span></div>`;
  const tierStat = `<div class="stat stat-tier">${tierBadge(tierRow?.tier, true)}<span>${t('stat.tier')}</span></div>`;
  const rankStat = tierRow?.roleRank ? stat(`${tierRow.roleRank}.<small> / ${tierRow.roleTotal}</small>`, q.noRoles ? t('stat.rank') : t('stat.rankRole')) : '';
  let stats = '';
  if (q.mayhem) {
    stats = tierStat + rankStat;
  } else if (hasBuild) {
    const wr = build.wins / build.matches;
    stats = [
      tierStat,
      stat(pct(wr), wrLabel(q), wrClass(wr)),
      tierRow ? stat(pct(tierRow.pickRate), t('stat.pick')) : '',
      tierRow && !q.aram ? stat(pct(tierRow.banRate), t('stat.ban')) : '',
      rankStat,
      stat(nfInt.format(build.matches), t('stat.games')),
    ].join('');
  }

  const ctx = [q.label, q.overallOnly ? null : API.rankByKey(f.rank).label, q.worldOnly ? null : API.regionByKey(f.region).label,
    t('patch.n', { p: API.patchLabel(data.tierPatch || data.dataPatch) })].filter(Boolean).join(' · ');

  const runesCard = `<article class="card card-runes"><h2>${t('card.runes')}</h2>${runesHtml(build, st)}</article>`;
  const skillsCard = `<article class="card">${q.arena ? '' : `<h2>${t('card.spells')}</h2>${spellsHtml(build, st)}<h2 class="mt">${t('card.skills')}</h2>`}
    ${q.arena ? `<h2>${t('card.skills')}</h2>` : ''}${skillsHtml(build, kit)}</article>`;
  const itemsCard = `<article class="card card-items"><h2>${t('card.items')}</h2>${itemsHtml(build, st)}</article>`;
  const augCard = augments ? `<article class="card card-wide"><h2>${t('card.cards')}</h2>${Cards.html(augments, {
    hint: q.mayhem ? t('cards.hintMayhem') : t('cards.hintTop4'),
  })}</article>` : '';

  let cards;
  if (q.arena) {
    cards = hasBuild ? augCard + skillsCard + itemsCard + `<article class="card">${duosHtml(duos || [], build.matches, st)}</article>` : '';
  } else if (q.mayhem) {
    const buildNote = hasBuild
      ? `<p class="section-note card-wide">${icon('info', 15)}${t('champ.mayhemBuild', { p: API.patchLabel(data.dataPatch) })}</p>`
      : '';
    cards = augCard + buildNote + (hasBuild ? runesCard + skillsCard + itemsCard : '');
  } else {
    cards = hasBuild ? runesCard + skillsCard + itemsCard
      + `<article class="card card-mu">${matchupsHtml(matchups, build.matches, st, role)}</article>` : '';
  }
  const content = cards
    ? `<div class="champ-grid">${cards}</div>`
    : `<div class="state"><p>${esc(t('champ.noData', { champ: champ.name }))}</p></div>`;

  const extra = roleTabs ? `<nav class="role-tabs">${roleTabs}</nav>`
    : `<span class="mode-tag">${icon(QUEUE_ICONS[q.key] || 'tier', 14)}${esc(q.label)}</span>`;
  return `
  <section class="page champ-page">
    <a class="back" href="#/">${icon('back', 16)}${t('tier.title')}</a>
    ${heroHtml(champ, extra, stats, tierRow)}
    ${q.noRoles ? '' : freshPatchBanner()}
    ${patchNote(q, f.patch, q.mayhem ? data.augPatch || data.tierPatch : data.dataPatch)}
    <div class="filters compact">
      <div class="selects">${filterSelects()}</div>
      <p class="sub">${esc(ctx)}${build?.updated ? ' · ' + esc(t('updated', { date: fmtDate(build.updated) })) : ''}</p>
    </div>
    ${hasBuild ? Desktop.importBarHtml(q) : ''}
    ${content}
  </section>`;
}

function wrLine(o) {
  if (!o || !o.matches) return '';
  const wr = o.wins / o.matches;
  return `<p class="wr-line"><span class="${wrClass(wr)}">${pct(wr)} ${wrShort}</span> · ${games(o.matches)}</p>`;
}

function runesHtml(b, st) {
  const r = b?.runes;
  if (!r || !r.matches || !r.primary) return `<p class="muted">${t('noData')}</p>`;
  const sel = new Set(r.perks);
  const runeImg = id => {
    const x = st.runes.get(id);
    if (!x) return '';
    return `<img class="rune ${sel.has(id) ? 'on' : ''}" src="${x.icon}" alt="${esc(x.name)}" title="${esc(x.name)} – ${esc(x.desc)}">`;
  };
  const tree = (styleId, primary) => {
    const s = st.styles.get(styleId);
    if (!s) return '';
    const slots = primary ? s.slots : s.slots.slice(1);
    return `<div class="rune-tree ${primary ? 'primary' : 'secondary'}">
      <div class="rune-style"><img src="${s.icon}" alt=""><span>${esc(s.name)}</span></div>
      ${slots.map((ids, i) => `<div class="rune-row ${primary && i === 0 ? 'keystones' : ''}">${ids.map(runeImg).join('')}</div>`).join('')}
    </div>`;
  };
  const shardIds = b.shards?.ids || [];
  const shards = API.SHARD_ROWS.map((row, i) => `<div class="rune-row shards">${row.map(id => {
    const x = st.shards.get(id);
    return x ? `<img class="shard ${shardIds[i] === id ? 'on' : ''}" src="${x.icon}" alt="${esc(x.name)}" title="${esc(x.name)}">` : '';
  }).join('')}</div>`).join('');

  const keystone = st.runes.get(r.perks[0]);
  return `${keystone ? `<p class="keystone-name"><img src="${keystone.icon}" alt="">${esc(keystone.name)}</p>` : ''}
    <div class="runes">
      ${tree(r.primary, true)}
      <div class="rune-col">${tree(r.sub, false)}<div class="rune-tree shards-tree">${shards}</div></div>
    </div>
    ${wrLine(r)}`;
}

function spellsHtml(b, st) {
  const s = b?.spells;
  if (!s || !s.matches) return `<p class="muted">${t('noData')}</p>`;
  return `<div class="icon-row">${s.ids.map(id => {
    const x = st.spells.get(id);
    return x ? `<img class="spell" src="${x.icon}" alt="${esc(x.name)}" title="${esc(x.name)}">` : '';
  }).join('')}</div>${wrLine(s)}`;
}

function skillsHtml(b, kit) {
  const s = b?.skills;
  if (!s || !s.order.length) return `<p class="muted">${t('noData')}</p>`;
  const spell = k => kit?.spells.find(x => x.key === k);
  const keyIcon = k => {
    const sp = spell(k);
    return `<span class="skill-key">${sp ? `<img src="${sp.icon}" alt="" title="${esc(sp.name)}">` : ''}<b>${k}</b></span>`;
  };
  const priority = s.priority ? `<div class="skill-priority">${s.priority.split('').map(keyIcon).join('<span class="chev">›</span>')}</div>` : '';
  const levels = s.order.slice(0, 18);
  const grid = ['Q', 'W', 'E', 'R'].map(k => `<div class="sg-row">
      <div class="sg-label">${spell(k) ? `<img src="${spell(k).icon}" alt="" title="${esc(spell(k).name)}">` : ''}<b>${k}</b></div>
      ${levels.map((l, i) => `<span class="sg-cell ${l === k ? 'on k-' + k : ''}">${l === k ? i + 1 : ''}</span>`).join('')}
    </div>`).join('');
  return `${priority}<div class="skill-grid-wrap"><div class="skill-grid">${grid}</div></div>${wrLine(s)}`;
}

function itemsHtml(b, st) {
  if (!b) return `<p class="muted">${t('noData')}</p>`;
  const item = id => {
    const x = st.items.get(id);
    const name = st.itemName(id) || t('item.unknown', { id: String(id) });
    return `<img class="item" src="${st.itemIcon(id)}" alt="${esc(name)}" title="${esc(name + (x?.gold ? ` (${x.gold} g)` : ''))}">`;
  };
  const start = b.start?.matches ? `<div class="item-block"><h3>${t('items.start')}</h3>
      <div class="icon-row">${b.start.items.map(item).join('')}</div>${wrLine(b.start)}</div>` : '';
  const core = b.core?.matches ? `<div class="item-block"><h3>${t('items.core')}</h3>
      <div class="icon-row core">${b.core.items.map(item).join('<span class="chev">›</span>')}</div>${wrLine(b.core)}</div>` : '';
  const opts = b.options.some(o => o.length) ? `<div class="item-block"><h3>${t('items.more')}</h3><div class="opts">${b.options.map((list, i) => `
      <div class="opt-col"><h4>${t('items.nth', { n: i + 4 })}</h4>${list.slice().sort((x, y) => y.matches - x.matches).slice(0, 4).map(o => `
        <div class="opt">${item(o.id)}<div><b class="${wrClass(o.wins / o.matches)}">${pct(o.wins / o.matches)}</b>
          <small>${games(o.matches)}</small></div></div>`).join('') || '<p class="muted">—</p>'}
      </div>`).join('')}</div></div>` : '';
  return start + core + opts || `<p class="muted">${t('noData')}</p>`;
}

function duosHtml(duos, total, st) {
  const min = Math.max(20, Math.round(total * 0.002));
  const best = duos.filter(d => d.matches >= min).sort((a, b) => b.wr - a.wr).slice(0, 8);
  if (!best.length) return `<h2>${t('duo.title')}</h2><p class="muted">${t('fewData')}</p>`;
  return `<h2>${t('duo.title')}</h2><p class="hint">${t('duo.hint')}</p>${best.map(d => {
    const c = champOf(st, d.id);
    return `<a class="mu" href="${champHref(c)}">
      <img src="${c.icon}" alt="" loading="lazy"><span class="mu-name">${esc(c.name)}</span>
      <span class="mu-wr ${wrClass(d.wr)}">${pct(d.wr)}</span><span class="mu-games">${games(d.matches)}</span></a>`;
  }).join('')}`;
}

function matchupsHtml(list, champMatchCount, st, role) {
  const min = Math.max(20, Math.round(champMatchCount * 0.004));
  const valid = list.filter(m => m.matches >= min);
  if (!valid.length) return `<h2>${t('mu.title')}</h2><p class="muted">${t('mu.few')}</p>`;
  const worst = valid.slice().sort((a, b) => a.wr - b.wr).slice(0, 6);
  const best = valid.slice().sort((a, b) => b.wr - a.wr).slice(0, 6);
  const li = m => {
    const c = champOf(st, m.champId);
    return `<a class="mu" href="${champHref(c, role?.key)}">
      <img src="${c.icon}" alt="" loading="lazy"><span class="mu-name">${esc(c.name)}</span>
      <span class="mu-wr ${wrClass(m.wr)}">${pct(m.wr)}</span><span class="mu-games">${games(m.matches)}</span></a>`;
  };
  return `<div class="mu-cols">
    <div><h2>${t('mu.hard')}</h2><p class="hint">${t('mu.hardHint')}</p>${worst.map(li).join('')}</div>
    <div><h2>${t('mu.easy')}</h2><p class="hint">${t('mu.easyHint')}</p>${best.map(li).join('')}</div>
  </div>`;
}

// ---------- Hledání v hlavičce ----------

function initSearch() {
  const input = $('#globalSearch');
  const box = $('#searchResults');
  let results = [];
  let active = 0;

  const close = () => { box.hidden = true; };
  const go = c => {
    if (!c) return;
    input.value = '';
    close();
    location.hash = c.player ? Players.playerHref(c.gameName, c.tagLine) : champHref(c);
  };
  const paint = () => {
    box.innerHTML = results.map((c, i) => c.player
      ? `<button class="sr ${i === active ? 'on' : ''}" data-i="${i}">
          <span class="sr-player">${icon('user', 16)}</span><span>${esc(c.gameName)}<small class="tag">#${esc(c.tagLine)}</small></span><small>${t('search.player')}</small></button>`
      : `<button class="sr ${i === active ? 'on' : ''}" data-i="${i}">
          <img src="${c.icon}" alt=""><span>${esc(c.name)}</span><small>${esc(c.title)}</small></button>`).join('')
      || `<p class="sr-empty">${t('search.none')}</p>`;
    box.hidden = false;
  };

  input.addEventListener('input', async () => {
    const raw = input.value;
    const q = API.normalize(raw);
    if (!q) return close();
    // Riot ID (Jméno#TAG) = hledání hráče
    const riotId = Players.parseRiotId(raw);
    const st = await API.getStatic(state.patch).catch(() => null);
    if (input.value !== raw) return;
    results = riotId ? [{ player: true, ...riotId }] : [];
    if (st && !riotId) {
      results = st.champList.filter(c => champMatches(c, q))
        .sort((a, b) => b.norm.startsWith(q) - a.norm.startsWith(q))
        .slice(0, 8);
    }
    active = 0;
    paint();
  });
  input.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { go(results[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  box.addEventListener('mousedown', e => {
    const b = e.target.closest('.sr');
    if (b) { e.preventDefault(); go(results[+b.dataset.i]); }
  });
  input.addEventListener('blur', close);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// ---------- Start ----------

// Nový patch má první dny málo her – ukážeme upozornění s možností přepnout na předchozí
const FRESH_PATCH_GAMES = 300000;

async function pickDefaultPatch() {
  for (const p of patches.slice(0, 3)) {
    try {
      const tl = await API.getTierList({ patch: p, region: 'world', rank: 'emerald_plus', queue: 'ranked_solo_5x5' });
      if (p === patches[0] && tl.totalGames < FRESH_PATCH_GAMES && patches[1]) freshPatch = { patch: p, games: tl.totalGames };
      return p;
    } catch { /* u.gg ještě nemá data – zkus starší patch */ }
  }
  return patches[0];
}

function freshPatchBanner() {
  if (!freshPatch || state.patch !== freshPatch.patch) return '';
  const prev = patches[patches.indexOf(freshPatch.patch) + 1];
  return `<div class="banner">${icon('alert', 18)}
    <p>${t('fresh.text', { p: API.patchLabel(freshPatch.patch), games: games(freshPatch.games) })}</p>
    ${prev ? `<button class="btn ghost small" data-action="prev-patch" data-patch="${prev}">${t('fresh.show', { p: API.patchLabel(prev) })}</button>` : ''}
  </div>`;
}

// u.gg (nebo internet) nejde a desktop appka poslala zálohu – ukaž odkud data jsou
let offlineSince = null;
window.addEventListener('notlol-offline', e => {
  const time = new Date(e.detail);
  if (isNaN(time) || (offlineSince && time >= offlineSince)) return;
  offlineSince = time;
  let bar = document.getElementById('offlineBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offlineBar';
    bar.className = 'offline-bar';
    bar.setAttribute('role', 'status');
    document.querySelector('.topbar').after(bar);
    bar.addEventListener('click', ev => {
      if (ev.target.closest('button')) bar.remove();
    });
  }
  bar.innerHTML = `${icon('database', 17)}<span>${t('offline.text', { date: esc(fmtDate(offlineSince.toISOString())) })}</span>
    <button title="${esc(t('hide'))}">${icon('x', 16)}</button>`;
});

function setPatch(p) {
  state.patch = p;
  $('#patchSelect').value = p;
  route();
}
view.addEventListener('click', e => {
  const b = e.target.closest('[data-action="prev-patch"]');
  if (b) setPatch(b.dataset.patch);
});

// Statické texty a ikony v hlavičce a patičce
function initChrome() {
  I18N.apply(document);
  document.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, 17)));
  $('#footerText').innerHTML = footerText();
  Players.renderMeChip();
}

async function init() {
  initChrome();
  view.innerHTML = loadingBlock(t('loading.patch'));
  try {
    allPatches = await API.getPatches();
    patches = allPatches.slice(0, 8);
    if (!patches.length) throw new Error(t('err.noPatches'));
  } catch (err) {
    view.innerHTML = errorBlock(err);
    Desktop.init();
    return;
  }
  state.patch = await pickDefaultPatch();

  const sel = $('#patchSelect');
  sel.innerHTML = patches.map(p => `<option value="${p}" ${p === state.patch ? 'selected' : ''}>${API.patchLabel(p)}</option>`).join('');
  sel.addEventListener('change', () => setPatch(sel.value));

  initSearch();
  Desktop.init();
  // Boční tlačítka myši = zpět / vpřed
  window.addEventListener('mouseup', e => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) history.back();
    else history.forward();
  });
  window.addEventListener('hashchange', route);
  route();
}

init();
