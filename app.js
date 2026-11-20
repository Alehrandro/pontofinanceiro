/* =========================================================
   Lançamento de OS — lógica do aplicativo
   Persistência local (localStorage) até o banco de dados
   definitivo ser conectado.
   ========================================================= */

const STORAGE_KEY = 'os_semanal_state_v1';
const ADMIN_PIN = '1234'; // PIN provisório — trocar quando o admin for cadastrado no banco

const WEEKDAY_NAMES = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

/* ---------------- Estado ---------------- */

function defaultState(){
  return {
    sectorName: 'CABEÇOTES',
    clients: [
      { id: uid(), name: 'João Mecânica', color: '#d98a3d' },
      { id: uid(), name: 'Oficina Silva', color: '#4fa8a0' }
    ],
    services: [],
    finance: { salary: 0, entradas: [], saidas: [] },
    overtime: []
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if(!parsed.clients || !parsed.services) return defaultState();
    parsed.finance = parsed.finance || {};
    parsed.finance.salary = Number(parsed.finance.salary) || 0;
    parsed.finance.entradas = parsed.finance.entradas || [];
    parsed.finance.saidas = parsed.finance.saidas || [];
    parsed.overtime = parsed.overtime || [];
    return parsed;
  }catch(e){
    console.error('Falha ao carregar estado, usando padrão.', e);
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* View state (não persistido) */
let viewYear, viewMonth;         // mês exibido no calendário
let currentView = 'calendar';    // 'calendar' | 'day'
let selectedDayIso = null;       // dia aberto na vista de dia
let editingServiceId = null;     // OS aberta no modal de detalhe
let newOSImages = [];            // imagens temporárias da OS sendo criada
let pendingAdminAction = null;   // callback após PIN correto

/* ---------------- Utilidades ---------------- */

function uid(){
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
}

function todayISO(){
  return formatISO(new Date());
}

function formatISO(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function parseISO(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d);
}

function formatDisplayDate(iso){
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

function showToast(msg){
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.classList.add('hidden'), 2200);
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Clientes ---------------- */

function getClient(id){
  return state.clients.find(c => c.id === id);
}

function addClient(name, color){
  const client = { id: uid(), name: name.trim(), color };
  state.clients.push(client);
  saveState();
  return client;
}

function updateClient(id, fields){
  const c = getClient(id);
  if(!c) return;
  Object.assign(c, fields);
  saveState();
}

function deleteClient(id){
  const inUse = state.services.some(s => s.clientId === id);
  if(inUse){
    if(!confirm('Este cliente possui OS lançadas. Remover mesmo assim? As OS ficarão sem cliente vinculado.')) return;
  }
  state.clients = state.clients.filter(c => c.id !== id);
  saveState();
  renderClientsList();
  populateClientSelects();
  renderCurrentView();
}

/* ---------------- Serviços (OS) ---------------- */

function createService(clientId, dateIso, description, status, images){
  const service = {
    id: uid(),
    clientId,
    date: dateIso,
    description: description.trim(),
    images: images.slice(),
    status: status || 'pending',
    createdAt: Date.now()
  };
  state.services.push(service);
  saveState();
  return service;
}

function getService(id){
  return state.services.find(s => s.id === id);
}

function deleteService(id){
  state.services = state.services.filter(s => s.id !== id);
  saveState();
}

function setServiceStatus(id, status){
  const s = getService(id);
  if(!s) return;
  s.status = (s.status === status) ? 'pending' : status;
  saveState();
  renderCurrentView();
}

function servicesForDate(iso){
  return state.services
    .filter(s => s.date === iso)
    .sort((a,b)=> a.createdAt - b.createdAt);
}

/* ---------------- Topbar ---------------- */

function renderSectorName(){
  document.getElementById('sectorName').textContent = state.sectorName;
}

function renderMonthLabel(){
  document.getElementById('monthLabel').textContent = `${MONTH_NAMES[viewMonth]} · ${viewYear}`;
}

/* ---------------- Calendário (aba única do mês) ---------------- */

function renderCalendar(){
  renderMonthLabel();
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDate = new Date(viewYear, viewMonth+1, 0).getDate();
  const leadingBlanks = (firstDay.getDay() + 6) % 7; // 0 = segunda

  for(let i=0;i<leadingBlanks;i++){
    const blank = document.createElement('div');
    blank.className = 'calendar-day empty';
    grid.appendChild(blank);
  }

  const today = todayISO();

  for(let day=1; day<=lastDate; day++){
    const iso = formatISO(new Date(viewYear, viewMonth, day));
    const cell = document.createElement('div');
    cell.className = 'calendar-day' + (iso === today ? ' today' : '');

    const services = servicesForDate(iso);
    const dotsHtml = services.slice(0,5).map(s => {
      const client = getClient(s.clientId);
      const color = client ? client.color : '#888';
      return `<span class="service-dot" style="background:${color}"></span>`;
    }).join('');
    const moreHtml = services.length > 5 ? `<span class="dot-more">+${services.length-5}</span>` : '';

    cell.innerHTML = `
      <span class="day-num">${day}</span>
      <div class="day-dots">${dotsHtml}${moreHtml}</div>
    `;
    cell.addEventListener('click', () => openDayView(iso));
    grid.appendChild(cell);
  }
}

function showCalendarView(){
  currentView = 'calendar';
  selectedDayIso = null;
  document.getElementById('calendarView').classList.remove('hidden');
  document.getElementById('dayView').classList.add('hidden');
  renderCalendar();
  renderServiceDaysList();
}

// Lista (mais recente primeiro) dos dias com OS lançada até hoje; não mostra dias futuros.
function renderServiceDaysList(){
  const container = document.getElementById('serviceDaysList');
  if(!container) return;
  const today = todayISO();
  const dates = Array.from(new Set(state.services.map(s => s.date)))
    .filter(d => d <= today)
    .sort((a,b) => b.localeCompare(a));
  container.innerHTML = '';
  if(!dates.length){
    container.innerHTML = '<p class="empty-day">Nenhum serviço lançado até hoje.</p>';
    return;
  }
  dates.forEach(iso => {
    const services = servicesForDate(iso);
    const d = parseISO(iso);
    const row = document.createElement('div');
    row.className = 'day-list-item' + (iso === today ? ' is-today' : '');
    const dotsHtml = services.slice(0,6).map(sv => {
      const c = getClient(sv.clientId);
      return `<span class="service-dot" style="background:${c ? c.color : '#888'}"></span>`;
    }).join('');
    row.innerHTML = `
      <div class="day-list-date">
        <span class="day-list-daynum">${formatDisplayDate(iso)}</span>
        <span class="day-list-weekday">${WEEKDAY_NAMES[d.getDay()]}${iso === today ? ' · Hoje' : ''}</span>
      </div>
      <div class="day-list-dots">${dotsHtml}</div>
      <span class="day-list-count">${services.length} OS</span>
      <span class="day-list-chevron">›</span>`;
    row.addEventListener('click', () => openDayView(iso));
    container.appendChild(row);
  });
}

/* ---------------- Vista de dia (atalho do calendário) ---------------- */

function openDayView(iso){
  currentView = 'day';
  selectedDayIso = iso;
  document.getElementById('calendarView').classList.add('hidden');
  document.getElementById('dayView').classList.remove('hidden');
  renderDayView();
}

function renderDayView(){
  if(!selectedDayIso) return;
  const date = parseISO(selectedDayIso);
  const isToday = selectedDayIso === todayISO();

  document.getElementById('dayViewTitle').textContent =
    `${WEEKDAY_NAMES[date.getDay()]}, ${formatDisplayDate(selectedDayIso)}`;
  document.getElementById('dayViewSubtitle').textContent =
    isToday ? 'Hoje' : `${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;

  const list = document.getElementById('dayViewList');
  list.innerHTML = '';
  const services = servicesForDate(selectedDayIso);

  if(!services.length){
    const empty = document.createElement('p');
    empty.className = 'empty-day';
    empty.textContent = 'Nenhuma OS lançada para este dia.';
    list.appendChild(empty);
  } else {
    services.forEach(svc => list.appendChild(buildServiceCard(svc)));
  }
}

function renderCurrentView(){
  if(currentView === 'day' && selectedDayIso){
    renderDayView();
  } else {
    renderCalendar();
    renderServiceDaysList();
  }
}

function buildServiceCard(svc){
  const client = getClient(svc.clientId);
  const color = client ? client.color : '#888888';
  const name = client ? client.name : 'Cliente removido';

  const card = document.createElement('div');
  card.className = `service-card status-${svc.status}`;
  card.style.setProperty('--client-color', color);

  card.innerHTML = `
    <div class="service-main">
      <span class="client-name" style="color:${color}">${escapeHtml(name)}</span>
      <span class="service-desc">${escapeHtml(svc.description || 'Sem descrição')}</span>
      <div class="service-meta">${svc.images.length ? '📎 ' + svc.images.length + ' imagem(ns)' : ''}</div>
    </div>
    <div class="service-actions">
      <button class="action-btn done-btn ${svc.status==='done'?'active':''}" title="Marcar como concluído">✓</button>
      <button class="action-btn postpone-btn ${svc.status==='postponed'?'active':''}" title="Marcar como adiado">✕</button>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if(e.target.closest('.service-actions')) return;
    openServiceModal(svc.id);
  });

  card.querySelector('.done-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setServiceStatus(svc.id, 'done');
  });
  card.querySelector('.postpone-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setServiceStatus(svc.id, 'postponed');
  });

  return card;
}

/* ---------------- Selects de cliente (modais) ---------------- */

function populateClientSelects(){
  ['svcClientSelect','newOSClientSelect'].forEach(id => {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if(current) select.value = current;
  });
}

/* ---------------- Modal: Detalhe / edição de OS ---------------- */

function openServiceModal(serviceId){
  editingServiceId = serviceId;
  const svc = getService(serviceId);
  if(!svc) return;

  populateClientSelects();
  document.getElementById('svcClientSelect').value = svc.clientId;
  const client = getClient(svc.clientId);
  document.getElementById('svcClientColor').value = client ? client.color : '#d98a3d';
  document.getElementById('svcDate').value = svc.date;
  document.getElementById('svcDescription').value = svc.description;

  setStatusButtonsUI('serviceModal', svc.status);
  renderSvcImages();

  document.getElementById('serviceModal').classList.remove('hidden');
}

function renderSvcImages(){
  const svc = getService(editingServiceId);
  if(!svc) return;
  renderImagesGrid('svcImagesGrid', svc.images, (idx) => {
    svc.images.splice(idx,1);
    saveState();
    renderSvcImages();
    renderCurrentView();
  });
}

function setStatusButtonsUI(scope, status){
  document.querySelectorAll(`#${scope} .status-btn`).forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.status === status);
  });
}

function getSelectedStatus(scope){
  const btn = document.querySelector(`#${scope} .status-btn.selected`);
  return btn ? btn.dataset.status : 'pending';
}

function renderImagesGrid(gridId, images, onRemove){
  const grid = document.getElementById(gridId);
  grid.innerHTML = '';
  if(!images.length){
    grid.innerHTML = '<p class="images-empty">Nenhuma imagem adicionada.</p>';
    return;
  }
  images.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'image-thumb';
    thumb.innerHTML = `<img src="${src}" alt="Peça"/><button class="remove-image" title="Excluir imagem">&times;</button>`;
    thumb.querySelector('.remove-image').addEventListener('click', () => onRemove(idx));
    grid.appendChild(thumb);
  });
}

function closeServiceModal(){
  document.getElementById('serviceModal').classList.add('hidden');
  editingServiceId = null;
}

function saveServiceModal(){
  const svc = getService(editingServiceId);
  if(!svc) return;

  svc.clientId = document.getElementById('svcClientSelect').value;
  svc.date = document.getElementById('svcDate').value;
  svc.description = document.getElementById('svcDescription').value;
  svc.status = getSelectedStatus('serviceModal');

  const newColor = document.getElementById('svcClientColor').value;
  const client = getClient(svc.clientId);
  if(client) client.color = newColor;

  saveState();
  closeServiceModal();
  goToDate(svc.date);
  showToast('OS salva.');
}

// Navega direto para a vista de dia da data informada (usado após criar/editar/mudar o dia da OS)
function goToDate(dateIso){
  const d = parseISO(dateIso);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  openDayView(dateIso);
}

/* ---------------- Modal: Nova OS ---------------- */

function openNewOSModal(dateIso){
  populateClientSelects();
  document.getElementById('newOSDescription').value = '';
  document.getElementById('newOSDate').value = dateIso;
  setStatusButtonsUI('newOSModal', 'pending');
  newOSImages = [];
  renderNewOSImages();

  const select = document.getElementById('newOSClientSelect');
  const colorInput = document.getElementById('newOSClientColor');
  function syncColor(){
    const client = getClient(select.value);
    colorInput.value = client ? client.color : '#d98a3d';
  }
  syncColor();
  select.onchange = syncColor;

  document.getElementById('newOSModal').classList.remove('hidden');
}

function renderNewOSImages(){
  renderImagesGrid('newOSImagesGrid', newOSImages, (idx) => {
    newOSImages.splice(idx,1);
    renderNewOSImages();
  });
}

function closeNewOSModal(){
  document.getElementById('newOSModal').classList.add('hidden');
  newOSImages = [];
}

function confirmCreateOS(){
  if(!state.clients.length){
    showToast('Cadastre um cliente antes de criar uma OS.');
    closeNewOSModal();
    openClientsModal();
    return;
  }
  const clientId = document.getElementById('newOSClientSelect').value;
  if(!clientId){ showToast('Selecione um cliente.'); return; }
  const dateIso = document.getElementById('newOSDate').value;
  if(!dateIso){
    showToast('Selecione a data do serviço.');
    return;
  }
  const description = document.getElementById('newOSDescription').value;
  const status = getSelectedStatus('newOSModal');

  const newColor = document.getElementById('newOSClientColor').value;
  const client = getClient(clientId);
  if(client) client.color = newColor;

  createService(clientId, dateIso, description, status, newOSImages);
  closeNewOSModal();
  goToDate(dateIso);
  showToast('OS criada.');
}

/* ---------------- Modal: Clientes ---------------- */

function openClientsModal(){
  renderClientsList();
  document.getElementById('clientsModal').classList.remove('hidden');
}

function closeClientsModal(){
  document.getElementById('clientsModal').classList.add('hidden');
}

function renderClientsList(){
  const list = document.getElementById('clientsList');
  list.innerHTML = '';
  if(!state.clients.length){
    list.innerHTML = '<p class="images-empty">Nenhum cliente cadastrado.</p>';
    return;
  }
  state.clients.forEach(client => {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <span class="client-swatch" style="background:${client.color}"></span>
      <input type="text" value="${escapeHtml(client.name)}" />
      <input type="color" class="color-input" value="${client.color}" style="width:34px;height:30px;" />
      <button class="delete-client" title="Excluir cliente">🗑</button>
    `;
    const nameInput = row.querySelector('input[type="text"]');
    const colorInput = row.querySelector('input[type="color"]');
    nameInput.addEventListener('change', () => updateClient(client.id, { name: nameInput.value }));
    colorInput.addEventListener('input', () => {
      row.querySelector('.client-swatch').style.background = colorInput.value;
      updateClient(client.id, { color: colorInput.value });
      renderCurrentView();
    });
    row.querySelector('.delete-client').addEventListener('click', () => deleteClient(client.id));
    list.appendChild(row);
  });
}

/* ---------------- Modal: PIN admin ---------------- */

function requestAdminAccess(action){
  pendingAdminAction = action;
  document.getElementById('pinInput').value = '';
  document.getElementById('pinError').classList.add('hidden');
  document.getElementById('pinModal').classList.remove('hidden');
  setTimeout(()=> document.getElementById('pinInput').focus(), 50);
}

function closePinModal(){
  document.getElementById('pinModal').classList.add('hidden');
  pendingAdminAction = null;
}

function confirmPin(){
  const value = document.getElementById('pinInput').value;
  if(value === ADMIN_PIN){
    const action = pendingAdminAction;
    closePinModal();
    if(action) action();
  } else {
    document.getElementById('pinError').classList.remove('hidden');
  }
}

/* ---------------- Edição do nome do setor ---------------- */

function enableSectorNameEditing(){
  const el = document.getElementById('sectorName');
  el.setAttribute('contenteditable', 'true');
  el.focus();
  try{
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){}

  function finish(){
    el.removeAttribute('contenteditable');
    const newName = el.textContent.trim().toUpperCase() || state.sectorName;
    el.textContent = newName;
    state.sectorName = newName;
    saveState();
    el.removeEventListener('blur', finish);
    el.removeEventListener('keydown', onKey);
  }
  function onKey(e){
    if(e.key === 'Enter'){ e.preventDefault(); el.blur(); }
    if(e.key === 'Escape'){ el.textContent = state.sectorName; el.blur(); }
  }
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', onKey);
}

/* ---------------- Upload de imagens ---------------- */

function readFilesAsDataURLs(fileList, onEach, onDone){
  const files = Array.from(fileList);
  let remaining = files.length;
  if(!remaining){ onDone(); return; }
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      onEach(e.target.result);
      remaining--;
      if(remaining === 0) onDone();
    };
    reader.readAsDataURL(file);
  });
}

function handleServiceImageFiles(fileList){
  const svc = getService(editingServiceId);
  if(!svc) return;
  readFilesAsDataURLs(fileList, (dataUrl) => svc.images.push(dataUrl), () => {
    saveState();
    renderSvcImages();
    renderCurrentView();
  });
}

function handleNewOSImageFiles(fileList){
  readFilesAsDataURLs(fileList, (dataUrl) => newOSImages.push(dataUrl), () => {
    renderNewOSImages();
  });
}

/* ---------------- Navegação de mês (calendário) ---------------- */

function shiftMonth(delta){
  let m = viewMonth + delta;
  let y = viewYear;
  if(m < 0){ m = 11; y -= 1; }
  if(m > 11){ m = 0; y += 1; }
  viewYear = y;
  viewMonth = m;
  showCalendarView();
}

/* ---------------- Inicialização / listeners ---------------- */

function initEventListeners(){
  document.getElementById('sectorName').addEventListener('click', () => {
    requestAdminAccess(enableSectorNameEditing);
  });

  document.getElementById('prevMonthBtn').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => shiftMonth(1));

  document.getElementById('manageClientsBtn').addEventListener('click', openClientsModal);

  document.getElementById('backToCalendarBtn').addEventListener('click', showCalendarView);

  document.getElementById('dayViewCreateBtn').addEventListener('click', () => {
    openNewOSModal(selectedDayIso || todayISO());
  });

  // Fechar modais
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const overlay = e.target.closest('.modal-overlay');
      overlay.classList.add('hidden');
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if(e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Modal de serviço (edição)
  document.getElementById('svcSaveBtn').addEventListener('click', saveServiceModal);
  document.getElementById('svcDeleteBtn').addEventListener('click', () => {
    if(!editingServiceId) return;
    if(confirm('Excluir esta OS definitivamente?')){
      const svc = getService(editingServiceId);
      const dateIso = svc.date;
      deleteService(editingServiceId);
      closeServiceModal();
      goToDate(dateIso);
      showToast('OS excluída.');
    }
  });
  document.querySelectorAll('#serviceModal .status-btn').forEach(btn => {
    btn.addEventListener('click', () => setStatusButtonsUI('serviceModal', btn.dataset.status));
  });
  document.getElementById('svcImageInput').addEventListener('change', (e) => {
    handleServiceImageFiles(e.target.files);
    e.target.value = '';
  });

  // Modal de nova OS
  document.getElementById('newOSCreateBtn').addEventListener('click', confirmCreateOS);
  document.getElementById('newOSAddClientBtn').addEventListener('click', () => {
    closeNewOSModal();
    openClientsModal();
  });
  document.querySelectorAll('#newOSModal .status-btn').forEach(btn => {
    btn.addEventListener('click', () => setStatusButtonsUI('newOSModal', btn.dataset.status));
  });
  document.getElementById('newOSImageInput').addEventListener('change', (e) => {
    handleNewOSImageFiles(e.target.files);
    e.target.value = '';
  });

  // Modal de clientes
  document.getElementById('addClientBtn').addEventListener('click', () => {
    const nameInput = document.getElementById('newClientName');
    const colorInput = document.getElementById('newClientColor');
    if(!nameInput.value.trim()){
      showToast('Informe o nome do cliente.');
      return;
    }
    addClient(nameInput.value, colorInput.value);
    nameInput.value = '';
    renderClientsList();
    populateClientSelects();
    renderCurrentView();
  });

  // Modal PIN
  document.getElementById('pinConfirmBtn').addEventListener('click', confirmPin);
  document.getElementById('pinInput').addEventListener('keydown', (e) => {
    if(e.key === 'Enter') confirmPin();
  });
}

function init(){
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  renderSectorName();
  populateClientSelects();
  initEventListeners();
  showCalendarView();
}

document.addEventListener('DOMContentLoaded', init);
