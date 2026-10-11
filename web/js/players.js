'use strict';

/*
 * Hledání hráčů: rank, win rate, posledních 20 zápasů a nejhranější šampioni.
 * Data jdou přes LoL klient (desktopová appka), takže funguje jen pro server, na kterém je klient přihlášený.
 * Tvůj účet (první přihlášení v LoL klientovi s běžící appkou) si NotLoL zapamatuje a ukáže vpravo nahoře.
 */
const Players = (() => {
  const RECENT_KEY = 'notlol.players.recent';
  const ME_KEY = 'notlol.me';
  const ME_PROFILE_KEY = 'notlol.me.profile';
  const CREST = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/';
  const EMBLEM = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/';
  const PROFILE_ICON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/';
  const TIER_NAMES = {
    IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum', EMERALD: 'Emerald',
    DIAMOND: 'Diamond', MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
  };
  const QUEUE_NAMES = {
    420: 'Ranked Solo/Duo', 440: 'Ranked Flex', 400: 'Normal Draft', 430: 'Normal Blind', 480: 'Swiftplay', 490: 'Quickplay',
    450: 'ARAM', 2400: 'ARAM: Mayhem', 1700: 'Arena', 1710: 'Arena', 1740: 'Arena', 1750: 'Arena', 1900: 'URF', 900: 'ARURF', 1020: 'One for All',
  };
  // Když fronta není v seznamu (Riot je občas mění), pozná se mód podle gameMode
  const MODE_NAMES = { CHERRY: 'Arena', KIWI: 'ARAM: Mayhem', ARAM: 'ARAM', URF: 'URF', ONEFORALL: 'One for All', NEXUSBLITZ: 'Nexus Blitz' };
  const COOP_QUEUES = new Set([830, 840, 850, 870, 880, 890]);
  const ARENA_QUEUES = new Set([1700, 1710, 1740, 1750]);
  const isArena = g => ARENA_QUEUES.has(g.queueId) || g.gameMode === 'CHERRY';

  const playerHref = (gameName, tagLine) => `#/player/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  // Porovnání hráčů: Riot ID v adrese ("#/compare/Jméno%23TAG/…")
  const compareHref = list => `#/compare/${list.map(p => encodeURIComponent(`${p.gameName}#${p.tagLine}`)).join('/')}`;
  const iconUrl = id => `${PROFILE_ICON}${id || 29}.jpg`;
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

  function parseRiotId(text) {
    const s = String(text || '').trim();
    const i = s.lastIndexOf('#');
    if (i <= 0 || i === s.length - 1) return null;
    return { gameName: s.slice(0, i).trim(), tagLine: s.slice(i + 1).trim() };
  }

  const load = key => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  };
  const save = (key, value) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* soukromé okno */ }
  };

  function recent() {
    return load(RECENT_KEY) || [];
  }
  function remember(gameName, tagLine) {
    const list = recent().filter(r => !(same(r.gameName, gameName) && same(r.tagLine, tagLine)));
    list.unshift({ gameName, tagLine });
    save(RECENT_KEY, list.slice(0, 8));
  }

  function setNav(key) {
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === key));
    document.getElementById('meChip')?.classList.toggle('on', key === 'me');
  }

  // ---------- Můj účet (vpravo nahoře) ----------

  let me = load(ME_KEY);
  const isMe = (gameName, tagLine) => !!me && same(me.gameName, gameName) && same(me.tagLine, tagLine);
  const meHref = () => (me ? playerHref(me.gameName, me.tagLine) : '#/players');

  function rankLine(q) {
    if (!q?.tier) return t('unranked');
    const div = q.division && q.division !== 'NA' ? ' ' + q.division : '';
    return `${TIER_NAMES[q.tier] || q.tier}${div} · ${q.lp} LP`;
  }

  // Nová data o účtu z LoL klienta; první přihlášení = uvítání a profil vpravo nahoře
  function setMe(m) {
    if (!m?.gameName || !m?.tagLine) return;
    const first = !me || me.puuid !== m.puuid;
    me = { ...m, savedAt: new Date().toISOString() };
    save(ME_KEY, me);
    if (first) save(ME_PROFILE_KEY, null);
    renderMeChip(first);
    if (first) toast(t('me.welcome', { name: m.gameName }), true, 7000);
    window.dispatchEvent(new CustomEvent('notlol-me'));
  }

  function forgetMe() {
    me = null;
    save(ME_KEY, null);
    save(ME_PROFILE_KEY, null);
    renderMeChip();
    window.dispatchEvent(new CustomEvent('notlol-me'));
  }

  function renderMeChip(highlight = false) {
    const chip = document.getElementById('meChip');
    if (!chip) return;
    if (!me) {
      chip.hidden = true;
      return;
    }
    const q = me.solo?.tier ? me.solo : me.flex?.tier ? me.flex : null;
    chip.hidden = false;
    chip.href = meHref();
    chip.title = t('me.tip', { name: `${me.gameName}#${me.tagLine}` });
    chip.style.setProperty('--tc', q ? RANK_COLORS[q.tier] || 'var(--accent)' : 'var(--accent)');
    chip.innerHTML = `<span class="me-avatar"><img src="${iconUrl(me.profileIconId)}" alt="">
        <span class="me-lvl">${me.level || ''}</span><span class="me-dot"></span></span>
      <span class="me-text"><b>${esc(me.gameName)}</b>
        <small>${q ? `<img src="${CREST}${q.tier.toLowerCase()}.svg" alt="" onerror="this.remove()">` : ''}${esc(rankLine(q))}</small></span>`;
    if (highlight) {
      chip.classList.remove('pulse');
      void chip.offsetWidth;
      chip.classList.add('pulse');
    }
  }

  // Zelená tečka u avataru = LoL klient je připojený
  function setOnline(online) {
    document.getElementById('meChip')?.classList.toggle('online', !!online);
  }

  // ---------- Hledání ----------

  const formHtml = (value = '') => `<form class="player-search" id="playerForm">
      <label class="ps-input">${icon('search', 17)}
        <input class="input" id="playerInput" placeholder="${esc(t('pl.placeholder'))}" value="${esc(value)}" autocomplete="off" spellcheck="false"></label>
      <button class="btn" type="submit">${t('pl.search')}</button>
      <span class="ps-error" id="playerError"></span>
    </form>`;

  function bindForm() {
    $('#playerForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const id = parseRiotId($('#playerInput').value);
      if (!id) {
        $('#playerError').textContent = t('pl.needTag');
        return;
      }
      location.hash = playerHref(id.gameName, id.tagLine);
    });
  }

  function meCardHtml() {
    if (!me) return '';
    const q = me.solo?.tier ? me.solo : me.flex?.tier ? me.flex : null;
    return `<a class="me-card" href="${meHref()}" style="--tc:${q ? RANK_COLORS[q.tier] : 'var(--accent)'}">
      <span class="me-avatar big"><img src="${iconUrl(me.profileIconId)}" alt=""><span class="me-lvl">${me.level || ''}</span></span>
      <span class="me-card-text"><small>${t('me.title')}</small><b>${esc(me.gameName)} <span class="tag">#${esc(me.tagLine)}</span></b>
        <span class="muted">${esc(rankLine(q))}</span></span>
      <span class="btn ghost">${t('me.open')} ${icon('chevron', 16)}</span>
    </a>`;
  }

  function renderSearchPage() {
    document.title = `${t('title.players')} – NotLoL`;
    setNav('players');
    const list = recent();
    view.innerHTML = `<section class="page">
      <div class="page-head"><div>
        <h1>${t('pl.title')}</h1>
        <p class="sub">${t('pl.sub')}</p>
      </div></div>
      ${meCardHtml()}
      <div class="filters">${formHtml()}
        ${Desktop.active ? `<a class="btn ghost small" href="#/compare">${icon('users', 15)}${t('cmp.open')}</a>` : ''}
        ${Desktop.active ? '' : `<p class="muted">${t('pl.desktopOnly')}</p>`}
      </div>
      ${list.length ? `<h2 class="section-title">${t('pl.recent')}</h2><div class="recent">${list.map(r =>
        `<a class="chip" href="${playerHref(r.gameName, r.tagLine)}">${icon('user', 14)}${esc(r.gameName)}<small>#${esc(r.tagLine)}</small></a>`).join('')}</div>` : ''}
    </section>`;
    bindForm();
    $('#playerInput')?.focus();
  }

  // Profil z LoL klienta (profil i porovnání). Vlastní profil se uloží a bez klienta se ukáže uložený.
  async function fetchProfile(gameName, tagLine) {
    const mine = isMe(gameName, tagLine);
    const r = await Desktop.lookupPlayer(gameName, tagLine);
    let data = r.ok ? r.data : null;
    let cachedAt = null;
    if (data && mine) {
      const games = (data.games || []).map(parseGame).filter(Boolean);
      save(ME_PROFILE_KEY, { ...data, games: undefined, parsedGames: games, savedAt: new Date().toISOString() });
    } else if (!data && mine) {
      const cached = load(ME_PROFILE_KEY);
      if (cached) {
        data = cached;
        cachedAt = cached.savedAt;
      }
    }
    return { data, cachedAt, message: r.message, mine };
  }

  // Zápasy profilu (z klienta nebo z uloženého vlastního profilu), nejnovější první
  const gamesOf = d => (d.parsedGames || (d.games || []).map(parseGame).filter(Boolean)).sort((a, b) => b.created - a.created);

  let req = 0;
  async function renderProfile(gameName, tagLine) {
    const id = ++req;
    const mine = isMe(gameName, tagLine);
    document.title = `${gameName}#${tagLine} – NotLoL`;
    setNav(mine ? 'me' : 'players');
    view.innerHTML = `<section class="page">
      <a class="back" href="#/players">${icon('back', 16)}${t('pl.back')}</a>
      ${mine ? '' : `<div class="filters">${formHtml(`${gameName}#${tagLine}`)}</div>`}
      <div id="profile">${loadingBlock(t('pl.loading'))}</div>
    </section>`;
    bindForm();

    const [r, st] = await Promise.all([fetchProfile(gameName, tagLine), API.getStatic(state.patch).catch(() => null)]);
    if (id !== req) return;
    const box = $('#profile');
    if (!box) return;

    const { data, cachedAt } = r;
    if (!data || !st) {
      box.innerHTML = `<div class="state error">${icon('alert', 28)}<p>${esc(r.message || t('pl.fail'))}</p></div>`;
      return;
    }
    if (!mine) remember(data.gameName, data.tagLine);
    document.title = `${data.gameName}#${data.tagLine} – NotLoL`;
    const P = {
      req: id, d: data, st, mine, puuid: data.puuid,
      games: gamesOf(data),
      next: 20,       // odkud načíst další zápasy
      details: new Map(), // id zápasu -> podrobnosti (všichni hráči) | null = nepodařilo se
      detailError: '',
    };
    box.innerHTML = (cachedAt ? `<div class="banner info">${icon('info', 18)}<p>${t('me.cached', { date: esc(fmtDate(cachedAt)) })}</p></div>` : '')
      + profileHtml(P);
    box.querySelector('[data-action="refresh-me"]')?.addEventListener('click', () => renderProfile(gameName, tagLine));
    box.querySelector('[data-action="more-games"]')?.addEventListener('click', e => loadMoreGames(P, e.currentTarget));
    bindMatches(box, st, data.puuid);
    loadProfileDetails(P);
  }

  // ---------- Profil ----------

  // Název se skládá až při vykreslení (uložený profil pak sedí i po změně jazyka)
  function queueName(g) {
    if (QUEUE_NAMES[g.queueId]) return QUEUE_NAMES[g.queueId];
    if (g.gameMode === 'PRACTICETOOL') return t('pl.practice');
    if (MODE_NAMES[g.gameMode]) return MODE_NAMES[g.gameMode];
    if (COOP_QUEUES.has(g.queueId)) return t('pl.coop');
    if (g.queueId === 0 || g.queueId === 3100) return t('pl.custom');
    return g.gameMode || t('pl.game');
  }

  function parseGame(g) {
    const p = g.participants?.[0];
    if (!p) return null;
    const s = p.stats || {};
    const items = [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].filter(Boolean);
    return {
      id: g.gameId || null, // podle něj se dají načíst podrobnosti zápasu
      created: g.gameCreation || 0,
      duration: g.gameDuration || 0,
      queueId: g.queueId,
      gameMode: g.gameMode || '',
      champId: p.championId,
      win: !!s.win,
      remake: (g.gameDuration || 0) < 300,
      arena: isArena(g),
      placement: isArena(g) ? s.subteamPlacement || null : null,
      k: s.kills || 0, d: s.deaths || 0, a: s.assists || 0,
      cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
      items,
      spells: [p.spell1Id, p.spell2Id],
      // Pro statistiky profilu
      mapId: g.mapId || 0,
      dmg: s.totalDamageDealtToChampions || 0,
      gold: s.goldEarned || 0,
      vision: s.visionScore || 0,
      multi: [s.tripleKills || 0, s.quadraKills || 0, s.pentaKills || 0],
      firstBlood: !!s.firstBloodKill,
      lane: p.timeline?.lane || '', role: p.timeline?.role || '',
    };
  }

  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const kdaOf = (k, d, a) => (d ? (k + a) / d : k + a);

  function rankCard(label, q) {
    const prev = q?.prevTier && TIER_NAMES[q.prevTier]
      ? `<small>${t('pl.lastSeason', { rank: TIER_NAMES[q.prevTier] + (q.prevDivision && q.prevDivision !== 'NA' ? ' ' + q.prevDivision : '') })}</small>` : '';
    if (!q?.tier) {
      return `<div class="rank-card unranked"><div class="rc-emblem none">?</div>
        <div class="rc-text"><small>${label}</small><b>${t('unranked')}</b>${prev}</div></div>`;
    }
    // Výhry a prohry ostatních hráčů Riot neposílá (null) – win rate je pak jen v souhrnu posledních zápasů
    const known = q.losses != null;
    const games = known ? q.wins + q.losses : 0;
    const div = q.division && q.division !== 'NA' ? ' ' + q.division : '';
    const wr = games ? q.wins / games : 0;
    return `<div class="rank-card" style="--tc:${RANK_COLORS[q.tier] || 'var(--accent)'}">
      <img class="rc-emblem" src="${EMBLEM}${q.tier.toLowerCase()}.png" alt="" loading="lazy"
        onerror="this.onerror=null;this.src='${CREST}${q.tier.toLowerCase()}.svg'">
      <div class="rc-text">
        <small>${label}</small>
        <b>${TIER_NAMES[q.tier] || q.tier}${div} <span class="lp">${q.lp} LP</span></b>
        ${known ? `<span><span class="${games ? wrClass(wr) : ''}">${games ? pct(wr) : '–'}</span>
          <small>${t('pl.wl', { w: q.wins, l: q.losses })}</small></span>`
          : `<small>${t('pl.lossesHidden')}</small>`}
        ${games ? `<span class="wr-bar"><i style="width:${(wr * 100).toFixed(1)}%"></i></span>` : ''}
        ${prev}
      </div>
    </div>`;
  }

  function profileHtml(P) {
    const { d, st, mine, games } = P;
    const main = topChamps(games)[0];
    const splash = main ? champOf(st, main.id).splash : '';
    const q = d.solo?.tier ? d.solo : d.flex?.tier ? d.flex : null;
    // Starší zápasy klient (možná) pošle po stránkách – jen když je co načítat
    const more = games.length >= 20 && d.puuid && Desktop.active
      ? `<button type="button" class="btn ghost small more-games" data-action="more-games">${t('pr.more')}</button>` : '';
    return `<header class="player-head${splash ? ' has-splash' : ''}" style="--tc:${q ? RANK_COLORS[q.tier] : 'var(--accent)'};${splash ? `--splash:url('${splash}')` : ''}">
        <span class="p-avatar"><img class="p-icon" src="${iconUrl(d.profileIconId)}" alt=""><span class="p-lvl">${d.level || ''}</span></span>
        <div class="p-name">
          ${mine ? `<span class="you-badge">${icon('user', 13)}${t('me.you')}</span>` : ''}
          <h1>${esc(d.gameName)} <span class="tag">#${esc(d.tagLine)}</span></h1>
          <p class="sub">${t('pl.level', { n: d.level || 0 })}${q ? ` · ${esc(rankLine(q))}` : ''}</p>
        </div>
        <div class="p-actions">
          <a class="btn ghost small" href="${compareHref([...(me && !mine ? [me] : []), d])}">${icon('users', 15)}${t(me && !mine ? 'cmp.withMe' : 'cmp.compare')}</a>
          ${mine ? `<button class="btn ghost small" data-action="refresh-me">${icon('refresh', 15)}${t('me.refresh')}</button>` : ''}
        </div>
      </header>
      <div class="rank-cards">${rankCard('Ranked Solo/Duo', d.solo)}${rankCard('Ranked Flex', d.flex)}</div>
      <div class="profile-stats" id="profileStats">${statsCardsHtml(P)}</div>
      <div class="player-grid">
        <div class="player-side"><div id="profileSummary">${summaryHtml(P)}</div>${masteryHtml(P)}</div>
        <div class="card"><h2>${t('pl.matches')} <small class="match-count" id="matchCount">${games.length}</small></h2>
          <div class="matches" id="matchList">${games.length ? games.map(g => matchRowHtml(g, st)).join('')
            : `<div class="state"><p>${d.privacy === 'PRIVATE' ? t('pl.private') : t('pl.noGames')}</p></div>`}</div>
          ${more}</div>
      </div>`;
  }

  // Části, které se mění s podrobnostmi zápasů a s dalšími načtenými zápasy
  function refreshProfile(P) {
    if (P.req !== req) return;
    const set = (id, html) => {
      const el = document.getElementById(id);
      if (el && el.innerHTML !== html) el.innerHTML = html;
    };
    set('profileStats', statsCardsHtml(P));
    set('profileSummary', summaryHtml(P));
    set('matchCount', String(P.games.length));
  }

  // Nejhranější šampioni ze zápasů (bez remaků)
  function topChamps(games) {
    const byChamp = new Map();
    for (const g of games) {
      if (g.remake) continue;
      const c = byChamp.get(g.champId) || { id: g.champId, games: 0, wins: 0, k: 0, d: 0, a: 0 };
      c.games++; c.wins += g.win ? 1 : 0; c.k += g.k; c.d += g.d; c.a += g.a;
      byChamp.set(g.champId, c);
    }
    return [...byChamp.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
  }

  function summaryHtml({ games, st }) {
    const counted = games.filter(g => !g.remake);
    if (!counted.length) return '';
    const wins = counted.filter(g => g.win).length;
    const sum = counted.reduce((s, g) => ({ k: s.k + g.k, d: s.d + g.d, a: s.a + g.a }), { k: 0, d: 0, a: 0 });
    const n = counted.length;
    return `<div class="card">
        <h2>${t('pl.lastN', { n })}</h2>
        <div class="sum">
          <div class="sum-wr"><b class="${wrClass(wins / n)}">${pct(wins / n)}</b><small>${t('pl.wl', { w: wins, l: n - wins })}</small></div>
          <div class="sum-kda"><b>${nf1.format(sum.k / n)} / ${nf1.format(sum.d / n)} / ${nf1.format(sum.a / n)}</b>
            <small>${nf2.format(kdaOf(sum.k, sum.d, sum.a))} KDA</small></div>
        </div>
        <div class="form-strip">${counted.slice(0, 20).reverse().map(g => `<i class="${g.win ? 'w' : 'l'}"></i>`).join('')}</div>
        <h3>${t('pl.topChamps')}</h3>
        ${topChamps(games).slice(0, 5).map(c => {
          const ch = champOf(st, c.id);
          return `<a class="mu" href="${champHref(ch)}"><img src="${ch.icon}" alt="" loading="lazy">
            <span class="mu-name">${esc(ch.name)}</span>
            <span class="mu-wr ${wrClass(c.wins / c.games)}">${pct(c.wins / c.games)}</span>
            <span class="mu-games">${t('games', { n: c.games })} · ${nf2.format(kdaOf(c.k, c.d, c.a))} KDA</span></a>`;
        }).join('')}
      </div>`;
  }

  function matchRowHtml(g, st) {
    const ch = champOf(st, g.champId);
    const cls = g.remake ? 'remake' : g.win ? 'win' : 'loss';
    const result = g.remake ? t('pl.remake') : g.placement ? t('pl.place', { n: g.placement }) : g.win ? t('pl.win') : t('pl.loss');
    const spells = g.spells.map(sid => st.spells.get(sid)).filter(Boolean)
      .map(s => `<img src="${s.icon}" alt="" title="${esc(s.name)}">`).join('');
    const items = g.items.map(iid => `<img src="${st.itemIcon(iid)}" alt="" title="${esc(st.itemName(iid) || '')}" loading="lazy">`).join('');
    const perMin = g.duration ? g.cs / (g.duration / 60) : 0;
    // Arena: místo CS umístění (1.–8.)
    const cs = g.arena
      ? (g.placement ? `<b class="place-badge p${g.placement <= 4 ? 'top' : 'low'}">#${g.placement}</b>` : '')
      : `<b>${g.cs} CS</b><small>${t('pl.perMin', { n: nf1.format(perMin) })}</small>`;
    // Se známým id jde zápas rozkliknout (podrobnosti se ukážou pod ním)
    const open = g.id ? ` data-game="${g.id}" role="button" tabindex="0" aria-expanded="false" title="${esc(t('md.open'))}"` : '';
    return `<div class="match-wrap"><div class="match ${cls}"${open}>
      <div class="m-res"><b>${result}</b><small>${esc(queueName(g))}</small><small>${I18N.ago(g.created)} · ${mmss(g.duration)}</small></div>
      <a href="${champHref(ch)}" class="m-champ"><img src="${ch.icon}" alt="${esc(ch.name)}" title="${esc(ch.name)}"></a>
      <div class="m-spells">${spells}</div>
      <div class="m-kda"><b>${g.k} / ${g.d} / ${g.a}</b><small>${nf2.format(kdaOf(g.k, g.d, g.a))} KDA</small></div>
      <div class="m-cs">${cs}</div>
      <div class="m-items">${items}</div>
      ${g.id ? `<span class="m-more">${icon('chevron', 16)}</span>` : ''}
    </div>${g.id ? '<div class="match-detail" hidden></div>' : ''}</div>`;
  }

  // ---------- Statistiky profilu ----------

  // Summoner's Rift (normály, ranked, Swiftplay, Clash) – jen tam mají role smysl
  const SR_QUEUES = new Set([400, 420, 430, 440, 480, 490, 700, 720]);
  const isRift = g => g.mapId === 11 || SR_QUEUES.has(g.queueId);
  // Support itemy (úkol podpory) – podle nich se pozná support i bez údaje o lajně
  const SUPPORT_ITEMS = new Set([3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877]);
  const SMITE = 11;

  // Role v zápase: Smite = jungle, support item = support, jinak podle lajny, kterou poslal klient
  function roleOf(g) {
    if (g.spells?.includes(SMITE)) return 'jungle';
    if (g.items?.some(id => SUPPORT_ITEMS.has(id))) return 'supp';
    const lane = String(g.lane || '').toUpperCase(), role = String(g.role || '').toUpperCase();
    if (lane === 'TOP') return 'top';
    if (lane === 'JUNGLE') return 'jungle';
    if (lane === 'MIDDLE' || lane === 'MID') return 'mid';
    if (lane === 'BOTTOM' || lane === 'BOT') return role.includes('SUPPORT') ? 'supp' : 'adc';
    return null;
  }

  // Hodiny a minuty ("2 h 15 min")
  const hm = secs => t('pr.hm', { h: Math.floor(secs / 3600), m: Math.floor((secs % 3600) / 60) });

  function statsCardsHtml(P) {
    const games = P.games.filter(g => !g.remake);
    if (!games.length) return '';
    const sub = `<p class="hint">${t('pl.lastN', { n: games.length })}</p>`;
    return [rolesCard(games), modesCard(games), partnersCard(P), averagesCard(P, games)]
      .map(([title, body]) => `<article class="card pstat"><h2>${title}</h2>${sub}${body}</article>`).join('');
  }

  // Řádek se sloupcem: popisek, podíl her (proužek) a čísla
  const barRow = (label, share, right, title = '') => `<div class="pbar-row"${title ? ` title="${esc(title)}"` : ''}>
      <span class="pbar-label">${label}</span>
      <span class="pbar"><i style="width:${Math.max(3, share * 100).toFixed(1)}%"></i></span>
      <span class="pbar-num">${right}</span>
    </div>`;

  function rolesCard(games) {
    const rift = games.filter(isRift);
    const roles = API.ROLES.map(r => {
      const list = rift.filter(g => roleOf(g) === r.key);
      return { r, games: list.length, wins: list.filter(g => g.win).length };
    }).filter(x => x.games).sort((a, b) => b.games - a.games);
    const body = roles.length ? roles.map(({ r, games: n, wins }) => barRow(
      `<img src="${API.roleIcon(r.icon)}" alt="" onerror="this.remove()">${esc(r.label)}`, n / rift.length,
      `${n}× · <b class="${wrClass(wins / n)}">${pct0(wins / n)}</b>`, t('pr.roleTip', { games: t('games', { n }), wl: t('pl.wl', { w: wins, l: n - wins }) }),
    )).join('') : `<p class="muted">${t('pr.rolesNone')}</p>`;
    return [t('pr.roles'), body];
  }

  function modesCard(games) {
    const modes = new Map();
    for (const g of games) {
      const name = queueName(g);
      const m = modes.get(name) || { name, games: 0, wins: 0, places: [], secs: 0 };
      m.games++; m.wins += g.win ? 1 : 0; m.secs += g.duration || 0;
      if (g.arena && g.placement) m.places.push(g.placement);
      modes.set(name, m);
    }
    const body = [...modes.values()].sort((a, b) => b.games - a.games).map(m => {
      // Arena: průměrné umístění místo win rate
      const stat = m.places.length
        ? `<b>${t('place.short', { p: nf1.format(m.places.reduce((a, b) => a + b, 0) / m.places.length) })}</b>`
        : `<b class="${wrClass(m.wins / m.games)}">${pct0(m.wins / m.games)}</b>`;
      return barRow(esc(m.name), m.games / games.length, `${m.games}× · ${stat}`,
        t('pr.modeTip', { games: t('games', { n: m.games }), wl: t('pl.wl', { w: m.wins, l: m.games - m.wins }), time: hm(m.secs) }));
    }).join('');
    return [t('pr.modes'), body];
  }

  // Spoluhráči ze stejného týmu (v Areně ze stejné dvojice), se kterými hrál aspoň dvakrát
  function partnersOf(P) {
    const map = new Map();
    for (const g of P.games) {
      const det = g.remake ? null : P.details.get(String(g.id));
      const me = det?.players.find(p => p.puuid && p.puuid === P.puuid);
      if (!me) continue;
      for (const m of det.players) {
        if (m === me || !m.puuid || (det.arena ? m.subteam !== me.subteam : m.team !== me.team)) continue;
        const e = map.get(m.puuid) || { gameName: m.gameName, tagLine: m.tagLine, icon: m.icon, games: 0, wins: 0, last: 0 };
        e.games++;
        e.wins += me.win ? 1 : 0;
        e.last = Math.max(e.last, g.created);
        map.set(m.puuid, e);
      }
    }
    return [...map.values()].filter(e => e.games >= 2).sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 6);
  }

  // Zápasy, u kterých se podrobnosti ještě načítají
  const withId = P => P.games.filter(g => g.id && !g.remake);
  const detailsPending = P => withId(P).some(g => !P.details.has(String(g.id)));

  function partnersCard(P) {
    const total = withId(P).length;
    const done = withId(P).filter(g => P.details.has(String(g.id))).length;
    const loaded = withId(P).filter(g => P.details.get(String(g.id))).length;
    const list = partnersOf(P);
    const loading = done < total
      ? `<p class="hint loading-line"><span class="spinner small"></span>${t('pr.partnersLoading', { done, total })}</p>` : '';
    let body = list.map(e => {
      const name = e.tagLine ? `<a class="mu-name" href="${playerHref(e.gameName, e.tagLine)}" title="${esc(`${e.gameName}#${e.tagLine}`)}">${esc(e.gameName)}</a>`
        : `<span class="mu-name">${esc(e.gameName || '?')}</span>`;
      return `<div class="mu"><img src="${iconUrl(e.icon)}" alt="" loading="lazy">${name}
        <span class="mu-wr ${wrClass(e.wins / e.games)}">${pct0(e.wins / e.games)}</span>
        <span class="mu-games">${t('pr.together', { games: t('games', { n: e.games }) })} · ${I18N.ago(e.last)}</span></div>`;
    }).join('');
    // Nic se nenačetlo (třeba neběží LoL klient) – řekni proč
    if (!body && !loading) body = `<p class="muted">${!loaded && P.detailError ? esc(P.detailError) : t('pr.partnersNone')}</p>`;
    return [t('pr.partners'), body + loading];
  }

  /**
   * Základní statistiky ze zápasů (bez remaků): win rate, KDA, průměry za minutu, hlavní role a mód.
   * Za minutu jen zápasy mimo Arenu s načtenými čísly (null = žádné takové).
   */
  function basicStats(all) {
    const games = all.filter(g => !g.remake);
    const n = games.length;
    if (!n) return null;
    const wins = games.filter(g => g.win).length;
    const k = games.reduce((s, g) => s + g.k, 0), d = games.reduce((s, g) => s + g.d, 0), a = games.reduce((s, g) => s + g.a, 0);
    const base = games.filter(g => !g.arena && g.duration && g.dmg != null);
    const mins = base.reduce((s, g) => s + g.duration / 60, 0);
    const per = key => (mins ? base.reduce((s, g) => s + (g[key] || 0), 0) / mins : null);
    const rift = games.filter(isRift);
    const roles = API.ROLES.map(r => ({ role: r, games: rift.filter(g => roleOf(g) === r.key).length })).sort((x, y) => y.games - x.games);
    const modes = new Map();
    for (const g of games) modes.set(queueName(g), (modes.get(queueName(g)) || 0) + 1);
    const mode = [...modes].sort((x, y) => y[1] - x[1])[0];
    return {
      n, wins, losses: n - wins, wr: wins / n,
      k: k / n, d: d / n, a: a / n, kda: kdaOf(k, d, a),
      dmgMin: per('dmg'), goldMin: per('gold'), csMin: per('cs'), visionMin: per('vision'),
      avgTime: games.reduce((s, g) => s + g.duration, 0) / n,
      mainRole: roles[0]?.games ? { ...roles[0], share: roles[0].games / rift.length } : null,
      mainMode: mode ? { name: mode[0], games: mode[1] } : null,
      form: games.slice(0, 10),
    };
  }

  function averagesCard(P, games) {
    const b = basicStats(games);
    const base = games.filter(g => !g.arena && g.duration && g.dmg != null);
    const mins = b.dmgMin != null;
    const multi = games.reduce((s, g) => (g.multi || [0, 0, 0]).map((x, i) => s[i] + x), [0, 0, 0]);
    // Z podrobností zápasů: podíl na zabitích a na poškození týmu
    let kp = 0, share = 0, n = 0;
    for (const g of base) {
      const det = P.details.get(String(g.id));
      const me = det?.players.find(p => p.puuid && p.puuid === P.puuid);
      if (!me) continue;
      const team = det.players.filter(p => p.team === me.team);
      const kills = team.reduce((s, p) => s + p.k, 0), dmg = team.reduce((s, p) => s + p.dmg, 0);
      if (kills) kp += Math.min(1, (me.k + me.a) / kills);
      if (dmg) share += me.dmg / dmg;
      n++;
    }
    const tile = (label, value, title = '') => `<div class="ptile"${title ? ` title="${esc(title)}"` : ''}><b>${value}</b><small>${label}</small></div>`;
    const pending = `<span class="muted">${detailsPending(P) ? '…' : '—'}</span>`;
    const tiles = [
      tile(t('pr.kda'), nf2.format(b.kda), `${nf1.format(b.k)} / ${nf1.format(b.d)} / ${nf1.format(b.a)}`),
      mins ? tile(t('pr.dmgMin'), num(b.dmgMin)) : '',
      mins ? tile(t('pr.goldMin'), num(b.goldMin)) : '',
      mins ? tile(t('pr.csMin'), nf1.format(b.csMin)) : '',
      mins ? tile(t('pr.visionMin'), nf2.format(b.visionMin)) : '',
      base.length ? tile(t('pr.kp'), n ? pct0(kp / n) : pending) : '',
      base.length ? tile(t('pr.dmgShare'), n ? pct0(share / n) : pending) : '',
      tile(t('pr.avgTime'), mmss(Math.round(b.avgTime))),
      tile(t('pr.playtime'), hm(P.games.reduce((s, g) => s + (g.duration || 0), 0))),
      tile(t('pr.multi'), multi.some(Boolean) ? [[multi[0], 'T'], [multi[1], 'Q'], [multi[2], 'P']].filter(([x]) => x).map(([x, l]) => `${x}× ${l}`).join(' · ') : '0',
        `${t('md.multi3')} ${multi[0]} · ${t('md.multi4')} ${multi[1]} · ${t('md.multi5')} ${multi[2]}`),
      tile('First blood', games.filter(g => g.firstBlood).length),
    ];
    return [t('pr.stats'), `<div class="ptiles">${tiles.join('')}</div>`];
  }

  function masteryHtml({ d, st }) {
    const list = (d.mastery || []).slice(0, 6);
    if (!list.length) return '';
    const fmt = new Intl.NumberFormat(I18N.intl, { notation: 'compact', maximumFractionDigits: 1 });
    return `<div class="card"><h2>${t('pr.mastery')}</h2>${list.map(m => {
      const ch = champOf(st, m.champ);
      return `<a class="mu" href="${champHref(ch)}"><img src="${ch.icon}" alt="" loading="lazy">
        <span class="mu-name">${esc(ch.name)} <span class="mlvl" title="${esc(t('pr.levelTip', { n: m.level }))}">${m.level}</span></span>
        <span class="mu-wr">${t('pr.points', { n: fmt.format(m.points) })}</span>
        <span class="mu-games">${m.last ? t('pr.lastPlayed', { ago: I18N.ago(m.last) }) : ''}</span></a>`;
    }).join('')}</div>`;
  }

  // ---------- Načítání podrobností a dalších zápasů ----------

  // Podrobnosti všech zápasů (spoluhráči, KP, podíl na poškození) – po třech, výsledky se ukazují průběžně
  async function loadProfileDetails(P) {
    const todo = withId(P).filter(g => !P.details.has(String(g.id)));
    if (!todo.length || P.loadingDetails) return;
    P.loadingDetails = true;
    let timer = 0;
    const later = () => { if (!timer) timer = setTimeout(() => { timer = 0; refreshProfile(P); }, 150); };
    let i = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (i < todo.length && P.req === req) {
        const g = todo[i++];
        const r = await loadDetail(String(g.id));
        let det = null;
        try { if (r.ok && r.data) det = parseDetail(r.data); } catch { /* nečekaná data */ }
        if (!det) P.detailError = r.message || t('md.fail');
        P.details.set(String(g.id), det);
        later();
      }
    }));
    P.loadingDetails = false;
    refreshProfile(P);
    // Mezitím mohly přibýt další zápasy
    if (P.req === req && detailsPending(P)) loadProfileDetails(P);
  }

  async function loadMoreGames(P, btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.innerHTML = `<span class="spinner small"></span>${esc(t('loading'))}`;
    const r = await Desktop.matchHistory(P.puuid, P.next);
    if (P.req !== req) return;
    if (!r.ok) {
      btn.disabled = false;
      btn.textContent = label;
      toast(r.message || t('md.fail'), false);
      return;
    }
    // Klient může stránkování ignorovat a poslat znovu stejné zápasy – ty přeskočíme
    const known = new Set(P.games.map(g => g.id));
    const fresh = (r.data || []).map(parseGame).filter(g => g && !known.has(g.id)).sort((a, b) => b.created - a.created);
    P.next += 20;
    if (!fresh.length) {
      btn.replaceWith(Object.assign(document.createElement('p'), { className: 'hint more-games', textContent: t('pr.noMore') }));
      return;
    }
    P.games.push(...fresh);
    P.games.sort((a, b) => b.created - a.created);
    document.getElementById('matchList')?.insertAdjacentHTML('beforeend', fresh.map(g => matchRowHtml(g, P.st)).join(''));
    btn.disabled = false;
    btn.textContent = label;
    refreshProfile(P);
    loadProfileDetails(P);
  }

  // ---------- Podrobnosti zápasu (rozkliknutý zápas) ----------

  const details = new Map(); // id zápasu -> odpověď LoL klienta (jednou načtený zápas se už nestahuje)
  const num = n => I18N.int(Math.round(n || 0));
  const pct0 = x => new Intl.NumberFormat(I18N.intl, { style: 'percent', maximumFractionDigits: 0 }).format(x);

  function loadDetail(gameId) {
    let p = details.get(gameId);
    if (!p) {
      p = Desktop.matchDetail(gameId).then(r => {
        if (!r.ok || !r.data) details.delete(gameId); // příště to zkusit znovu
        return r;
      });
      details.set(gameId, p);
    }
    return p;
  }

  // Klik (nebo Enter) na zápas rozbalí pod ním všechny hráče; odkazy v řádku fungují dál
  function bindMatches(box, st, puuid) {
    const toggle = async row => {
      const panel = row.closest('.match-wrap')?.querySelector('.match-detail');
      if (!panel) return;
      const open = row.getAttribute('aria-expanded') !== 'true';
      row.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (!open || panel.dataset.state) return;
      panel.dataset.state = 'loading';
      panel.innerHTML = loadingBlock(t('md.loading'));
      const r = await loadDetail(row.dataset.game);
      let html = '';
      try { if (r.ok && r.data) html = await detailHtml(r.data, st, puuid); } catch { /* nečekaná data */ }
      if (html) {
        panel.dataset.state = 'done';
        panel.innerHTML = html;
      } else {
        delete panel.dataset.state; // po zavření a otevření se zkusí znovu
        panel.innerHTML = `<p class="md-error">${icon('alert', 16)}${esc(r.message || t('md.fail'))}</p>`;
      }
    };
    box.addEventListener('click', e => {
      const row = e.target.closest('.match[data-game]');
      if (row && !e.target.closest('a')) toggle(row);
    });
    box.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.match[data-game]')) {
        e.preventDefault();
        toggle(e.target);
      }
    });
  }

  // Zápas z LoL klienta (/lol-match-history/v1/games/{id}) -> hráči se vším, co ukazujeme
  function parseDetail(game) {
    const who = new Map((game.participantIdentities || []).map(x => [x.participantId, x.player || {}]));
    const players = (game.participants || []).map(p => {
      const s = p.stats || {};
      const id = who.get(p.participantId) || {};
      return {
        puuid: id.puuid || '',
        gameName: id.gameName || id.summonerName || '',
        tagLine: id.tagLine || '',
        icon: id.profileIcon || 0,
        champId: p.championId,
        team: p.teamId,
        spells: [p.spell1Id, p.spell2Id],
        keystone: s.perk0, subStyle: s.perkSubStyle,
        level: s.champLevel || 0,
        k: s.kills || 0, d: s.deaths || 0, a: s.assists || 0,
        dmg: s.totalDamageDealtToChampions || 0,
        phys: s.physicalDamageDealtToChampions || 0, magic: s.magicDamageDealtToChampions || 0, trueDmg: s.trueDamageDealtToChampions || 0,
        taken: s.totalDamageTaken || 0,
        gold: s.goldEarned || 0,
        cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
        vision: s.visionScore || 0,
        items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].filter(Boolean),
        win: !!s.win,
        subteam: s.playerSubteamId || 0,
        place: s.subteamPlacement || 0,
        augments: [s.playerAugment1, s.playerAugment2, s.playerAugment3, s.playerAugment4, s.playerAugment5, s.playerAugment6].filter(Boolean),
        multi: s.pentaKills ? 5 : s.quadraKills ? 4 : s.tripleKills ? 3 : 0,
      };
    });
    return { players, teams: game.teams || [], minutes: (game.gameDuration || 0) / 60, arena: isArena(game) };
  }

  async function detailHtml(game, st, puuid) {
    const d = parseDetail(game);
    if (!d.players.length) return '';
    const ctx = { st, puuid, arena: d.arena, minutes: d.minutes, maxDmg: Math.max(1, ...d.players.map(p => p.dmg)), augs: null };
    // Arena: dvojice seřazené podle umístění, u hráčů karty (augmenty)
    if (d.arena) {
      ctx.augs = await API.getAugments().catch(() => null);
      const duos = new Map();
      for (const p of d.players) {
        const key = p.subteam || `t${p.team}`;
        if (!duos.has(key)) duos.set(key, []);
        duos.get(key).push(p);
      }
      // Záhlaví sloupců jen nad první dvojicí
      return [...duos.values()].sort((a, b) => (a[0].place || 99) - (b[0].place || 99)).map((ps, i) => {
        const place = ps[0].place;
        return teamHtml(ps, ctx, { cls: 'arena', win: place > 0 && place <= 4, title: place ? t('pl.place', { n: place }) : '—', labels: i === 0 });
      }).join('');
    }
    // Ostatní módy: modrý a červený tým
    return [100, 200].map(teamId => {
      const ps = d.players.filter(p => p.team === teamId);
      if (!ps.length) return '';
      const team = d.teams.find(x => x.teamId === teamId) || {};
      const win = team.win != null ? team.win === 'Win' || team.win === true : ps.some(p => p.win);
      const obj = [
        t('md.towers', { n: team.towerKills || 0 }),
        team.dragonKills ? t('md.dragons', { n: team.dragonKills }) : '',
        team.hordeKills ? t('md.grubs', { n: team.hordeKills }) : '',
        team.riftHeraldKills ? t('md.heralds', { n: team.riftHeraldKills }) : '',
        team.baronKills ? t('md.barons', { n: team.baronKills }) : '',
      ].filter(Boolean).join(' · ');
      const bans = (team.bans || []).filter(b => b.championId > 0).map(b => champOf(st, b.championId))
        .map(c => `<img src="${c.icon}" alt="" title="${esc(c.name)}" loading="lazy">`).join('');
      return teamHtml(ps, ctx, { cls: teamId === 100 ? 'blue' : 'red', win, title: win ? t('pl.win') : t('pl.loss'),
        side: t(teamId === 100 ? 'md.blue' : 'md.red'), obj, bans });
    }).join('');
  }

  function teamHtml(ps, ctx, { cls, win, title, side = '', obj = '', bans = '', labels: withLabels = true }) {
    const sum = ps.reduce((s, p) => ({ k: s.k + p.k, d: s.d + p.d, a: s.a + p.a, gold: s.gold + p.gold }), { k: 0, d: 0, a: 0, gold: 0 });
    const label = (text, c = '') => `<span class="${c}">${text}</span>`;
    const labels = ctx.arena
      ? [label(''), label(''), label('KDA'), label(t('md.dmg')), label(t('md.taken'), 'md-c-taken'), label(t('ig.cards')), label(t('card.items'), 'md-c-items')]
      : [label(''), label('', 'md-icons'), label(''), label('KDA'), label(t('md.dmg')), label(t('md.taken'), 'md-c-taken'), label(t('md.gold'), 'md-c-gold'),
        label('CS', 'md-c-cs'), label(t('md.vision'), 'md-c-vision'), label(t('card.items'), 'md-c-items')];
    return `<section class="md-team ${cls} ${win ? 'win' : 'loss'}">
      <header class="md-head">
        <b class="md-res">${esc(title)}</b>${side ? `<span class="md-side">${esc(side)}</span>` : ''}
        <span class="md-score">${sum.k} / ${sum.d} / ${sum.a}</span>
        ${obj ? `<span class="md-obj">${esc(obj)}</span>` : ''}
        ${ctx.arena ? '' : `<span class="md-obj">${t('md.goldTotal', { n: num(sum.gold) })}</span>`}
        ${bans ? `<span class="md-bans" title="${esc(t('md.bans'))}">${bans}</span>` : ''}
      </header>
      ${withLabels ? `<div class="md-row md-labels ${ctx.arena ? 'arena' : ''}">${labels.join('')}</div>` : ''}
      ${ps.map(p => playerDetailHtml(p, ctx, sum.k)).join('')}
    </section>`;
  }

  function playerDetailHtml(p, ctx, teamKills) {
    const { st } = ctx;
    const ch = champOf(st, p.champId);
    const name = !p.gameName ? esc(ch.name)
      : p.tagLine ? `<a href="${playerHref(p.gameName, p.tagLine)}" title="${esc(`${p.gameName}#${p.tagLine}`)}">${esc(p.gameName)}</a>` : esc(p.gameName);
    const multi = p.multi ? `<span class="md-multi m${p.multi}">${t('md.multi' + p.multi)}</span>` : '';
    // Podíl na zabitích týmu (v Areně nedává smysl – tam jen KDA)
    const kp = ctx.arena ? '' : ` · ${t('md.kp', { p: pct0(teamKills ? Math.min(1, (p.k + p.a) / teamKills) : 0) })}`;
    const items = p.items.map(id => `<img src="${st.itemIcon(id)}" alt="" title="${esc(st.itemName(id) || '')}" loading="lazy">`).join('');
    const cells = [
      `<a class="md-champ" href="${champHref(ch)}" title="${esc(ch.name)}"><img src="${ch.icon}" alt="" loading="lazy"><span>${p.level}</span></a>`,
    ];
    if (!ctx.arena) {
      // Kouzla a runy (keystone, vedlejší strom) ve čtverci 2 × 2
      const img = (x, c = '') => (x ? `<img class="${c}" src="${x.icon}" alt="" title="${esc(x.name)}" loading="lazy">` : '<i></i>');
      const [s1, s2] = p.spells.map(id => st.spells.get(id));
      cells.push(`<div class="md-icons">${img(s1)}${img(st.runes.get(p.keystone), 'rn')}${img(s2)}${img(st.styles.get(p.subStyle), 'rn')}</div>`);
    }
    cells.push(
      `<div class="md-who"><b>${name}</b><small>${esc(ch.name)}${multi}</small></div>`,
      `<div class="md-kda"><b>${p.k} / ${p.d} / ${p.a}</b><small${kp ? ` title="${esc(t('md.kpTip'))}"` : ''}>${nf2.format(kdaOf(p.k, p.d, p.a))}${kp}</small></div>`,
      `<div class="md-dmg" title="${esc(t('md.dmgTip', { phys: num(p.phys), magic: num(p.magic), tru: num(p.trueDmg) }))}"><b>${num(p.dmg)}</b>
        <span class="md-bar"><i style="width:${Math.min(100, p.dmg / ctx.maxDmg * 100).toFixed(1)}%"></i></span></div>`,
      `<div class="md-c-taken" title="${esc(t('md.takenTip'))}">${num(p.taken)}</div>`,
    );
    if (ctx.arena) {
      const augs = p.augments.map(id => ctx.augs?.get(id)).filter(Boolean)
        .map(a => `<img class="r-${a.rarity}" src="${a.icon}" alt="" title="${esc(a.name)}" loading="lazy">`).join('');
      cells.push(`<div class="md-augs">${augs}</div>`);
    } else {
      cells.push(
        `<div class="md-c-gold">${num(p.gold)}</div>`,
        `<div class="md-c-cs"><b>${p.cs}</b><small>${t('pl.perMin', { n: nf1.format(ctx.minutes ? p.cs / ctx.minutes : 0) })}</small></div>`,
        `<div class="md-c-vision">${p.vision}</div>`,
      );
    }
    cells.push(`<div class="md-c-items">${items}</div>`);
    return `<div class="md-row ${ctx.arena ? 'arena' : ''} ${p.puuid && p.puuid === ctx.puuid ? 'me' : ''}">${cells.join('')}</div>`;
  }

  return {
    renderSearchPage, renderProfile, parseRiotId, playerHref, compareHref, setNav,
    setMe, forgetMe, renderMeChip, setOnline, isMe, meCardHtml,
    // Pro porovnání hráčů (compare.js)
    fetchProfile, gamesOf, basicStats, topChamps, recent, iconUrl, rankLine, TIER_NAMES, CREST,
    get me() { return me; },
  };
})();
