import { getDashboardClientScript } from './client.js';
import { getDashboardStyles } from './styles.js';

export function renderDashboardHtml({ environmentLabel = 'production', port = 3003 } = {}) {
  const safeEnv = String(environmentLabel).replace(/[<>&"']/g, '');
  const safePort = Number(port);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>DiviDinDin! Analytics (${safeEnv})</title>
  <style>${getDashboardStyles()}</style>
</head>
<body>
  <div class="dash-shell">
    <aside class="sidebar">
      <div>
        <div class="brand">
          <h1>DiviDinDin! <span>Analytics</span></h1>
          <span class="env-badge">${safeEnv} · porta ${safePort} · Tailscale</span>
        </div>
        <nav class="nav-list" aria-label="Navegação principal">
          <button type="button" class="nav-btn is-active" data-tab-btn="overview">
            <span>Visão Geral</span>
            <span class="nav-count" id="nav-count-presence">0</span>
          </button>
          <button type="button" class="nav-btn" data-tab-btn="funnel">
            <span>Funil &amp; Eventos</span>
            <span class="nav-count" id="nav-count-events">0</span>
          </button>
          <button type="button" class="nav-btn" data-tab-btn="users">
            <span>Usuários</span>
            <span class="nav-count" id="nav-count-users">0</span>
          </button>
          <button type="button" class="nav-btn" data-tab-btn="logs">
            <span>Logs (90d)</span>
            <span class="nav-count" id="nav-count-logs">0</span>
          </button>
        </nav>
      </div>
      <div class="sidebar-foot">
        <div class="sidebar-foot__row"><span>Banco (read-only)</span><strong id="sidebar-db-size">—</strong></div>
        <div class="sidebar-foot__row"><span id="sidebar-db-detail">—</span></div>
        <div class="sidebar-foot__row"><span>Atualizado</span><strong id="sidebar-updated">—</strong></div>
      </div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <div class="topbar__title-wrap">
          <span class="status-dot" id="status-dot" title="Online"></span>
          <span class="topbar__mobile-brand">DiviDinDin!</span>
          <h2 class="topbar__title" id="topbar-title">Visão Geral</h2>
        </div>
        <div class="controls">
          <button type="button" class="btn period-btn" data-days="7">7d</button>
          <button type="button" class="btn period-btn is-active" data-days="14">14d</button>
          <button type="button" class="btn period-btn" data-days="30">30d</button>
          <button type="button" class="btn btn--live" id="live-btn">Ao vivo: off</button>
          <button type="button" class="btn" id="refresh-btn">Atualizar</button>
        </div>
      </header>

      <div class="viewport-wrap">
        <main class="viewport" id="main-viewport">
          <section class="tab-panel is-active" data-tab-panel="overview">
            <div class="kpi-grid" id="kpi-grid"></div>

            <article class="card">
              <div class="card__header">
                <h3 class="card__title">Atividade diária (Brasília)</h3>
                <div class="seg-group" role="tablist" aria-label="Modo do gráfico">
                  <button type="button" class="seg-btn is-active" data-chart-mode="counts">Quantidade</button>
                  <button type="button" class="seg-btn" data-chart-mode="volume">Volume (R$)</button>
                </div>
              </div>
              <div class="legend-pills" id="chart-legend"></div>
              <div class="day-inspector" id="day-inspector">Passe o cursor ou toque em um dia para inspecionar.</div>
              <div class="h-scroll-shell">
                <button type="button" class="h-arrow h-arrow--prev" id="chart-prev" aria-label="Rolar gráfico à esquerda">&lt;</button>
                <div class="h-scroll-track" id="chart-track">
                  <div id="daily-chart"></div>
                </div>
                <button type="button" class="h-arrow h-arrow--next" id="chart-next" aria-label="Rolar gráfico à direita">&gt;</button>
              </div>
            </article>

            <article class="card">
              <div class="card__header">
                <h3 class="card__title">Usuários ativos neste instante</h3>
              </div>
              <div id="overview-presence"></div>
            </article>
          </section>

          <section class="tab-panel" data-tab-panel="funnel">
            <div class="grid-3">
              <article class="card">
                <div class="card__header"><h3 class="card__title">Modos de divisão</h3></div>
                <div class="bars" id="split-bars"></div>
              </article>
              <article class="card">
                <div class="card__header"><h3 class="card__title">Origem dos participantes</h3></div>
                <div class="bars" id="funnel-bars"></div>
              </article>
              <article class="card">
                <div class="card__header"><h3 class="card__title">Sessões ativas (PWA vs Web)</h3></div>
                <div class="bars" id="session-bars"></div>
              </article>
            </div>
            <article class="card">
              <div class="card__header">
                <h3 class="card__title">Eventos com atividade recente</h3>
                <input type="search" class="input" id="event-search" placeholder="Filtrar evento..." />
              </div>
              <div class="table-box" id="events-table"></div>
            </article>
          </section>

          <section class="tab-panel" data-tab-panel="users">
            <article class="card">
              <div class="card__header"><h3 class="card__title">Presença instantânea (5 min)</h3></div>
              <div id="users-presence"></div>
            </article>
            <article class="card">
              <div class="card__header">
                <h3 class="card__title">Contas registradas (últimas 50)</h3>
                <input type="search" class="input" id="user-search" placeholder="Buscar @usuario ou nome..." />
              </div>
              <div class="table-box" id="users-table"></div>
            </article>
          </section>

          <section class="tab-panel" data-tab-panel="logs">
            <article class="card">
              <div class="card__header">
                <h3 class="card__title">Logs operacionais (90d)</h3>
                <input type="search" class="input" id="log-search" placeholder="Buscar usuário, evento ou JSON..." />
              </div>
              <div class="h-scroll-shell">
                <button type="button" class="h-arrow h-arrow--prev" id="log-chips-prev" aria-label="Rolar filtros à esquerda">&lt;</button>
                <div class="h-scroll-track" id="log-chips-track">
                  <div class="chip-row" id="log-type-chips"></div>
                </div>
                <button type="button" class="h-arrow h-arrow--next" id="log-chips-next" aria-label="Rolar filtros à direita">&gt;</button>
              </div>
              <div class="table-box" id="logs-table"></div>
            </article>
          </section>
        </main>
      </div>
    </div>

    <nav class="mobile-dock" aria-label="Navegação mobile">
      <button type="button" class="mobile-dock__btn is-active" data-tab-btn="overview">Geral</button>
      <button type="button" class="mobile-dock__btn" data-tab-btn="funnel">Funil</button>
      <button type="button" class="mobile-dock__btn" data-tab-btn="users">Usuários</button>
      <button type="button" class="mobile-dock__btn" data-tab-btn="logs">Logs</button>
    </nav>
  </div>

  <script>${getDashboardClientScript()}</script>
</body>
</html>`;
}
