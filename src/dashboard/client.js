export function getDashboardClientScript() {
  return `
    const state = {
      tab: 'overview',
      days: 14,
      logType: '',
      logSearch: '',
      eventSearch: '',
      userSearch: '',
      chartMode: 'counts',
      visibleSeries: new Set(['expenses', 'logins', 'events', 'settlements', 'failures']),
      selectedDate: null,
      expandedLogId: null,
      liveRefresh: false,
      liveTimer: null,
      data: null,
    };

    const TAB_TITLES = {
      overview: 'Visão Geral',
      funnel: 'Funil & Eventos',
      users: 'Usuários & Presença',
      logs: 'Logs Operacionais (90d)',
    };

    const SPLIT_LABELS = {
      EQUAL_ALL: 'Dividir igualmente (todos)',
      SUBSET_EQUAL: 'Apenas alguns',
      SHARES: 'Por partes (frações)',
      EXACT_AMOUNTS: 'Valores exatos (R$)',
      PERCENTAGES: 'Porcentagem (%)',
    };

    const SOURCE_LABELS = {
      creator: 'Criador do evento',
      join: 'Entrou via convite',
      claim: 'Reivindicou placeholder',
      placeholder: 'Placeholder sem conta',
      unknown: 'Histórico anterior',
    };

    const SERIES_CONFIG = [
      { key: 'expenses', label: 'Gastos', color: 'var(--accent)', getValue: (d) => d.expensesCreated },
      { key: 'logins', label: 'Logins/Cadastros', color: 'var(--blue)', getValue: (d) => d.logins },
      { key: 'events', label: 'Eventos', color: 'var(--green)', getValue: (d) => d.eventsCreated },
      { key: 'settlements', label: 'Acertos', color: 'var(--pink)', getValue: (d) => d.settlementsCreated },
      { key: 'failures', label: 'Falhas login', color: 'var(--red)', getValue: (d) => d.loginFailures },
    ];

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));
    }

    function fmtMoney(cents) {
      return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function fmtBytes(bytes) {
      const b = Number(bytes || 0);
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function fmtDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function fmtShortDate(ymd) {
      if (!ymd || typeof ymd !== 'string') return '—';
      const parts = ymd.split('-');
      return parts.length === 3 ? parts[2] + '/' + parts[1] : ymd;
    }

    function fmtRelativeMinutes(iso) {
      if (!iso) return '—';
      const diffMs = Date.now() - Date.parse(iso);
      if (!Number.isFinite(diffMs) || diffMs < 0) return 'agora';
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'agora';
      if (mins < 60) return mins + ' min';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h';
      return Math.floor(hrs / 24) + 'd';
    }

    function updateVerticalFades() {
      const vp = document.getElementById('main-viewport');
      if (!vp) return;
      const top = vp.scrollTop > 1;
      const bottom = vp.scrollTop + vp.clientHeight < vp.scrollHeight - 1;
      vp.setAttribute('data-fade-top', top ? 'true' : 'false');
      vp.setAttribute('data-fade-bottom', bottom ? 'true' : 'false');
    }

    function syncHorizontalTrack(trackId, prevId, nextId) {
      const track = document.getElementById(trackId);
      const prev = document.getElementById(prevId);
      const next = document.getElementById(nextId);
      if (!track || !prev || !next) return;
      const left = track.scrollLeft > 2;
      const right = track.scrollLeft + track.clientWidth < track.scrollWidth - 2;
      track.setAttribute('data-fade-left', left ? 'true' : 'false');
      track.setAttribute('data-fade-right', right ? 'true' : 'false');
      prev.classList.toggle('is-visible', left);
      next.classList.toggle('is-visible', right);
    }

    function bindHorizontalControls(trackId, prevId, nextId) {
      const track = document.getElementById(trackId);
      const prev = document.getElementById(prevId);
      const next = document.getElementById(nextId);
      if (!track || !prev || !next) return;
      track.addEventListener('scroll', () => syncHorizontalTrack(trackId, prevId, nextId), { passive: true });
      prev.addEventListener('click', () => {
        track.scrollBy({ left: -Math.max(180, track.clientWidth * 0.6), behavior: 'smooth' });
      });
      next.addEventListener('click', () => {
        track.scrollBy({ left: Math.max(180, track.clientWidth * 0.6), behavior: 'smooth' });
      });
    }

    function switchTab(tab) {
      if (!TAB_TITLES[tab]) return;
      state.tab = tab;
      document.getElementById('topbar-title').textContent = TAB_TITLES[tab];
      document.querySelectorAll('[data-tab-btn]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.tabBtn === tab);
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.tabPanel === tab);
      });
      const vp = document.getElementById('main-viewport');
      if (vp) vp.scrollTop = 0;
      requestAnimationFrame(() => {
        updateVerticalFades();
        syncHorizontalTrack('chart-track', 'chart-prev', 'chart-next');
        syncHorizontalTrack('log-chips-track', 'log-chips-prev', 'log-chips-next');
      });
    }

    function renderBarList(items, total, defaultColor = 'var(--accent)') {
      if (!items.length) return '<div class="empty">Sem registros ainda.</div>';
      const max = Math.max(1, total, ...items.map((x) => x.value));
      return items.map((item) => {
        const pct = Math.round((item.value / max) * 100);
        const sharePct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return '<div class="bar-row">' +
          '<div class="bar-head"><span>' + esc(item.label) + '</span><strong>' + item.value + (total > 0 ? ' (' + sharePct + '%)' : '') + '</strong></div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%; background:' + (item.color || defaultColor) + '"></div></div>' +
        '</div>';
      }).join('');
    }

    function badgeClass(type) {
      if (type.includes('failed')) return 'badge badge--err';
      if (type.includes('deleted')) return 'badge badge--warn';
      if (type.includes('created') || type.includes('registered') || type.includes('installed')) return 'badge badge--ok';
      return 'badge';
    }

    function renderDayInspector(series) {
      const box = document.getElementById('day-inspector');
      if (!box || !series.length) return;
      const selected = series.find((d) => d.date === state.selectedDate) || series[series.length - 1];
      state.selectedDate = selected.date;
      box.innerHTML =
        '<span class="day-inspector__date">' + fmtShortDate(selected.date) + ' (' + esc(selected.date) + ')</span>' +
        '<div class="day-inspector__stats">' +
          '<span>Gastos: <strong>' + selected.expensesCreated + '</strong></span>' +
          '<span>Volume: <strong>' + fmtMoney(selected.expenseVolumeCents) + '</strong></span>' +
          '<span>Logins/Cad.: <strong>' + selected.logins + ' (' + selected.newUsers + ' novos)</strong></span>' +
          '<span>Eventos: <strong>' + selected.eventsCreated + '</strong></span>' +
          '<span>Acertos: <strong>' + selected.settlementsCreated + '</strong></span>' +
          '<span>Falhas: <strong>' + selected.loginFailures + '</strong></span>' +
        '</div>';
    }

    function renderChart() {
      const data = state.data;
      if (!data) return;
      const series = data.dailySeries || [];
      const container = document.getElementById('daily-chart');
      if (!series.length) {
        container.innerHTML = '<div class="empty">Sem série diária disponível.</div>';
        return;
      }

      if (!series.some((d) => d.date === state.selectedDate)) {
        state.selectedDate = series[series.length - 1].date;
      }
      renderDayInspector(series);

      const isVolume = state.chartMode === 'volume';
      const activeSeries = isVolume
        ? [{ key: 'volume', label: 'Volume (R$)', color: 'var(--accent)', getValue: (d) => d.expenseVolumeCents }]
        : SERIES_CONFIG.filter((s) => state.visibleSeries.has(s.key));

      const minSlot = isVolume ? 32 : Math.max(28, activeSeries.length * 9 + 12);
      const w = Math.max(580, series.length * minSlot + 56);
      const h = 210;
      const padL = isVolume ? 64 : 34;
      const padR = 14;
      const padT = 16;
      const padB = 28;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      let rawMax = 1;
      for (const d of series) {
        for (const s of activeSeries) {
          const val = Number(s.getValue(d) || 0);
          if (val > rawMax) rawMax = val;
        }
      }
      const maxVal = rawMax;
      const slot = plotW / series.length;
      const barCount = Math.max(1, activeSeries.length);
      const barW = Math.max(4, Math.min(18, (slot - 10) / barCount));

      const gridLines = [0, 0.5, 1].map((ratio) => {
        const y = Math.round(padT + plotH * (1 - ratio));
        const val = Math.round(maxVal * ratio);
        const label = isVolume ? ('R$ ' + Math.round(val / 100)) : String(val);
        return '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="rgba(255,255,255,0.08)" stroke-dasharray="' + (ratio === 0 ? '' : '3 3') + '" />' +
          '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" fill="#a1a1aa" font-size="10">' + label + '</text>';
      }).join('');

      const cols = series.map((d, idx) => {
        const xSlot = padL + idx * slot;
        const groupWidth = barCount * barW + (barCount - 1) * 1.5;
        const xStart = xSlot + (slot - groupWidth) / 2;
        const isSelected = d.date === state.selectedDate;

        const bars = activeSeries.map((s, j) => {
          const val = Number(s.getValue(d) || 0);
          const bh = val > 0 ? Math.max(3, Math.round((val / maxVal) * plotH)) : 0;
          const x = xStart + j * (barW + 1.5);
          const y = padT + plotH - bh;
          return '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + barW.toFixed(1) + '" height="' + bh + '" rx="2.5" fill="' + s.color + '" opacity="' + (isSelected ? '1' : '0.88') + '" />';
        }).join('');

        const showLabel = series.length <= 16 || idx % 2 === 0 || idx === series.length - 1;
        const dateLabel = showLabel
          ? '<text x="' + (xSlot + slot / 2).toFixed(1) + '" y="' + (h - 7) + '" text-anchor="middle" fill="' + (isSelected ? '#d8ff35' : '#a1a1aa') + '" font-weight="' + (isSelected ? '700' : '500') + '" font-size="10">' + fmtShortDate(d.date) + '</text>'
          : '';

        return '<g class="chart-col-hit' + (isSelected ? ' is-selected' : '') + '" data-chart-date="' + esc(d.date) + '">' +
          '<rect class="chart-col-bg" x="' + (xSlot + 1).toFixed(1) + '" y="' + padT + '" width="' + Math.max(4, slot - 2).toFixed(1) + '" height="' + plotH + '" rx="6" />' +
          bars +
          dateLabel +
        '</g>';
      }).join('');

      container.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:' + w + 'px; min-width:100%; height:210px; display:block;">' +
        gridLines +
        cols +
      '</svg>';

      container.querySelectorAll('[data-chart-date]').forEach((el) => {
        const selectDay = () => {
          if (state.selectedDate === el.dataset.chartDate) return;
          state.selectedDate = el.dataset.chartDate;
          renderChart();
        };
        el.addEventListener('mouseenter', selectDay);
        el.addEventListener('click', selectDay);
      });

      requestAnimationFrame(() => syncHorizontalTrack('chart-track', 'chart-prev', 'chart-next'));
    }

    function renderLegend() {
      const legend = document.getElementById('chart-legend');
      if (!legend) return;
      if (state.chartMode === 'volume') {
        legend.innerHTML = '<span class="legend-pill"><span class="dot" style="background:var(--accent)"></span>Volume diário de gastos (R$)</span>';
        return;
      }
      legend.innerHTML = SERIES_CONFIG.map((s) => {
        const off = !state.visibleSeries.has(s.key);
        return '<button type="button" class="legend-pill' + (off ? ' is-off' : '') + '" data-series="' + s.key + '">' +
          '<span class="dot" style="background:' + s.color + '"></span>' + esc(s.label) +
        '</button>';
      }).join('');

      legend.querySelectorAll('[data-series]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.series;
          if (state.visibleSeries.has(key) && state.visibleSeries.size > 1) {
            state.visibleSeries.delete(key);
          } else {
            state.visibleSeries.add(key);
          }
          renderLegend();
          renderChart();
        });
      });
    }

    function renderOverview(data) {
      const u = data.users;
      const s = data.sessions;
      const e = data.events;
      const p = data.participants;
      const ex = data.expenses;
      const st = data.settlements;
      const pr = data.presence || {};

      const isFallback = pr.source !== 'memory-ttl' || pr.degraded;
      const presenceTag = isFallback
        ? '<span class="kpi-card__tag is-warn">Fallback SQL</span>'
        : '<span class="kpi-card__tag is-live">RAM · ' + (pr.windowMinutes || 5) + 'm</span>';
      const presenceSub = isFallback
        ? 'Ações 60m: ' + (pr.recent60mCount || 0) + ' · ' + (pr.reason === 'high-concurrency' ? 'Pico > 2000' : 'Modo econômico')
        : pr.pwaCount + ' PWA · ' + pr.browserCount + ' web · cap ' + (pr.maxUsers || 2000);

      const settlementRate = e.withExpenses > 0 ? Math.round((e.withSettlements / e.withExpenses) * 100) : 0;
      const claimRate = p.total > 0 ? Math.round((p.linked / p.total) * 100) : 0;

      const cards = [
        {
          tab: 'users',
          label: 'Ativos agora',
          tag: presenceTag,
          value: pr.count ?? 0,
          sub: presenceSub,
        },
        {
          tab: 'users',
          label: 'Usuários',
          tag: '<span class="kpi-card__tag">+' + u.newInPeriod + ' (' + data.periodDays + 'd)</span>',
          value: u.total,
          sub: 'DAU ' + u.active24h + ' · WAU ' + u.active7d + ' · 2+ ev: ' + u.returningMultiEvent,
        },
        {
          tab: 'funnel',
          label: 'Eventos',
          tag: '<span class="kpi-card__tag">' + settlementRate + '% quit.</span>',
          value: e.total,
          sub: e.activeInPeriod + ' ativos (' + data.periodDays + 'd) · média ' + e.avgParticipants + ' part.',
        },
        {
          tab: 'funnel',
          label: 'Volume gastos',
          tag: '<span class="kpi-card__tag">' + ex.total + ' lanç.</span>',
          value: fmtMoney(ex.totalAmountCents),
          sub: ex.inPeriod + ' no período · ticket ' + fmtMoney(ex.avgAmountCents),
        },
        {
          tab: 'funnel',
          label: 'Acertos & PWA',
          tag: '<span class="kpi-card__tag">' + claimRate + '% vinc.</span>',
          value: st.total,
          sub: fmtMoney(st.totalAmountCents) + ' pagos · ' + s.pwa + ' sessões PWA',
        },
      ];

      const kpiGrid = document.getElementById('kpi-grid');
      kpiGrid.innerHTML = cards.map((c) =>
        '<button type="button" class="kpi-card" data-jump-tab="' + c.tab + '">' +
          '<div class="kpi-card__head"><span class="kpi-card__label">' + esc(c.label) + '</span>' + c.tag + '</div>' +
          '<div class="kpi-card__value">' + esc(c.value) + '</div>' +
          '<div class="kpi-card__foot"><span class="kpi-card__sub">' + esc(c.sub) + '</span><span class="kpi-card__arrow">→</span></div>' +
        '</button>'
      ).join('');

      kpiGrid.querySelectorAll('[data-jump-tab]').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.jumpTab));
      });

      renderLegend();
      renderChart();
      renderPresencePanel('overview-presence', pr);
    }

    function renderPresencePanel(targetId, pr) {
      const box = document.getElementById(targetId);
      if (!box) return;
      const list = pr.users || [];
      const meta = pr.degraded
        ? '<span class="badge badge--warn">Fallback Opção A (' + esc(pr.reason || 'econômico') + ')</span>'
        : '<span class="badge badge--ok">Opção B em RAM · ' + (pr.count || 0) + '/' + (pr.maxUsers || 2000) + (pr.rssMb ? ' · ' + pr.rssMb + ' MB' : '') + '</span>';

      const chips = list.length
        ? '<div class="presence-chips">' + list.slice(0, 24).map((u) => {
            const label = u.username ? '@' + u.username : (u.name || u.userId);
            const extra = u.clientMode ? u.clientMode : (u.lastEventType || 'ativo');
            return '<span class="presence-chip"><span class="dot" style="background:var(--green)"></span><strong>' + esc(label) + '</strong><span>' + esc(extra) + ' · ' + fmtRelativeMinutes(u.lastActiveAt) + '</span></span>';
          }).join('') + '</div>'
        : '<div class="empty">Nenhum usuário ativo nos últimos ' + (pr.windowMinutes || 5) + ' minutos.</div>';

      box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        '<span style="font-size:12.5px;color:var(--muted);">Janela de ' + (pr.windowMinutes || 5) + ' min · Última hora: <strong style="color:var(--text)">' + (pr.recent60mCount || 0) + '</strong></span>' +
        meta +
      '</div>' + chips;
    }

    function renderFunnelTab(data) {
      const ex = data.expenses;
      const p = data.participants;
      const s = data.sessions;

      const splitItems = Object.entries(ex.bySplitMode || {}).map(([key, value]) => ({
        label: SPLIT_LABELS[key] || key,
        value,
        color: key === 'EQUAL_ALL' ? 'var(--accent)' : key === 'SHARES' ? 'var(--blue)' : 'var(--pink)',
      }));
      document.getElementById('split-bars').innerHTML = renderBarList(splitItems, ex.total);

      const sourceItems = Object.entries(p.byJoinSource || {}).map(([key, value]) => ({
        label: SOURCE_LABELS[key] || key,
        value,
        color: key === 'placeholder' ? 'var(--amber)' : key === 'claim' ? 'var(--green)' : 'var(--blue)',
      }));
      document.getElementById('funnel-bars').innerHTML = renderBarList(sourceItems, p.total);

      const sessionItems = [
        { label: 'PWA standalone', value: s.pwa, color: 'var(--green)' },
        { label: 'Navegador web', value: s.browser, color: 'var(--blue)' },
        { label: 'Sessões anteriores (sem header)', value: s.unknown, color: 'var(--muted)' },
      ];
      document.getElementById('session-bars').innerHTML = renderBarList(sessionItems, s.activeTotal);

      const term = state.eventSearch.trim().toLowerCase();
      const events = (data.topEvents || []).filter((ev) => !term || ev.title.toLowerCase().includes(term));
      document.getElementById('events-table').innerHTML = events.length
        ? '<table><thead><tr><th>Evento</th><th class="num">Part.</th><th class="num">Gastos</th><th class="num">Volume</th><th class="num">Acertos</th><th class="num">Atualizado</th></tr></thead><tbody>' +
          events.map((ev) =>
            '<tr><td class="cell-truncate" title="' + esc(ev.title) + '"><strong>' + esc(ev.title) + '</strong></td>' +
            '<td class="num">' + ev.claimedCount + '/' + ev.participantCount + '</td>' +
            '<td class="num">' + ev.expenseCount + '</td>' +
            '<td class="num">' + fmtMoney(ev.totalExpensesCents) + '</td>' +
            '<td class="num">' + ev.settlementCount + '</td>' +
            '<td class="num">' + fmtDateTime(ev.updatedAt) + '</td></tr>'
          ).join('') + '</tbody></table>'
        : '<div class="empty">Nenhum evento encontrado.</div>';
    }

    function renderUsersTab(data) {
      renderPresencePanel('users-presence', data.presence || {});
      const term = state.userSearch.trim().toLowerCase();
      const users = (data.usersOverview || []).filter((u) => {
        if (!term) return true;
        return (u.username || '').toLowerCase().includes(term) || (u.name || '').toLowerCase().includes(term);
      });

      document.getElementById('users-table').innerHTML = users.length
        ? '<table><thead><tr><th>Usuário</th><th>Nome</th><th class="num">Eventos</th><th class="num">Gastos</th><th class="num">Volume</th><th class="num">Último acesso</th></tr></thead><tbody>' +
          users.map((u) =>
            '<tr>' +
              '<td class="cell-truncate"><strong>@' + esc(u.username) + '</strong> ' + (u.hasAvatar ? '<span class="badge badge--ok">foto</span>' : '') + '</td>' +
              '<td class="cell-truncate" title="' + esc(u.name) + '">' + esc(u.name) + '</td>' +
              '<td class="num">' + u.eventCount + '</td>' +
              '<td class="num">' + u.expenseCount + '</td>' +
              '<td class="num">' + fmtMoney(u.totalCreatedCents) + '</td>' +
              '<td class="num">' + fmtDateTime(u.lastSeenAt || u.createdAt) + '</td>' +
            '</tr>'
          ).join('') + '</tbody></table>'
        : '<div class="empty">Nenhum usuário encontrado.</div>';
    }

    function renderLogsTab(data) {
      const counts = data.logCountsInPeriod || {};
      const allTypes = Array.from(new Set([...Object.keys(counts), ...(data.recentLogs || []).map((l) => l.eventType)])).sort();

      const chipsEl = document.getElementById('log-type-chips');
      chipsEl.innerHTML = '<button type="button" class="filter-chip' + (state.logType === '' ? ' is-active' : '') + '" data-log-chip="">Todos</button>' +
        allTypes.map((t) =>
          '<button type="button" class="filter-chip' + (state.logType === t ? ' is-active' : '') + '" data-log-chip="' + esc(t) + '">' +
            esc(t) + (counts[t] ? ' (' + counts[t] + ')' : '') +
          '</button>'
        ).join('');

      chipsEl.querySelectorAll('[data-log-chip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.logType = btn.dataset.logChip;
          loadMetrics();
        });
      });

      const term = state.logSearch.trim().toLowerCase();
      const logs = (data.recentLogs || []).filter((l) => {
        if (!term) return true;
        const hay = [l.eventType, l.username, l.userName, l.eventTitle, l.metadata ? JSON.stringify(l.metadata) : ''].join(' ').toLowerCase();
        return hay.includes(term);
      });

      document.getElementById('logs-table').innerHTML = logs.length
        ? '<table><thead><tr><th>Quando</th><th>Tipo</th><th>Usuário</th><th>Evento / Detalhe</th></tr></thead><tbody>' +
          logs.map((log) => {
            const who = log.username ? '@' + log.username : (log.userId ? log.userId.slice(0, 10) : 'anônimo');
            const summary = log.eventTitle || (log.metadata ? JSON.stringify(log.metadata) : '—');
            const expanded = state.expandedLogId === log.id && log.metadata;
            return '<tr class="log-row" data-log-id="' + log.id + '">' +
              '<td class="num" style="text-align:left;">' + fmtDateTime(log.createdAt) + '</td>' +
              '<td><span class="' + badgeClass(log.eventType) + '">' + esc(log.eventType) + '</span></td>' +
              '<td class="cell-truncate">' + esc(who) + '</td>' +
              '<td><div class="cell-truncate" title="' + esc(summary) + '">' + esc(summary) + '</div>' +
                (expanded ? '<div class="log-meta">' + esc(JSON.stringify(log.metadata, null, 2)) + '</div>' : '') +
              '</td>' +
            '</tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty">Nenhum log corresponde ao filtro.</div>';

      document.querySelectorAll('[data-log-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const id = Number(row.dataset.logId);
          state.expandedLogId = state.expandedLogId === id ? null : id;
          renderLogsTab(state.data);
        });
      });

      requestAnimationFrame(() => syncHorizontalTrack('log-chips-track', 'log-chips-prev', 'log-chips-next'));
    }

    function renderAll() {
      const data = state.data;
      if (!data) return;

      document.getElementById('nav-count-presence').textContent = String(data.presence?.count ?? 0);
      document.getElementById('nav-count-events').textContent = String(data.events?.total ?? 0);
      document.getElementById('nav-count-users').textContent = String(data.users?.total ?? 0);
      document.getElementById('nav-count-logs').textContent = String(data.recentLogs?.length ?? 0);

      document.getElementById('sidebar-db-size').textContent = fmtBytes(data.storage?.totalBytes);
      document.getElementById('sidebar-db-detail').textContent = 'SQLite ' + fmtBytes(data.storage?.dbBytes) + ' · WAL ' + fmtBytes(data.storage?.walBytes);
      document.getElementById('sidebar-updated').textContent = fmtDateTime(data.generatedAt);

      const statusDot = document.getElementById('status-dot');
      if (data.presence?.degraded) {
        statusDot.classList.add('is-warn');
        statusDot.title = 'Presença em fallback SQL: ' + (data.presence.reason || 'econômico');
        if (state.liveRefresh) setLiveRefresh(false);
      } else {
        statusDot.classList.remove('is-warn');
        statusDot.title = 'Presença em RAM ativa (Opção B)';
      }

      renderOverview(data);
      renderFunnelTab(data);
      renderUsersTab(data);
      renderLogsTab(data);
      requestAnimationFrame(updateVerticalFades);
    }

    async function loadMetrics(fresh = false) {
      const params = new URLSearchParams({ days: String(state.days), logLimit: '100' });
      if (state.logType) params.set('logType', state.logType);
      if (fresh) params.set('fresh', '1');
      const res = await fetch('./api/metrics?' + params.toString(), { cache: 'no-store' });
      if (!res.ok) return;
      state.data = await res.json();
      renderAll();
    }

    function setLiveRefresh(enabled) {
      state.liveRefresh = enabled;
      const btn = document.getElementById('live-btn');
      btn.classList.toggle('is-on', enabled);
      btn.textContent = enabled ? 'Ao vivo · 30s' : 'Ao vivo: off';
      if (state.liveTimer) {
        clearInterval(state.liveTimer);
        state.liveTimer = null;
      }
      if (enabled) {
        state.liveTimer = setInterval(() => loadMetrics(true), 30000);
      }
    }

    document.querySelectorAll('[data-tab-btn]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tabBtn));
    });

    document.querySelectorAll('.period-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.days = Number(btn.dataset.days);
        document.querySelectorAll('.period-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
        loadMetrics();
      });
    });

    document.querySelectorAll('[data-chart-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.chartMode = btn.dataset.chartMode;
        document.querySelectorAll('[data-chart-mode]').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderLegend();
        renderChart();
      });
    });

    document.getElementById('refresh-btn').addEventListener('click', () => loadMetrics(true));
    document.getElementById('live-btn').addEventListener('click', () => setLiveRefresh(!state.liveRefresh));

    document.getElementById('event-search').addEventListener('input', (e) => {
      state.eventSearch = e.target.value;
      if (state.data) renderFunnelTab(state.data);
    });
    document.getElementById('user-search').addEventListener('input', (e) => {
      state.userSearch = e.target.value;
      if (state.data) renderUsersTab(state.data);
    });
    document.getElementById('log-search').addEventListener('input', (e) => {
      state.logSearch = e.target.value;
      if (state.data) renderLogsTab(state.data);
    });

    const viewport = document.getElementById('main-viewport');
    viewport.addEventListener('scroll', updateVerticalFades, { passive: true });
    window.addEventListener('resize', () => {
      updateVerticalFades();
      syncHorizontalTrack('chart-track', 'chart-prev', 'chart-next');
      syncHorizontalTrack('log-chips-track', 'log-chips-prev', 'log-chips-next');
    });

    bindHorizontalControls('chart-track', 'chart-prev', 'chart-next');
    bindHorizontalControls('log-chips-track', 'log-chips-prev', 'log-chips-next');

    loadMetrics();
  `;
}
