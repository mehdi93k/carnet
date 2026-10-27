// ===== Agenda : mois, semaine, jour, et événements liés aux notes =====
//
// Un événement : { id, title, kind, date: "2026-11-03", start: "14:00", end: "15:30",
//                  allDay, reminder (minutes avant, ou ""), noteId, details, created, updated }
// Les heures sont « locales » : un cours à 8 h reste à 8 h, quel que soit le jour de l'année.

const HOUR_START = 7;   // la grille des heures commence à 7 h…
const HOUR_END = 23;    // … et s'arrête à 23 h
const HOUR_H = 52;      // hauteur d'une heure, en pixels

let agendaMode = 'month';   // month, week ou day
let agendaCursor = new Date(); // le jour autour duquel on affiche
let editingEventId = null;  // l'événement ouvert dans la fenêtre, s'il existe
let editingKind = 'cours';

// Début et fin d'un événement, en minutes depuis minuit
function eventMinutes(event) {
  const start = minutesOf(event.start);
  const end = minutesOf(event.end);
  return { start, end: end !== null && end > start ? end : start + 60 };
}

// Le moment où commence un événement (une journée entière compte à 8 h)
function eventStartDate(event) {
  const date = parseYmd(event.date);
  const minutes = event.allDay || !isValidTime(event.start) ? 8 * 60 : minutesOf(event.start);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
}

// ----- Affichage -----

function renderAgenda() {
  $$('#agenda-mode [data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === agendaMode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === agendaMode));
  });

  if (agendaMode === 'month') renderMonth();
  else renderTimeGrid(agendaMode === 'week' ? 7 : 1);

  renderUpcoming();
  $('legend').innerHTML = Object.values(EVENT_KINDS)
    .map((kind) => `<li style="--kind:${kind.color}">${kind.label}</li>`).join('');
  refreshIcons();
}

function renderMonth() {
  const year = agendaCursor.getFullYear();
  const month = agendaCursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const start = startOfWeek(first);
  const today = todayYmd();

  const title = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  $('agenda-title').innerHTML = `<span class="agenda-title-month">${esc(title)}</span>`;
  const monthKey = `${year}-${pad2(month + 1)}`;
  const count = state.events.filter((event) => event.date.startsWith(monthKey)).length;
  $('agenda-sub').textContent = count ? `${plural(count, 'événement')} ce mois-ci` : 'Aucun événement ce mois-ci : clique sur un jour pour en ajouter un.';

  const heads = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => `<div class="dow" role="columnheader">${d}</div>`).join('');
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const key = ymd(date);
    const events = eventsOnDay(key);
    const tasks = state.tasks.filter((task) => task.due === key);
    const items = [
      ...events.map((event) => `
        <button class="chip-ev" data-event="${event.id}" style="--kind:${eventKind(event).color}" title="${esc(eventTimeLabel(event))} · ${esc(event.title)}">
          ${event.allDay || !event.start ? '' : `<span class="t">${event.start}</span>`}<span class="n">${esc(event.title)}</span>
        </button>`),
      ...tasks.map((task) => `
        <button class="chip-ev chip-task ${task.done ? 'done' : ''}" data-task="${task.id}" title="Tâche · ${esc(task.title)}">
          <span class="n">${esc(task.title)}</span>
        </button>`),
    ];
    const shown = items.slice(0, 3).join('');
    const more = items.length > 3 ? `<button class="more-btn" data-dayview="${key}">+${items.length - 3} autre${items.length - 3 > 1 ? 's' : ''}</button>` : '';
    const classes = [
      'day-cell',
      date.getMonth() !== month ? 'other' : '',
      key === today ? 'today' : '',
      date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : '',
    ].join(' ');
    cells.push(`
      <div class="${classes}" data-day="${key}" role="gridcell">
        <button class="day-num" data-dayview="${key}" aria-label="${esc(formatDay(key))}${events.length ? `, ${plural(events.length, 'événement')}` : ''}">${date.getDate()}</button>
        ${shown}${more}
      </div>`);
  }
  $('cal').innerHTML = `<div class="month" role="grid" aria-label="${esc(title)}">${heads}${cells.join('')}</div>`;
}

// Répartit les événements qui se chevauchent en colonnes côte à côte
function layoutDay(events) {
  const items = events.map((event) => ({ event, ...eventMinutes(event) })).sort((a, b) => a.start - b.start || b.end - a.end);
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach((item) => {
      let lane = lanes.findIndex((end) => end <= item.start);
      if (lane < 0) { lane = lanes.length; lanes.push(item.end); } else { lanes[lane] = item.end; }
      item.lane = lane;
    });
    cluster.forEach((item) => { item.lanes = lanes.length; placed.push(item); });
    cluster = [];
  };
  items.forEach((item) => {
    if (cluster.length && item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  });
  if (cluster.length) flush();
  return placed;
}

function renderTimeGrid(dayCount) {
  const first = dayCount === 7 ? startOfWeek(agendaCursor) : agendaCursor;
  const days = Array.from({ length: dayCount }, (_, i) => ymd(addDays(first, i)));
  const today = todayYmd();
  const last = days[days.length - 1];

  if (dayCount === 7) {
    const a = parseYmd(days[0]);
    const b = parseYmd(last);
    const sameMonth = a.getMonth() === b.getMonth();
    const left = a.toLocaleDateString('fr-FR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const right = b.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    $('agenda-title').textContent = `${left} – ${right}`;
  } else {
    $('agenda-title').innerHTML = `<span class="agenda-title-month">${esc(formatDay(days[0]))}</span>`;
  }
  const count = state.events.filter((event) => event.date >= days[0] && event.date <= last).length;
  $('agenda-sub').textContent = count
    ? `${plural(count, 'événement')} ${dayCount === 7 ? 'cette semaine' : 'ce jour-là'}`
    : 'Rien de prévu : clique sur une heure pour ajouter un événement.';

  const heads = days.map((key) => {
    const date = parseYmd(key);
    return `
      <div class="week-head ${key === today ? 'today' : ''}" data-dayview="${key}" role="columnheader">
        <span class="wd">${date.toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
        <span class="wn">${date.getDate()}</span>
      </div>`;
  }).join('');

  const alldays = days.map((key) => {
    const events = eventsOnDay(key).filter((event) => event.allDay || !isValidTime(event.start));
    const tasks = state.tasks.filter((task) => task.due === key);
    return `
      <div class="allday-cell" data-day="${key}">
        ${events.map((event) => `
          <button class="chip-ev" data-event="${event.id}" style="--kind:${eventKind(event).color}"><span class="n">${esc(event.title)}</span></button>`).join('')}
        ${tasks.map((task) => `
          <button class="chip-ev chip-task ${task.done ? 'done' : ''}" data-task="${task.id}"><span class="n">${esc(task.title)}</span></button>`).join('')}
      </div>`;
  }).join('');

  const hours = [];
  for (let h = HOUR_START; h < HOUR_END; h++) hours.push(`<div class="hour-label">${pad2(h)}:00</div>`);

  const gridTop = HOUR_START * 60;
  const gridHeight = (HOUR_END - HOUR_START) * HOUR_H;
  const columns = days.map((key) => {
    const timed = eventsOnDay(key).filter((event) => !event.allDay && isValidTime(event.start));
    const blocks = layoutDay(timed).map(({ event, start, end, lane, lanes }) => {
      const top = Math.max(0, (start - gridTop) / 60 * HOUR_H);
      const height = Math.max(22, Math.min(gridHeight - top, (end - Math.max(start, gridTop)) / 60 * HOUR_H) - 2);
      const width = 100 / lanes;
      return `
        <button class="ev-block" data-event="${event.id}"
                style="--kind:${eventKind(event).color};top:${top}px;height:${height}px;left:calc(${lane * width}% + 3px);right:auto;width:calc(${width}% - 6px)">
          <span class="n">${esc(event.title)}</span><span class="t">${eventTimeLabel(event)}</span>
        </button>`;
    }).join('');
    // Trait rouge de l'heure actuelle
    let nowLine = '';
    if (key === today) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      if (minutes >= gridTop && minutes <= HOUR_END * 60) nowLine = `<div class="now-line" style="top:${(minutes - gridTop) / 60 * HOUR_H}px"></div>`;
    }
    return `<div class="day-col ${key === today ? 'today' : ''}" data-col="${key}" style="height:${gridHeight}px">${blocks}${nowLine}</div>`;
  }).join('');

  // Vue jour : les tâches de ce jour sous la grille
  let dayTasks = '';
  if (dayCount === 1) {
    const tasks = state.tasks.filter((task) => task.due === days[0]);
    dayTasks = `
      <div class="day-tasks">
        <h3>Tâches de ce jour</h3>
        ${tasks.length ? `<ul class="task-list compact">${tasks.map(taskRowHtml).join('')}</ul>` : '<p class="muted">Aucune tâche pour ce jour.</p>'}
      </div>`;
  }

  const scrollBefore = $('cal').querySelector('.week-scroll');
  const keepScroll = scrollBefore ? scrollBefore.scrollTop : null;

  $('cal').innerHTML = `
    <div class="week" style="--days:${dayCount};--hour-h:${HOUR_H}px">
      <div class="week-row"><div class="corner"></div>${heads}</div>
      <div class="week-row"><div class="allday-label">jour</div>${alldays}</div>
      <div class="week-scroll week-row">
        <div class="hours">${hours.join('')}</div>
        ${columns}
      </div>
    </div>
    ${dayTasks}`;

  // On arrive vers 8 h (ou juste avant l'heure actuelle)
  const scroller = $('cal').querySelector('.week-scroll');
  const now = new Date();
  const focusHour = days.includes(today) ? Math.max(HOUR_START, now.getHours() - 1) : 8;
  scroller.scrollTop = keepScroll !== null ? keepScroll : (focusHour - HOUR_START) * HOUR_H;
}

// Les prochains événements, rangés par jour
function renderUpcoming() {
  const events = upcomingEvents(30).slice(0, 14);
  if (!events.length) {
    $('upcoming').innerHTML = `
      <li class="empty-state">
        <strong>Rien de prévu</strong>
        Ajoute tes cours, contrôles et dates limites : ils apparaîtront aussi sur l'accueil.
      </li>`;
    return;
  }
  let lastDay = '';
  $('upcoming').innerHTML = events.map((event) => {
    const header = event.date !== lastDay ? `<li class="up-day">${esc(relativeDay(event.date))}</li>` : '';
    lastDay = event.date;
    return `${header}
      <li><button class="up-item" data-event="${event.id}" style="--kind:${eventKind(event).color}">
        <span class="kdot"></span><span class="n">${esc(event.title)}</span><span class="t">${eventTimeLabel(event)}</span>
      </button></li>`;
  }).join('');
}

// ----- Navigation dans l'agenda -----

function moveAgenda(step) {
  const d = agendaCursor;
  if (agendaMode === 'month') agendaCursor = new Date(d.getFullYear(), d.getMonth() + step, 1);
  else agendaCursor = addDays(d, step * (agendaMode === 'week' ? 7 : 1));
  renderAgenda();
}

function showAgendaDay(key, mode = 'day') {
  agendaCursor = parseYmd(key);
  agendaMode = mode;
  if (view !== 'agenda') setView('agenda');
  else renderAgenda();
}

$('agenda-prev').addEventListener('click', () => moveAgenda(-1));
$('agenda-next').addEventListener('click', () => moveAgenda(1));
$('agenda-today').addEventListener('click', () => { agendaCursor = new Date(); renderAgenda(); });
// « + Événement » : aujourd'hui si on regarde le mois en cours, sinon le jour affiché
$('agenda-add').addEventListener('click', () => {
  const sameMonth = ymd(agendaCursor).slice(0, 7) === todayYmd().slice(0, 7);
  const date = agendaMode === 'month' && sameMonth ? todayYmd() : ymd(agendaCursor);
  openEventEditor(null, { date });
});
$('agenda-mode').addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  // Du mois vers la semaine ou le jour : si c'est le mois en cours, on se place sur aujourd'hui
  if (agendaMode === 'month' && button.dataset.mode !== 'month' && ymd(agendaCursor).slice(0, 7) === todayYmd().slice(0, 7)) {
    agendaCursor = new Date();
  }
  agendaMode = button.dataset.mode;
  renderAgenda();
});

// Flèches gauche/droite du clavier : période précédente ou suivante
document.addEventListener('keydown', (event) => {
  if (view !== 'agenda' || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal:not([hidden])')) return;
  if (event.key === 'ArrowLeft') moveAgenda(-1);
  if (event.key === 'ArrowRight') moveAgenda(1);
});

$('cal').addEventListener('click', (event) => {
  // Les lignes de tâches (vue jour) sont gérées par tasks.js
  if (event.target.closest('.task')) return;
  const ev = event.target.closest('[data-event]');
  const task = event.target.closest('.chip-task');
  const dayView = event.target.closest('[data-dayview]');
  const day = event.target.closest('[data-day]');
  const col = event.target.closest('[data-col]');

  if (ev) { openEventEditor(ev.dataset.event); return; }
  if (task) { openTaskEditor(task.dataset.task); return; }
  if (dayView) { showAgendaDay(dayView.dataset.dayview); return; }
  if (col) {
    // Clic dans la grille : l'heure cliquée, arrondie à la demi-heure
    const rect = col.getBoundingClientRect();
    const minutes = HOUR_START * 60 + Math.floor(((event.clientY - rect.top) / HOUR_H) * 2) * 30;
    const start = Math.min(minutes, (HOUR_END - 1) * 60);
    openEventEditor(null, { date: col.dataset.col, start: `${pad2(Math.floor(start / 60))}:${pad2(start % 60)}` });
    return;
  }
  if (day) openEventEditor(null, { date: day.dataset.day, allDay: Boolean(event.target.closest('.allday-cell')) });
});

$('upcoming').addEventListener('click', (event) => {
  const ev = event.target.closest('[data-event]');
  if (ev) openEventEditor(ev.dataset.event);
});

// Le trait de l'heure actuelle avance toutes les minutes
setInterval(() => {
  if (view === 'agenda' && agendaMode !== 'month' && !document.hidden) renderTimeGrid(agendaMode === 'week' ? 7 : 1);
}, 60000);

// ----- Fenêtre d'événement -----

function renderKindButtons() {
  $('ev-kind').innerHTML = Object.entries(EVENT_KINDS).map(([key, kind]) => `
    <button type="button" class="kind-btn" role="radio" data-kind="${key}" aria-checked="${key === editingKind}" style="--kind:${kind.color}">${kind.label}</button>`).join('');
}

function setFieldError(id, message, field) {
  $(id).hidden = !message;
  $(id).textContent = message || '';
  if (field) $(field).setAttribute('aria-invalid', String(Boolean(message)));
}

// Ouvre la fenêtre : un événement existant (id), ou un nouveau (preset : date, heure, note…)
function openEventEditor(id = null, preset = {}) {
  const existing = id ? state.events.find((event) => event.id === id) : null;
  editingEventId = existing ? existing.id : null;
  const data = existing || {
    title: '', kind: 'cours', date: todayYmd(), start: '', end: '', allDay: false,
    reminder: '', noteId: '', details: '', ...preset,
  };
  if (!existing && preset.start && !preset.end) {
    const end = Math.min(minutesOf(preset.start) + 60, 23 * 60 + 55);
    data.end = `${pad2(Math.floor(end / 60))}:${pad2(end % 60)}`;
  }
  if (!existing && !preset.start && !preset.allDay) {
    data.start = '08:00';
    data.end = '09:00';
  }
  editingKind = EVENT_KINDS[data.kind] ? data.kind : 'cours';

  $('event-modal-title').textContent = existing ? 'Modifier l’événement' : 'Nouvel événement';
  $('ev-title').value = data.title;
  $('ev-date').value = data.date;
  $('ev-allday').checked = Boolean(data.allDay);
  $('ev-start').value = data.start || '';
  $('ev-end').value = data.end || '';
  $('ev-reminder').value = data.reminder === null || data.reminder === undefined ? '' : String(data.reminder);
  $('ev-note').innerHTML = noteOptionsHtml(data.noteId, 'Aucune');
  $('ev-details').value = data.details || '';
  $('ev-delete').hidden = !existing;
  renderKindButtons();
  syncEventForm();
  setFieldError('ev-error', '');
  $('ev-title').removeAttribute('aria-invalid');
  openModal('event-modal', 'ev-title');
}

// Montre ou cache les heures, l'aide du rappel et le bouton « Ouvrir la note »
function syncEventForm() {
  $('ev-times').hidden = $('ev-allday').checked;
  $('ev-reminder-hint').hidden = !$('ev-reminder').value;
  $('ev-open-note').hidden = !$('ev-note').value;
}

$('ev-kind').addEventListener('click', (event) => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  editingKind = button.dataset.kind;
  renderKindButtons();
});
['ev-allday', 'ev-reminder', 'ev-note'].forEach((id) => $(id).addEventListener('change', syncEventForm));

// Heure de début changée : la fin suit (même durée), si elle était avant
$('ev-start').addEventListener('change', () => {
  const start = minutesOf($('ev-start').value);
  const end = minutesOf($('ev-end').value);
  if (start !== null && (end === null || end <= start)) {
    const next = Math.min(start + 60, 23 * 60 + 55);
    $('ev-end').value = `${pad2(Math.floor(next / 60))}:${pad2(next % 60)}`;
  }
});

$('event-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('ev-title').value.trim();
  const date = $('ev-date').value;
  const allDay = $('ev-allday').checked;
  const start = allDay ? '' : $('ev-start').value;
  const end = allDay ? '' : $('ev-end').value;

  // Vérifications, avec un message clair
  let error = '';
  if (!title) error = 'Donne un titre à l’événement.';
  else if (!isValidYmd(date)) error = 'Choisis une date valide.';
  else if (!allDay && !isValidTime(start)) error = 'Indique l’heure de début, ou coche « Toute la journée ».';
  else if (!allDay && end && minutesOf(end) <= minutesOf(start)) error = 'L’heure de fin doit être après l’heure de début.';
  $('ev-title').setAttribute('aria-invalid', String(!title));
  if (error) {
    setFieldError('ev-error', error);
    return;
  }

  const reminder = $('ev-reminder').value;
  const values = {
    title, date, allDay, start, end: allDay ? '' : end,
    kind: editingKind, reminder: reminder === '' ? '' : Number(reminder),
    noteId: $('ev-note').value, details: $('ev-details').value.trim(), updated: Date.now(),
  };

  if (editingEventId) {
    Object.assign(state.events.find((e) => e.id === editingEventId), values);
  } else {
    state.events.push({ id: uid(), created: Date.now(), ...values });
  }
  save();
  closeModals();
  renderAll();
  toast(editingEventId ? 'Événement modifié.' : `Ajouté à l’agenda : ${relativeDay(date)}.`);

  // Un rappel demande l'autorisation d'afficher des notifications (une seule fois)
  if (reminder !== '' && 'Notification' in window && Notification.permission === 'default') {
    await askNotifications();
  }
});

$('ev-delete').addEventListener('click', async () => {
  const existing = state.events.find((e) => e.id === editingEventId);
  if (!existing) return;
  $('event-modal').hidden = true;
  if (!(await askConfirm(`Supprimer « ${existing.title} » de l’agenda ?`))) {
    $('event-modal').hidden = false;
    return;
  }
  state.events = state.events.filter((e) => e.id !== existing.id);
  save();
  closeModals();
  renderAll();
  toast('Événement supprimé.');
});

$('ev-open-note').addEventListener('click', () => {
  const id = $('ev-note').value;
  closeModals();
  if (id) openNoteAnywhere(id);
});

// ----- Depuis une note : créer une échéance -----

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Cherche une date dans un texte : « 15/11 », « 15/11/2026 » ou « 15 novembre »
function findDateIn(text) {
  const now = new Date();
  const build = (d, m, y) => {
    let year = y ? Number(y) : now.getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(year, m - 1, d);
    if (date.getMonth() !== m - 1) return null;
    // Sans année et déjà passé : c'est l'an prochain
    if (!y && ymd(date) < todayYmd()) date.setFullYear(year + 1);
    return ymd(date);
  };
  const numeric = String(text).match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (numeric) return build(Number(numeric[1]), Number(numeric[2]), numeric[3]);
  const words = String(text).toLowerCase().match(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?`));
  if (words) return build(Number(words[1]), MONTHS.indexOf(words[2]) + 1, words[3]);
  return null;
}

function eventFromNote(id) {
  const place = findPlace(id);
  if (!place) return;
  const picked = selectedNoteText().trim();
  const date = findDateIn(picked) || findDateIn(place.note.title) || ymd(addDays(new Date(), 1));
  const title = picked && picked.length <= 80 ? picked : place.note.title || 'Échéance';
  openEventEditor(null, { title, kind: 'limite', date, allDay: true, noteId: id });
}

// ----- Rappels -----
// Une vérification toutes les 30 secondes, tant que Carnet est ouvert.
// Sans serveur de notifications, un rappel ne peut pas sonner quand l'application est fermée.

const NOTIFIED_KEY = 'carnet-rappels';

function readNotified() {
  try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}'); } catch (error) { return {}; }
}

async function askNotifications() {
  if (!('Notification' in window)) {
    toast('Ce navigateur n’affiche pas de notifications : les rappels apparaîtront dans Carnet.');
    return 'unsupported';
  }
  const result = await Notification.requestPermission();
  toast(result === 'granted' ? 'Rappels activés.' : 'Notifications refusées : les rappels apparaîtront seulement dans Carnet.');
  renderNotifyButton();
  return result;
}

function renderNotifyButton() {
  const button = $('notify-btn');
  if (!('Notification' in window)) {
    button.hidden = true;
    return;
  }
  const granted = Notification.permission === 'granted';
  button.disabled = granted || Notification.permission === 'denied';
  button.lastChild.textContent = granted ? 'Rappels autorisés'
    : Notification.permission === 'denied' ? 'Rappels bloqués (réglages du navigateur)' : 'Autoriser les rappels';
}
$('notify-btn').addEventListener('click', askNotifications);

async function showReminder(event) {
  const when = event.allDay || !event.start ? relativeDay(event.date) : `${relativeDay(event.date)} à ${event.start}`;
  const text = `${eventKind(event).label} · ${when}`;
  toast(`Rappel : ${event.title} (${when})`);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body: text, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `carnet-${event.id}` };
  try {
    // Avec l'application installée, la notification passe par le service worker
    const registration = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (registration) await registration.showNotification(event.title, options);
    else new Notification(event.title, options);
  } catch (error) {
    console.warn('Notification impossible :', error);
  }
}

function checkReminders() {
  const now = Date.now();
  const notified = readNotified();
  let changed = false;
  state.events.forEach((event) => {
    if (event.reminder === '' || event.reminder === null || event.reminder === undefined) return;
    const fireAt = eventStartDate(event).getTime() - Number(event.reminder) * 60000;
    const key = `${event.id}|${event.date}|${event.start}|${event.reminder}`;
    // On ne rappelle qu'une fois, et pas plus de 6 heures en retard
    if (now >= fireAt && now - fireAt < 6 * 3600000 && !notified[key]) {
      notified[key] = now;
      changed = true;
      showReminder(event);
    }
  });
  // On oublie les rappels de plus de deux semaines
  Object.keys(notified).forEach((key) => {
    if (now - notified[key] > 14 * 86400000) { delete notified[key]; changed = true; }
  });
  if (changed) {
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified)); } catch (error) { /* pas grave */ }
  }
}

setInterval(checkReminders, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
