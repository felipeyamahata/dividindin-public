/**
 * Renders the self-contained Tailscale-only sustainability admin HTML page.
 * Kept isolated from public routes and styled to match DiviDinDin!'s mobile-first dark aesthetic.
 */
export function renderSustainabilityAdminHtml({ basePath = '', environmentLabel = 'development' } = {}) {
  const safeBase = String(basePath || '').replace(/[<>&"']/g, '');
  const safeEnv = String(environmentLabel || 'development').replace(/[<>&"']/g, '');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Admin Autossustentabilidade · DiviDinDin! (${safeEnv})</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0b0b;
      --card: #171717;
      --border: #383835;
      --ink: #f8f7f2;
      --muted: #b8b8af;
      --accent: #d8ff36;
      --danger: #f45655;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: max(20px, env(safe-area-inset-top, 0px)) 16px max(32px, env(safe-area-inset-bottom, 0px));
    }
    main {
      width: min(100%, 640px);
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .badge {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #1f1f1d;
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    .card h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 750;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
    }
    .kpi {
      background: #111;
      border: 1px solid #2b2b28;
      border-radius: 12px;
      padding: 12px;
      display: grid;
      gap: 4px;
    }
    .kpi span { font-size: 12px; color: var(--muted); }
    .kpi strong { font-size: 18px; font-variant-numeric: tabular-nums; }
    .kpi--accent strong { color: var(--accent); }
    form { display: grid; gap: 12px; }
    .row-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }
    .field { display: grid; gap: 6px; }
    label { font-size: 13px; color: var(--muted); font-weight: 600; }
    input, select, textarea {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #454540;
      border-radius: 10px;
      background: #101010;
      color: var(--ink);
      font: inherit;
      font-size: 16px;
    }
    textarea { min-height: 76px; resize: vertical; }
    .check-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .check-row input { width: 20px; height: 20px; min-height: 0; accent-color: var(--accent); }
    button {
      min-height: 44px;
      padding: 10px 16px;
      border: 0;
      border-radius: 10px;
      font: inherit;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
    }
    .btn-primary { background: var(--accent); color: #111; }
    .btn-secondary { background: #262623; color: var(--ink); border: 1px solid #42423d; }
    .btn-danger { background: rgba(244, 86, 85, 0.16); color: #ff9f9e; border: 1px solid rgba(244, 86, 85, 0.35); min-height: 36px; padding: 6px 10px; font-size: 12px; }
    .list { display: grid; gap: 8px; }
    .item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: #121211;
      border: 1px solid #2b2b28;
    }
    .item__main { min-width: 0; display: grid; gap: 2px; }
    .item__title { font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
    .item__sub { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .item__actions { display: flex; align-items: center; gap: 6px; flex: none; }
    .status {
      min-height: 20px;
      font-size: 13px;
      color: var(--accent);
    }
    .status--error { color: #ff9f9e; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>autossustentabilidade · admin</h1>
        <div class="item__sub">acesso exclusivo tailscale / rede privada</div>
      </div>
      <span class="badge">${safeEnv}</span>
    </header>

    <div class="status" id="global-status" role="status" aria-live="polite"></div>

    <section class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <h2 id="snapshot-month" style="margin:0">resumo do mês</h2>
        <span class="badge" id="snapshot-mode">—</span>
      </div>
      <div class="kpis">
        <div class="kpi kpi--accent"><span>meta calculada</span><strong id="kpi-goal">—</strong></div>
        <div class="kpi"><span>confirmado</span><strong id="kpi-confirmed">—</strong></div>
        <div class="kpi"><span>faltante</span><strong id="kpi-remaining">—</strong></div>
        <div class="kpi"><span>cotação USD</span><strong id="kpi-usd">—</strong></div>
      </div>
    </section>

    <section class="card">
      <h2>confirmar doação recebida (pix)</h2>
      <form id="donation-form">
        <div class="row-2">
          <div class="field">
            <label for="don-amount">valor recebido (R$)</label>
            <input id="don-amount" name="amount" type="text" inputmode="decimal" placeholder="10,00" required />
          </div>
          <div class="field">
            <label for="don-month">mês (AAAA-MM)</label>
            <input id="don-month" name="monthKey" type="text" pattern="\\d{4}-\\d{2}" required />
          </div>
        </div>
        <div class="field">
          <label for="don-note">observação interna (opcional)</label>
          <input id="don-note" name="note" type="text" maxlength="120" placeholder="ex: pix 15/11 18h40" />
        </div>
        <button type="submit" class="btn-primary">registrar doação confirmada</button>
      </form>
      <div class="list" id="donations-list"></div>
    </section>

    <section class="card">
      <h2>custos mensais &amp; anuais</h2>
      <form id="cost-form">
        <input type="hidden" id="cost-id" />
        <div class="field">
          <label for="cost-label">descrição do custo</label>
          <input id="cost-label" type="text" maxlength="80" placeholder="ex: domínio dividindin.com" required />
        </div>
        <div class="row-2">
          <div class="field">
            <label for="cost-amount">valor (na moeda escolhida)</label>
            <input id="cost-amount" type="text" inputmode="decimal" placeholder="14,00" required />
          </div>
          <div class="field">
            <label for="cost-currency">moeda</label>
            <select id="cost-currency">
              <option value="BRL">BRL (R$)</option>
              <option value="USD">USD (US$)</option>
            </select>
          </div>
          <div class="field">
            <label for="cost-cycle">ciclo</label>
            <select id="cost-cycle">
              <option value="monthly">mensal</option>
              <option value="annual">anual (rateado / 12)</option>
            </select>
          </div>
        </div>
        <div class="row-2">
          <button type="submit" class="btn-primary" id="cost-submit-btn">adicionar custo</button>
          <button type="button" class="btn-secondary" id="cost-cancel-btn" hidden>cancelar edição</button>
        </div>
      </form>
      <div class="list" id="costs-list"></div>
    </section>

    <section class="card">
      <h2>configurações do pix &amp; dólar</h2>
      <form id="settings-form">
        <div class="field">
          <label for="set-pix-key">chave pix (ex: chave aleatória)</label>
          <input id="set-pix-key" type="text" maxlength="140" autocomplete="off" />
        </div>
        <div class="row-2">
          <div class="field">
            <label for="set-merchant-name">nome recebedor (máx. 25)</label>
            <input id="set-merchant-name" type="text" maxlength="25" required />
          </div>
          <div class="field">
            <label for="set-merchant-city">cidade (máx. 15)</label>
            <input id="set-merchant-city" type="text" maxlength="15" required />
          </div>
        </div>
        <div class="field">
          <label for="set-usd-fallback">cotação USD→BRL manual / fallback</label>
          <input id="set-usd-fallback" type="text" inputmode="decimal" required />
        </div>
        <div class="check-row">
          <input id="set-auto-usd" type="checkbox" />
          <label for="set-auto-usd">atualizar cotação USD automaticamente em cache</label>
        </div>
        <div class="field">
          <label for="set-intro">texto curto exibido no topo da tela</label>
          <textarea id="set-intro" maxlength="320"></textarea>
        </div>
        <button type="submit" class="btn-primary">salvar configurações</button>
      </form>
    </section>
  </main>

  <script>
    const API_BASE = '${safeBase}/admin/api/sustainability';
    const statusEl = document.getElementById('global-status');

    function setStatus(msg, isError = false) {
      statusEl.textContent = msg || '';
      statusEl.className = isError ? 'status status--error' : 'status';
    }

    function parseDecimalToCents(raw) {
      const normalized = String(raw || '').trim().replace(/\\s+/g, '').replace(',', '.');
      const num = Number(normalized);
      if (!Number.isFinite(num) || num <= 0) return null;
      return Math.round(num * 100);
    }

    function formatBrl(cents) {
      return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatCurrencyRaw(cents, currency) {
      return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: currency === 'USD' ? 'USD' : 'BRL',
      });
    }

    async function apiFetch(path, options = {}) {
      const res = await fetch(API_BASE + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro na requisição');
      return data;
    }

    function renderState(data) {
      const { snapshot, settings, costs, donations } = data;
      document.getElementById('snapshot-month').textContent = 'resumo · ' + snapshot.monthLabel;
      document.getElementById('snapshot-mode').textContent = snapshot.paymentMode === 'mercadopago'
        ? 'Mercado Pago (automático)'
        : 'Pix Estático (manual)';
      document.getElementById('kpi-goal').textContent = formatBrl(snapshot.goalCents);
      document.getElementById('kpi-confirmed').textContent = formatBrl(snapshot.confirmedCents);
      document.getElementById('kpi-remaining').textContent = formatBrl(snapshot.remainingCents);
      document.getElementById('kpi-usd').textContent = 'R$ ' + Number(snapshot.usdToBrlRate).toFixed(2).replace('.', ',') + ' (' + snapshot.rateSource + ')';

      const donMonthInput = document.getElementById('don-month');
      if (!donMonthInput.value) donMonthInput.value = snapshot.monthKey;

      document.getElementById('set-pix-key').value = settings.pixKey || '';
      document.getElementById('set-merchant-name').value = settings.merchantName || '';
      document.getElementById('set-merchant-city').value = settings.merchantCity || '';
      document.getElementById('set-usd-fallback').value = String(settings.usdBrlFallback ?? 5.8).replace('.', ',');
      document.getElementById('set-auto-usd').checked = Boolean(settings.useAutoUsd);
      document.getElementById('set-intro').value = settings.introText || '';

      const costsList = document.getElementById('costs-list');
      costsList.textContent = '';
      if (!costs.length) {
        const empty = document.createElement('div');
        empty.className = 'item__sub';
        empty.textContent = 'Nenhum custo cadastrado ainda.';
        costsList.appendChild(empty);
      } else {
        for (const cost of costs) {
          const row = document.createElement('div');
          row.className = 'item';
          const info = document.createElement('div');
          info.className = 'item__main';
          const title = document.createElement('div');
          title.className = 'item__title';
          title.textContent = cost.label + (cost.is_active ? '' : ' (inativo)');
          const sub = document.createElement('div');
          sub.className = 'item__sub';
          sub.textContent = formatCurrencyRaw(cost.amount_cents, cost.currency) + ' · ' + (cost.billing_cycle === 'annual' ? 'anual' : 'mensal');
          info.append(title, sub);

          const actions = document.createElement('div');
          actions.className = 'item__actions';
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'btn-secondary';
          editBtn.style.minHeight = '36px';
          editBtn.style.padding = '6px 10px';
          editBtn.style.fontSize = '12px';
          editBtn.textContent = 'editar';
          editBtn.onclick = () => {
            document.getElementById('cost-id').value = cost.id;
            document.getElementById('cost-label').value = cost.label;
            document.getElementById('cost-amount').value = (cost.amount_cents / 100).toFixed(2).replace('.', ',');
            document.getElementById('cost-currency').value = cost.currency;
            document.getElementById('cost-cycle').value = cost.billing_cycle;
            document.getElementById('cost-submit-btn').textContent = 'salvar custo';
            document.getElementById('cost-cancel-btn').hidden = false;
          };
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn-danger';
          delBtn.textContent = 'excluir';
          delBtn.onclick = async () => {
            try {
              renderState(await apiFetch('/costs/' + encodeURIComponent(cost.id), { method: 'DELETE' }));
              setStatus('Custo removido.');
            } catch (err) { setStatus(err.message, true); }
          };
          actions.append(editBtn, delBtn);
          row.append(info, actions);
          costsList.appendChild(row);
        }
      }

      const donationsList = document.getElementById('donations-list');
      donationsList.textContent = '';
      if (!donations.length) {
        const empty = document.createElement('div');
        empty.className = 'item__sub';
        empty.textContent = 'Nenhuma doação confirmada ainda.';
        donationsList.appendChild(empty);
      } else {
        for (const don of donations) {
          const row = document.createElement('div');
          row.className = 'item';
          const info = document.createElement('div');
          info.className = 'item__main';
          const title = document.createElement('div');
          title.className = 'item__title';
          title.textContent = formatBrl(don.amount_cents) + ' · ' + don.month_key;
          const sub = document.createElement('div');
          sub.className = 'item__sub';
          sub.textContent = (don.note ? don.note + ' · ' : '') + new Date(don.confirmed_at).toLocaleString('pt-BR');
          info.append(title, sub);

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn-danger';
          delBtn.textContent = 'remover';
          delBtn.onclick = async () => {
            try {
              renderState(await apiFetch('/donations/' + encodeURIComponent(don.id), { method: 'DELETE' }));
              setStatus('Lançamento removido.');
            } catch (err) { setStatus(err.message, true); }
          };
          row.append(info, delBtn);
          donationsList.appendChild(row);
        }
      }
    }

    async function load() {
      try {
        renderState(await apiFetch('/state'));
      } catch (err) {
        setStatus(err.message, true);
      }
    }

    document.getElementById('donation-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountCents = parseDecimalToCents(document.getElementById('don-amount').value);
      if (!amountCents) return setStatus('Informe um valor válido em reais.', true);
      try {
        const data = await apiFetch('/donations', {
          method: 'POST',
          body: JSON.stringify({
            amountCents,
            monthKey: document.getElementById('don-month').value.trim(),
            note: document.getElementById('don-note').value.trim(),
          }),
        });
        document.getElementById('don-amount').value = '';
        document.getElementById('don-note').value = '';
        renderState(data);
        setStatus('Doação confirmada registrada na meta!');
      } catch (err) { setStatus(err.message, true); }
    });

    function resetCostForm() {
      document.getElementById('cost-id').value = '';
      document.getElementById('cost-label').value = '';
      document.getElementById('cost-amount').value = '';
      document.getElementById('cost-currency').value = 'BRL';
      document.getElementById('cost-cycle').value = 'monthly';
      document.getElementById('cost-submit-btn').textContent = 'adicionar custo';
      document.getElementById('cost-cancel-btn').hidden = true;
    }

    document.getElementById('cost-cancel-btn').addEventListener('click', resetCostForm);

    document.getElementById('cost-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountCents = parseDecimalToCents(document.getElementById('cost-amount').value);
      if (!amountCents) return setStatus('Informe um valor de custo válido.', true);
      try {
        const data = await apiFetch('/costs', {
          method: 'POST',
          body: JSON.stringify({
            id: document.getElementById('cost-id').value || undefined,
            label: document.getElementById('cost-label').value.trim(),
            amountCents,
            currency: document.getElementById('cost-currency').value,
            billingCycle: document.getElementById('cost-cycle').value,
          }),
        });
        resetCostForm();
        renderState(data);
        setStatus('Custo salvo e meta recalculada!');
      } catch (err) { setStatus(err.message, true); }
    });

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fallbackRaw = String(document.getElementById('set-usd-fallback').value || '').replace(',', '.');
      try {
        const data = await apiFetch('/settings', {
          method: 'PUT',
          body: JSON.stringify({
            pixKey: document.getElementById('set-pix-key').value.trim(),
            merchantName: document.getElementById('set-merchant-name').value.trim(),
            merchantCity: document.getElementById('set-merchant-city').value.trim(),
            usdBrlFallback: Number(fallbackRaw),
            useAutoUsd: document.getElementById('set-auto-usd').checked,
            introText: document.getElementById('set-intro').value.trim(),
          }),
        });
        renderState(data);
        setStatus('Configurações salvas!');
      } catch (err) { setStatus(err.message, true); }
    });

    load();
  </script>
</body>
</html>`;
}
