'use strict';

/*
 * Porovnání hráčů (#/compare/Jméno%23TAG/…): až 5 hráčů vedle sebe – ranky, win rate a forma,
 * KDA, průměry za minutu, hlavní role a mód, šampioni a mistrovství. Nejlepší hodnota v řádku svítí.
 * Data jdou přes LoL klient stejně jako profil (Players.fetchProfile), statistiky z posledních zápasů.
 */
const Compare = (() => {
  const MAX = 5;
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const DIVS = { IV: 0, III: 1, II: 2, I: 3 };

  // Načtené profily na pár minut – přidání dalšího hráče nestahuje znovu ty předchozí
  const cache = new Map(); // "jméno#tag" (malými) -> { at, promise }
  const TTL = 5 * 60 * 1000;
  const keyOf = p => `${p.gameName}#${p.tagLine}`.toLowerCase();

  function load(p) {
    const key = keyOf(p);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = Players.fetchProfile(p.gameName, p.tagLine);
    promise.then(r => { if (!r.data) cache.delete(key); }, () => cache.delete(key));
    cache.set(key, { at: Date.now(), promise });
    return promise;
  }

  const pct0 = x => new Intl.NumberFormat(I18N.intl, { style: 'percent', maximumFractionDigits: 0 }).format(x);
  const num = n => I18N.int(Math.round(n || 0));
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

  // Pořadí ranku pro „nejlepší“ (Master+ jen podle LP)
  function rankValue(q) {
    const tier = TIERS.indexOf(q?.tier);
    if (tier < 0) return null;
    return tier * 1000 + (tier >= 7 ? 0 : (DIVS[q.division] ?? 0) * 100) + (q.lp || 0);
  }

  let req = 0;
  async function render(ids) {
    const id = ++req;
    document.title = `${t('cmp.title')} – NotLoL`;
    Players.setNav('players');
    // Riot ID z adresy, bez duplicit, nejvýš 5
    const list = [];
    for (const raw of ids) {
      const p = Players.parseRiotId(raw);
      if (p && !list.some(x => keyOf(x) === keyOf(p)) && list.length < MAX) list.push(p);
    }
    view.innerHTML = `<section class="page compare">
      <a class="back" href="#/players">${icon('back', 16)}${t('pl.title')}</a>
      <div class="page-head"><div><h1>${t('cmp.title')}</h1><p class="sub">${t('cmp.sub', { n: MAX })}</p></div></div>
      <div class="filters">
        <form class="player-search" id="cmpForm">
          <label class="ps-input">${icon('search', 17)}
            <input class="input" id="cmpInput" placeholder="${esc(t('cmp.placeholder'))}" autocomplete="off" spellcheck="false" ${list.length >= MAX ? 'disabled' : ''}></label>
          <button class="btn" type="submit" ${list.length >= MAX ? 'disabled' : ''}>${t('cmp.add')}</button>
          <span class="ps-error" id="cmpError">${list.length >= MAX ? esc(t('cmp.max', { n: MAX })) : ''}</span>
        </form>
        ${suggestionsHtml(list)}
        ${Desktop.active ? '' : `<p class="muted">${t('pl.desktopOnly')}</p>`}
      </div>
      <div id="cmpBody">${list.length ? loadingBlock(t('pl.loading')) : `<div class="state"><p>${t('cmp.empty')}</p></div>`}</div>
    </section>`;
    bind(list);
    if (!list.length) return;

    const [st, ...results] = await Promise.all([API.getStatic(state.patch).catch(() => null), ...list.map(load)]);
    if (id !== req) return;
    const body = document.getElementById('cmpBody');
    if (!body) return;
    if (!st) {
      body.innerHTML = `<div class="state error">${icon('alert', 28)}<p>${t('err.generic')}</p></div>`;
      return;
    }
    const cols = list.map((p, i) => {
      const r = results[i] || {};
      const d = r.data;
      return d ? { p, d, st, games: Players.gamesOf(d), stats: Players.basicStats(Players.gamesOf(d)), cachedAt: r.cachedAt }
        : { p, error: r.message || t('pl.fail') };
    });
    body.innerHTML = tableHtml(cols, list);
  }

  // Rychlé přidání: tvůj účet a naposledy hledaní hráči, kteří v porovnání ještě nejsou
  function suggestionsHtml(list) {
    if (list.length >= MAX) return '';
    const me = Players.me;
    const options = [...(me ? [{ gameName: me.gameName, tagLine: me.tagLine, me: true }] : []), ...Players.recent()]
      .filter((p, i, all) => !list.some(x => keyOf(x) === keyOf(p)) && all.findIndex(x => keyOf(x) === keyOf(p)) === i)
      .slice(0, 8);
    if (!options.length) return '';
    return `<div class="cmp-suggest"><span class="muted">${t('cmp.suggest')}</span>${options.map(p =>
      `<a class="chip" href="${Players.compareHref([...list, p])}">${icon(p.me ? 'user' : 'users', 14)}${esc(p.gameName)}<small>#${esc(p.tagLine)}</small></a>`).join('')}</div>`;
  }

  function bind(list) {
    document.getElementById('cmpForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('cmpInput');
      const err = document.getElementById('cmpError');
      const p = Players.parseRiotId(input.value);
      if (!p) {
        err.textContent = t('pl.needTag');
        return;
      }
      if (list.some(x => keyOf(x) === keyOf(p))) {
        err.textContent = t('cmp.duplicate');
        return;
      }
      location.hash = Players.compareHref([...list, p]);
    });
  }

  // ---------- Tabulka ----------

  function tableHtml(cols, list) {
    const ok = cols.filter(c => c.stats || c.d);
    // Nejlepší hodnota v řádku (jen když jsou aspoň dvě čísla k porovnání)
    const bestOf = (get, lower = false) => {
      const vals = cols.map(c => (c.d ? get(c) : null));
      const valid = vals.filter(v => v != null && Number.isFinite(v));
      if (valid.length < 2) return () => false;
      const best = lower ? Math.min(...valid) : Math.max(...valid);
      return i => vals[i] === best;
    };
    const row = (label, cell, best = () => false, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th>${cols.map((c, i) =>
      `<td class="${best(i) ? 'best' : ''}">${c.d ? cell(c) : ''}</td>`).join('')}</tr>`;
    const s = c => c.stats;
    // best: 'max' = víc je lepší, null = nezvýrazňovat (třeba délka zápasu)
    const statRow = (label, get, fmt, best = 'max') => row(label, c => (s(c) && get(c) != null ? fmt(get(c)) : '<span class="muted">—</span>'),
      best ? bestOf(c => (s(c) ? get(c) : null), best === 'min') : undefined);

    const head = `<tr class="cmp-head"><th></th>${cols.map(c => {
      const others = list.filter(x => keyOf(x) !== keyOf(c.p));
      const remove = `<a class="cmp-remove" href="${Players.compareHref(others)}" title="${esc(t('cmp.remove'))}">${icon('x', 14)}</a>`;
      if (!c.d) {
        return `<th class="cmp-player err">${remove}<b>${esc(c.p.gameName)}<small>#${esc(c.p.tagLine)}</small></b>
          <p class="cmp-error">${icon('alert', 14)}${esc(c.error)}</p></th>`;
      }
      const q = c.d.solo?.tier ? c.d.solo : c.d.flex?.tier ? c.d.flex : null;
      return `<th class="cmp-player" style="--tc:${q ? RANK_COLORS[q.tier] || 'var(--accent)' : 'var(--accent)'}">${remove}
        <a class="cmp-who" href="${Players.playerHref(c.d.gameName, c.d.tagLine)}">
          <span class="me-avatar big"><img src="${Players.iconUrl(c.d.profileIconId)}" alt=""><span class="me-lvl">${c.d.level || ''}</span></span>
          <b>${esc(c.d.gameName)}<small>#${esc(c.d.tagLine)}</small></b></a>
        ${c.cachedAt ? `<small class="muted">${t('me.cached', { date: esc(fmtDate(c.cachedAt)) }).replace(/<[^>]+>/g, '')}</small>` : ''}
      </th>`;
    }).join('')}</tr>`;

    const rankCell = q => {
      if (!q?.tier) return `<span class="muted">${t('unranked')}</span>`;
      const div = q.division && q.division !== 'NA' ? ' ' + q.division : '';
      const games = q.losses != null ? q.wins + q.losses : 0;
      return `<span class="cmp-rank"><img src="${Players.CREST}${q.tier.toLowerCase()}.svg" alt="" onerror="this.remove()">
        <span><b>${Players.TIER_NAMES[q.tier] || q.tier}${div}</b> <small>${q.lp} LP</small>
        ${games ? `<br><small class="${wrClass(q.wins / games)}">${pct(q.wins / games)}</small> <small class="muted">${t('games', { n: games })}</small>` : ''}</span></span>`;
    };
    const champsCell = c => Players.topChamps(c.games).slice(0, 3).map(x => {
      const ch = champOf(c.st, x.id);
      return `<a class="cmp-champ" href="${champHref(ch)}" title="${esc(`${ch.name} · ${t('games', { n: x.games })} · ${pct(x.wins / x.games)}`)}">
        <img src="${ch.icon}" alt="" loading="lazy"><small>${x.games}</small></a>`;
    }).join('') || '<span class="muted">—</span>';
    const masteryCell = c => {
      const m = c.d.mastery?.[0];
      if (!m) return '<span class="muted">—</span>';
      const ch = champOf(c.st, m.champ);
      const fmt = new Intl.NumberFormat(I18N.intl, { notation: 'compact', maximumFractionDigits: 1 });
      return `<a class="cmp-mastery" href="${champHref(ch)}" title="${esc(t('pr.levelTip', { n: m.level }))}"><img src="${ch.icon}" alt="" loading="lazy">
        <span><b>${esc(ch.name)}</b><small>${t('pr.points', { n: fmt.format(m.points) })}</small></span></a>`;
    };

    const games = Math.max(0, ...ok.map(c => c.stats?.n || 0));
    return `<p class="hint">${t('cmp.basis')}</p>
      <div class="table-wrap cmp-wrap"><table class="cmp-table" style="--cols:${cols.length}">
      <thead>${head}</thead>
      <tbody>
        ${row('Ranked Solo/Duo', c => rankCell(c.d.solo), bestOf(c => rankValue(c.d.solo)))}
        ${row('Ranked Flex', c => rankCell(c.d.flex), bestOf(c => rankValue(c.d.flex)))}
        ${row(t('cmp.games'), c => (s(c) ? t('games', { n: s(c).n }) : '<span class="muted">—</span>'), undefined, 'sub')}
        ${statRow(t('col.wr'), c => s(c).wr, v => `<b class="big">${pct(v)}</b>`)}
        ${row(t('cmp.form'), c => (s(c) ? `<span class="form-strip cmp-form">${s(c).form.slice().reverse().map(g => `<i class="${g.win ? 'w' : 'l'}"></i>`).join('')}</span>
          <small class="muted">${t('pl.wl', { w: s(c).wins, l: s(c).losses })}</small>` : '<span class="muted">—</span>'))}
        ${statRow('KDA', c => s(c).kda, v => `<b>${nf2.format(v)}</b>`)}
        ${row(t('cmp.kdaAvg'), c => (s(c) ? `${nf1.format(s(c).k)} / ${nf1.format(s(c).d)} / ${nf1.format(s(c).a)}` : '<span class="muted">—</span>'), undefined, 'sub')}
        ${statRow(t('pr.dmgMin'), c => s(c).dmgMin, v => `<b>${num(v)}</b>`)}
        ${statRow(t('pr.goldMin'), c => s(c).goldMin, v => `<b>${num(v)}</b>`)}
        ${statRow(t('pr.csMin'), c => s(c).csMin, v => `<b>${nf1.format(v)}</b>`)}
        ${statRow(t('pr.visionMin'), c => s(c).visionMin, v => `<b>${nf2.format(v)}</b>`)}
        ${row(t('cmp.role'), c => {
          const r = s(c)?.mainRole;
          return r ? `<span class="cmp-role"><img src="${API.roleIcon(r.role.icon)}" alt="" onerror="this.remove()">${esc(r.role.label)}
            <small class="muted">${pct0(r.share)}</small></span>` : '<span class="muted">—</span>';
        })}
        ${row(t('cmp.mode'), c => (s(c)?.mainMode ? `${esc(s(c).mainMode.name)} <small class="muted">${s(c).mainMode.games}×</small>` : '<span class="muted">—</span>'))}
        ${row(t('pl.topChamps'), champsCell)}
        ${row(t('pr.mastery'), masteryCell)}
        ${statRow(t('pr.avgTime'), c => s(c).avgTime, v => mmss(v), null)}
        ${row(t('cmp.level'), c => `${c.d.level || '—'}`)}
      </tbody></table></div>
      ${games ? '' : `<p class="muted">${t('pl.noGames')}</p>`}`;
  }

  return { render, MAX };
})();
