/* =========================================================
   Abas: Financeiro, Investimentos e Horas extras
   Usa o `state` e utilidades definidos em app.js
   ========================================================= */

const fmtBRL = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function parseMoney(str){
  if(typeof str === 'number') return str;
  let s = String(str || '').trim().replace(/[R$\s]/g, '');
  if(s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function moneyToInput(n){
  return String(Number(n) || 0).replace('.', ',');
}

/* ---------------- Abas ---------------- */

function switchTab(name){
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + name));
  document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelector('.month-nav').classList.toggle('hidden', name !== 'servicos');
  if(name === 'financeiro') renderFinance();
  if(name === 'investimentos') renderInvest();
  if(name === 'servicos') renderOvertime();
}

/* ---------------- Arrastar para reorganizar (mouse e toque) ---------------- */

function makeSortable(container, onReorder){
  container.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const row = handle.closest('.fin-row');
      row.classList.add('dragging');

      const move = (ev) => {
        ev.preventDefault();
        const others = Array.from(container.querySelectorAll('.fin-row:not(.dragging)'));
        let target = null;
        for(const r of others){
          const b = r.getBoundingClientRect();
          if(ev.clientY < b.top + b.height / 2){ target = r; break; }
        }
        if(target) container.insertBefore(row, target);
        else container.appendChild(row);
      };
      const up = () => {
        row.classList.remove('dragging');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        onReorder(Array.from(container.querySelectorAll('.fin-row')).map(r => r.dataset.id));
      };
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  });
}

function reorderBy(list, ids){
  return ids.map(id => list.find(i => i.id === id)).filter(Boolean);
}

/* ---------------- Financeiro ---------------- */

function renderFinance(){
  const f = state.finance;
  const salaryInput = document.getElementById('finSalary');
  if(document.activeElement !== salaryInput) salaryInput.value = f.salary ? moneyToInput(f.salary) : '';
  renderFinList('entradas', 'listEntradas');
  renderFinList('saidas', 'listSaidas');
  updateFinTotals();
}

function updateFinTotals(){
  const f = state.finance;
  const sum = (arr) => arr.reduce((acc, i) => acc + (Number(i.value) || 0), 0);
  const tin = sum(f.entradas), tout = sum(f.saidas);
  document.getElementById('finTotalIn').textContent = fmtBRL(tin);
  document.getElementById('finTotalOut').textContent = fmtBRL(tout);
  const bal = document.getElementById('finBalance');
  bal.textContent = fmtBRL(tin - tout);
  bal.style.color = (tin - tout) < 0 ? 'var(--danger)' : 'var(--success)';
}

function renderFinList(key, containerId){
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const items = state.finance[key];
  if(!items.length){
    container.innerHTML = '<p class="images-empty">Nenhum item.</p>';
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'fin-row';
    row.dataset.id = item.id;
    row.innerHTML = `
      <span class="drag-handle" title="Arrastar para reorganizar">⋮⋮</span>
      <input class="fin-name" type="text" />
      <input class="fin-value" type="text" inputmode="decimal" />
      <button class="delete-client" title="Excluir">🗑</button>`;
    const nameInput = row.querySelector('.fin-name');
    const valueInput = row.querySelector('.fin-value');
    nameInput.value = item.name;
    valueInput.value = moneyToInput(item.value);

    nameInput.addEventListener('change', () => { item.name = nameInput.value; saveState(); });
    valueInput.addEventListener('change', () => {
      item.value = parseMoney(valueInput.value);
      valueInput.value = moneyToInput(item.value);
      if(item.overtimeId){
        const ot = state.overtime.find(o => o.id === item.overtimeId);
        if(ot) ot.value = item.value;
      }
      saveState();
      updateFinTotals();
    });
    row.querySelector('.delete-client').addEventListener('click', () => {
      state.finance[key] = state.finance[key].filter(i => i.id !== item.id);
      if(item.overtimeId) state.overtime = state.overtime.filter(o => o.id !== item.overtimeId);
      saveState();
      renderFinance();
    });
    container.appendChild(row);
  });
  makeSortable(container, (ids) => {
    state.finance[key] = reorderBy(state.finance[key], ids);
    saveState();
  });
}

function addFinItem(key, nameId, valueId){
  const nameEl = document.getElementById(nameId);
  const valueEl = document.getElementById(valueId);
  if(!nameEl.value.trim()){ showToast('Informe a descrição.'); return; }
  state.finance[key].push({ id: uid(), name: nameEl.value.trim(), value: parseMoney(valueEl.value) });
  nameEl.value = '';
  valueEl.value = '';
  saveState();
  renderFinance();
}

/* ---------------- Horas extras (primeira aba) → entradas do financeiro ---------------- */

function renderOvertime(){
  const dateEl = document.getElementById('otDate');
  if(dateEl && !dateEl.value) dateEl.value = todayISO();
  const list = document.getElementById('otList');
  if(!list) return;
  list.innerHTML = '';
  if(!state.overtime.length){
    list.innerHTML = '<p class="images-empty">Nenhuma hora extra lançada.</p>';
    return;
  }
  const sorted = state.overtime.slice().sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach(ot => {
    const row = document.createElement('div');
    row.className = 'fin-row ot-row';
    row.innerHTML = `
      <span class="ot-date">${formatDisplayDate(ot.date)}</span>
      <span class="ot-info">${ot.hours ? escapeHtml(ot.hours) + ' h' : 'Horas extras'}</span>
      <strong class="ot-value">${fmtBRL(ot.value)}</strong>
      <button class="delete-client" title="Excluir">🗑</button>`;
    row.querySelector('.delete-client').addEventListener('click', () => {
      state.overtime = state.overtime.filter(o => o.id !== ot.id);
      state.finance.entradas = state.finance.entradas.filter(e => e.overtimeId !== ot.id);
      saveState();
      renderOvertime();
    });
    list.appendChild(row);
  });
}

function addOvertime(){
  const date = document.getElementById('otDate').value || todayISO();
  const hours = document.getElementById('otHours').value.trim();
  const value = parseMoney(document.getElementById('otValue').value);
  if(!value){ showToast('Informe o valor das horas extras.'); return; }

  const ot = { id: uid(), date, hours, value };
  state.overtime.push(ot);
  state.finance.entradas.push({
    id: uid(),
    name: 'Horas extras ' + formatDisplayDate(date) + (hours ? ' (' + hours + ' h)' : ''),
    value,
    overtimeId: ot.id
  });
  document.getElementById('otHours').value = '';
  document.getElementById('otValue').value = '';
  saveState();
  renderOvertime();
  showToast('Horas extras lançadas no financeiro.');
}

/* ---------------- Guia de investimentos ---------------- */

const INVEST_PARTS = [
  { calc: s => s * 93,  text: 'Valor que devo ter para ganhar todo mês o meu salário (renda passiva)', formula: '× 93' },
  { calc: s => s * 0.2, text: 'Valor que devo investir por mês para obter o valor acima',             formula: '× 0,2' },
  { calc: s => s * 6,   text: 'Primeira meta a bater, saldo emergencial',                              formula: '× 6' },
  { calc: s => s * 3,   text: 'Quantia de lazer',                                                      formula: '× 3' },
  { calc: s => s / 2,   text: 'Valor ideal para gastos fixos',                                         formula: '÷ 2' }
];

function renderInvest(){
  const salary = state.finance.salary;
  document.getElementById('investSalary').innerHTML = salary
    ? `Base de cálculo: salário de <strong>${fmtBRL(salary)}</strong> (aba Financeiro)`
    : 'Informe seu salário na aba <strong>Financeiro</strong> para ver os valores.';

  const wrap = document.getElementById('investCards');
  wrap.innerHTML = '';
  INVEST_PARTS.forEach((part, i) => {
    const card = document.createElement('div');
    card.className = 'invest-card';
    card.innerHTML = `
      <div class="invest-head">
        <span class="invest-num">${i + 1}</span>
        <span class="invest-formula">${part.formula}</span>
        <strong class="invest-value">${fmtBRL(part.calc(salary))}</strong>
      </div>
      <p class="invest-text">${part.text}</p>`;
    wrap.appendChild(card);
  });
}

/* ---------------- Inicialização ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.main-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  document.getElementById('finSalary').addEventListener('change', (e) => {
    state.finance.salary = parseMoney(e.target.value);
    e.target.value = state.finance.salary ? moneyToInput(state.finance.salary) : '';
    saveState();
  });
  document.getElementById('inAddBtn').addEventListener('click', () => addFinItem('entradas', 'inName', 'inValue'));
  document.getElementById('outAddBtn').addEventListener('click', () => addFinItem('saidas', 'outName', 'outValue'));
  document.getElementById('otAddBtn').addEventListener('click', addOvertime);

  renderOvertime();
});
