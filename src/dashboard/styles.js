export function getDashboardStyles() {
  return `
    :root {
      --bg: #09090b;
      --surface: #121217;
      --surface-2: #191922;
      --surface-3: #22222d;
      --border: rgba(255, 255, 255, 0.08);
      --border-strong: rgba(255, 255, 255, 0.16);
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --accent: #d8ff35;
      --green: #10b981;
      --blue: #38bdf8;
      --pink: #f472b6;
      --amber: #f59e0b;
      --red: #ef4444;
      --radius: 16px;
      --sidebar-w: 232px;
      --topbar-h: 60px;
      --dock-h: 64px;
    }

    * {
      box-sizing: border-box;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    *::-webkit-scrollbar { display: none; }

    html, body {
      margin: 0;
      padding: 0;
      height: 100dvh;
      width: 100%;
      overflow: hidden;
      background: radial-gradient(circle at top right, rgba(216, 255, 53, 0.07), transparent 40%), var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
    }

    .dash-shell {
      height: 100dvh;
      width: 100%;
      display: grid;
      grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      overflow: hidden;
    }

    /* Static Sidebar (Desktop) */
    .sidebar {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 14px;
      background: rgba(14, 14, 19, 0.96);
      border-right: 1px solid var(--border);
      min-height: 0;
      overflow: hidden;
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 0 6px;
    }
    .brand h1 {
      margin: 0;
      font-size: 19px;
      font-weight: 800;
      letter-spacing: -0.03em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .brand h1 span { color: var(--accent); }
    .env-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      max-width: 100%;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(216, 255, 53, 0.12);
      border: 1px solid rgba(216, 255, 53, 0.3);
      color: var(--accent);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nav-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 12px;
    }
    .nav-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .nav-btn:hover {
      background: var(--surface-2);
      color: var(--text);
    }
    .nav-btn.is-active {
      background: rgba(216, 255, 53, 0.12);
      border-color: rgba(216, 255, 53, 0.32);
      color: var(--accent);
    }
    .nav-count {
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--surface-3);
      color: var(--text);
    }
    .sidebar-foot {
      padding: 12px;
      border-radius: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11.5px;
      color: var(--muted);
    }
    .sidebar-foot__row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .sidebar-foot__row strong {
      color: var(--text);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Main Column */
    .main-col {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }

    .topbar {
      flex-shrink: 0;
      min-height: var(--topbar-h);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(9, 9, 11, 0.9);
      backdrop-filter: blur(8px);
    }
    .topbar__title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .topbar__mobile-brand {
      display: none;
      font-size: 15px;
      font-weight: 800;
      color: var(--accent);
    }
    .topbar__title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
    }
    .status-dot.is-warn {
      background: var(--amber);
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .btn, .select, .input {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 7px 11px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease;
    }
    .input {
      cursor: text;
      min-width: 170px;
    }
    .btn:hover, .select:hover, .input:focus {
      outline: none;
      border-color: var(--border-strong);
    }
    .btn.is-active {
      background: var(--accent);
      color: #09090b;
      border-color: var(--accent);
    }
    .btn--live.is-on {
      border-color: rgba(16, 185, 129, 0.45);
      background: rgba(16, 185, 129, 0.14);
      color: #6ee7b7;
    }

    /* Confined Tab Viewport with Scroll Fades */
    .viewport-wrap {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .viewport {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 18px 20px 28px;
    }
    .viewport[data-fade-top="true"][data-fade-bottom="true"] {
      -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 22px, black calc(100% - 26px), transparent 100%);
      mask-image: linear-gradient(to bottom, transparent 0, black 22px, black calc(100% - 26px), transparent 100%);
    }
    .viewport[data-fade-top="true"]:not([data-fade-bottom="true"]) {
      -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 22px, black 100%);
      mask-image: linear-gradient(to bottom, transparent 0, black 22px, black 100%);
    }
    .viewport[data-fade-bottom="true"]:not([data-fade-top="true"]) {
      -webkit-mask-image: linear-gradient(to bottom, black 0, black calc(100% - 26px), transparent 100%);
      mask-image: linear-gradient(to bottom, black 0, black calc(100% - 26px), transparent 100%);
    }

    .tab-panel { display: none; flex-direction: column; gap: 14px; }
    .tab-panel.is-active { display: flex; }

    /* KPI Grid - strictly aligned 3-row cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }
    .kpi-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 15px;
      display: grid;
      grid-template-rows: auto auto auto;
      gap: 8px;
      min-width: 0;
      cursor: pointer;
      text-align: left;
      color: inherit;
      transition: border-color 150ms ease, transform 150ms ease, background 150ms ease;
    }
    .kpi-card:hover {
      border-color: rgba(216, 255, 53, 0.35);
      background: var(--surface-2);
      transform: translateY(-1px);
    }
    .kpi-card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
    }
    .kpi-card__label {
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kpi-card__tag {
      font-size: 10.5px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--surface-3);
      color: var(--text);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .kpi-card__tag.is-live { background: rgba(16, 185, 129, 0.16); color: #6ee7b7; }
    .kpi-card__tag.is-warn { background: rgba(245, 158, 11, 0.16); color: #fcd34d; }
    .kpi-card__value {
      font-size: clamp(22px, 2.3vw, 28px);
      font-weight: 800;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.1;
    }
    .kpi-card__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      font-size: 12px;
      color: var(--muted);
    }
    .kpi-card__sub {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .kpi-card__arrow {
      color: var(--accent);
      font-weight: 700;
      flex-shrink: 0;
    }

    /* Cards & Interactive Daily Chart */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .card__title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .seg-group {
      display: inline-flex;
      padding: 3px;
      border-radius: 10px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      gap: 2px;
    }
    .seg-btn {
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 7px;
      cursor: pointer;
    }
    .seg-btn.is-active {
      background: var(--accent);
      color: #09090b;
    }

    .legend-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .legend-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      cursor: pointer;
      transition: opacity 140ms ease, border-color 140ms ease;
    }
    .legend-pill.is-off {
      opacity: 0.42;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .day-inspector {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 9px 12px;
      border-radius: 12px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      font-size: 12.5px;
    }
    .day-inspector__date {
      font-weight: 700;
      color: var(--accent);
      white-space: nowrap;
    }
    .day-inspector__stats {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .day-inspector__stats strong { color: var(--text); }

    /* Horizontal Scroller with Lateral Fades & Desktop < > Arrows */
    .h-scroll-shell {
      position: relative;
      min-width: 0;
    }
    .h-scroll-track {
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scroll-behavior: smooth;
    }
    .h-scroll-track[data-fade-left="true"][data-fade-right="true"] {
      -webkit-mask-image: linear-gradient(to right, transparent 0, black 28px, black calc(100% - 28px), transparent 100%);
      mask-image: linear-gradient(to right, transparent 0, black 28px, black calc(100% - 28px), transparent 100%);
    }
    .h-scroll-track[data-fade-left="true"]:not([data-fade-right="true"]) {
      -webkit-mask-image: linear-gradient(to right, transparent 0, black 28px, black 100%);
      mask-image: linear-gradient(to right, transparent 0, black 28px, black 100%);
    }
    .h-scroll-track[data-fade-right="true"]:not([data-fade-left="true"]) {
      -webkit-mask-image: linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%);
      mask-image: linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%);
    }
    .h-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 3;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1px solid var(--border-strong);
      background: rgba(18, 18, 23, 0.92);
      color: var(--text);
      font-weight: 800;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
    }
    .h-arrow--prev { left: 4px; }
    .h-arrow--next { right: 4px; }
    .h-arrow.is-visible { display: inline-flex; }

    .chart-col-hit { cursor: pointer; }
    .chart-col-bg { fill: transparent; transition: fill 120ms ease; }
    .chart-col-hit:hover .chart-col-bg,
    .chart-col-hit.is-selected .chart-col-bg {
      fill: rgba(216, 255, 53, 0.08);
    }

    /* Grid layouts inside tabs */
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .bars { display: flex; flex-direction: column; gap: 10px; }
    .bar-row { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
    .bar-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
    }
    .bar-head span {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bar-head strong { color: var(--text); font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .bar-track {
      height: 8px;
      background: var(--surface-2);
      border-radius: 999px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 240ms ease;
    }

    /* Presence Strip */
    .presence-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .presence-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 11px;
      border-radius: 999px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      font-size: 12.5px;
      max-width: 100%;
    }
    .presence-chip strong {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 160px;
    }
    .presence-chip span {
      color: var(--muted);
      font-size: 11.5px;
      white-space: nowrap;
    }

    /* Tables confined cleanly */
    .table-box {
      max-height: 460px;
      overflow: auto;
      overscroll-behavior: contain;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 9px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--surface);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      font-weight: 700;
      white-space: nowrap;
    }
    .cell-truncate {
      max-width: 240px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      white-space: nowrap;
    }
    .badge--warn { color: #fcd34d; border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.1); }
    .badge--err { color: #fca5a5; border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.1); }
    .badge--ok { color: #6ee7b7; border-color: rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.1); }

    .log-row { cursor: pointer; }
    .log-row:hover td { background: rgba(255, 255, 255, 0.02); }
    .log-meta {
      margin-top: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--surface-2);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      color: var(--muted);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .chip-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      width: max-content;
    }
    .filter-chip {
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--muted);
      border-radius: 999px;
      padding: 5px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .filter-chip.is-active {
      background: var(--accent);
      border-color: var(--accent);
      color: #09090b;
    }

    .empty { color: var(--muted); font-size: 13px; padding: 10px 0; }

    /* Mobile Dock */
    .mobile-dock {
      display: none;
    }

    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 899px) {
      .dash-shell {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) auto;
      }
      .sidebar { display: none; }
      .topbar { padding: 10px 14px; }
      .topbar__mobile-brand { display: inline; }
      .viewport { padding: 14px 14px 20px; }
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid-2, .grid-3 { grid-template-columns: minmax(0, 1fr); }
      .h-arrow { display: none !important; }
      .mobile-dock {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 4px;
        padding: 8px 10px max(8px, env(safe-area-inset-bottom));
        background: rgba(14, 14, 19, 0.98);
        border-top: 1px solid var(--border);
      }
      .mobile-dock__btn {
        border: 1px solid transparent;
        background: transparent;
        color: var(--muted);
        border-radius: 10px;
        padding: 8px 4px;
        font-size: 11.5px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mobile-dock__btn.is-active {
        background: rgba(216, 255, 53, 0.14);
        border-color: rgba(216, 255, 53, 0.35);
        color: var(--accent);
      }
    }

    @media (max-width: 480px) {
      .kpi-grid { grid-template-columns: minmax(0, 1fr); }
      .controls { gap: 4px; }
      .btn, .select { padding: 6px 8px; font-size: 12px; }
    }
  `;
}
