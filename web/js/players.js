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
        ${Desktop.active ? '' : `<p class="muted">${t('pl.desktopOnly')}</p>`}
      </div>
      ${list.length ? `<h2 class="section-title">${t('pl.recent')}</h2><div class="recent">${list.map(r =>
        `<a class="chip" href="${playerHref(r.gameName, r.tagLine)}">${icon('user', 14)}${esc(r.gameName)}<small>#${esc(r.tagLine)}</small></a>`).join('')}</div>` : ''}
    </section>`;
    bindForm();
    $('#playerInput')?.focus();
  }

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

    const [r, st] = await Promise.all([Desktop.lookupPlayer(gameName, tagLine), API.getStatic(state.patch).catch(() => null)]);
    if (id !== req) return;
    const box = $('#profile');
    if (!box) return;

    let data = r.ok ? r.data : null;
    let cachedAt = null;
    if (data && mine) {
      // Uložit si vlastní profil – ukáže se i bez zapnutého klienta
      const games = (data.games || []).map(parseGame).filter(Boolean);
      save(ME_PROFILE_KEY, { ...data, games: undefined, parsedGames: games, savedAt: new Date().toISOString() });
    } else if (!data && mine) {
      const cached = load(ME_PROFILE_KEY);
      if (cached) {
        data = cached;
        cachedAt = cached.savedAt;
      }
    }
    if (!data || !st) {
      box.innerHTML = `<div class="state error">${icon('alert', 28)}<p>${esc(r.message || t('pl.fail'))}</p></div>`;
      return;
    }
    if (!mine) remember(data.gameName, data.tagLine);
    document.title = `${data.gameName}#${data.tagLine} – NotLoL`;
    box.innerHTML = (cachedAt ? `<div class="banner info">${icon('info', 18)}<p>${t('me.cached', { date: esc(fmtDate(cachedAt)) })}</p></div>` : '')
      + profileHtml(data, st, mine);
    box.querySelector('[data-action="refresh-me"]')?.addEventListener('click', () => renderProfile(gameName, tagLine));
    bindMatches(box, st, data.puuid);
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

  function profileHtml(d, st, mine) {
    const games = (d.parsedGames || (d.games || []).map(parseGame).filter(Boolean)).sort((a, b) => b.created - a.created);
    const counted = games.filter(g => !g.remake);
    const wins = counted.filter(g => g.win).length;
    const sum = counted.reduce((s, g) => ({ k: s.k + g.k, d: s.d + g.d, a: s.a + g.a }), { k: 0, d: 0, a: 0 });
    const n = counted.length || 1;

    // Nejhranější šampioni z posledních zápasů
    const byChamp = new Map();
    for (const g of counted) {
      const c = byChamp.get(g.champId) || { id: g.champId, games: 0, wins: 0, k: 0, d: 0, a: 0 };
      c.games++; c.wins += g.win ? 1 : 0; c.k += g.k; c.d += g.d; c.a += g.a;
      byChamp.set(g.champId, c);
    }
    const top = [...byChamp.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 5);
    const main = top[0] ? champOf(st, top[0].id) : null;

    const summary = counted.length ? `<div class="card">
        <h2>${t('pl.lastN', { n: counted.length })}</h2>
        <div class="sum">
          <div class="sum-wr"><b class="${wrClass(wins / n)}">${pct(wins / n)}</b><small>${t('pl.wl', { w: wins, l: counted.length - wins })}</small></div>
          <div class="sum-kda"><b>${nf1.format(sum.k / n)} / ${nf1.format(sum.d / n)} / ${nf1.format(sum.a / n)}</b>
            <small>${nf2.format(kdaOf(sum.k, sum.d, sum.a))} KDA</small></div>
        </div>
        <div class="form-strip">${counted.slice(0, 20).reverse().map(g => `<i class="${g.win ? 'w' : 'l'}"></i>`).join('')}</div>
        <h3>${t('pl.topChamps')}</h3>
        ${top.map(c => {
          const ch = champOf(st, c.id);
          return `<a class="mu" href="${champHref(ch)}"><img src="${ch.icon}" alt="" loading="lazy">
            <span class="mu-name">${esc(ch.name)}</span>
            <span class="mu-wr ${wrClass(c.wins / c.games)}">${pct(c.wins / c.games)}</span>
            <span class="mu-games">${t('games', { n: c.games })} · ${nf2.format(kdaOf(c.k, c.d, c.a))} KDA</span></a>`;
        }).join('')}
      </div>` : '';

    const matches = games.length ? games.map(g => {
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
    }).join('') : `<div class="state"><p>${d.privacy === 'PRIVATE' ? t('pl.private') : t('pl.noGames')}</p></div>`;

    const q = d.solo?.tier ? d.solo : d.flex?.tier ? d.flex : null;
    return `<header class="player-head${main ? ' has-splash' : ''}" style="--tc:${q ? RANK_COLORS[q.tier] : 'var(--accent)'};${main ? `--splash:url('${main.splash}')` : ''}">
        <span class="p-avatar"><img class="p-icon" src="${iconUrl(d.profileIconId)}" alt=""><span class="p-lvl">${d.level || ''}</span></span>
        <div class="p-name">
          ${mine ? `<span class="you-badge">${icon('user', 13)}${t('me.you')}</span>` : ''}
          <h1>${esc(d.gameName)} <span class="tag">#${esc(d.tagLine)}</span></h1>
          <p class="sub">${t('pl.level', { n: d.level || 0 })}${q ? ` · ${esc(rankLine(q))}` : ''}</p>
        </div>
        ${mine ? `<button class="btn ghost small" data-action="refresh-me">${icon('refresh', 15)}${t('me.refresh')}</button>` : ''}
      </header>
      <div class="rank-cards">${rankCard('Ranked Solo/Duo', d.solo)}${rankCard('Ranked Flex', d.flex)}</div>
      <div class="player-grid">
        <div>${summary}</div>
        <div class="card"><h2>${t('pl.matches')}</h2><div class="matches">${matches}</div></div>
      </div>`;
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
    renderSearchPage, renderProfile, parseRiotId, playerHref, setNav,
    setMe, forgetMe, renderMeChip, setOnline, isMe, meCardHtml,
    get me() { return me; },
  };
})();
