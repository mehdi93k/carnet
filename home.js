// ===== Accueil : la journée en un coup d'œil =====
//
// Tout vient des vraies données : événements du jour, examens à venir,
// tâches ouvertes, cartes à réviser et notes récentes.

function greeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bonjour';
  if (hour >= 12 && hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function renderHome() {
  const today = todayYmd();
  const events = eventsOnDay(today);
  const urgent = urgentTasks().sort(byDue);
  const due = dueCards().length;

  $('home-date').textContent = formatDay(today);
  $('home-greeting').innerHTML = settings.name
    ? `${greeting()}, <span class="grad-text">${esc(settings.name)}</span>`
    : greeting();

  const parts = [];
  if (events.length) parts.push(`${plural(events.length, 'événement')} aujourd’hui`);
  if (urgent.length) parts.push(`${plural(urgent.length, 'tâche')} à faire`);
  if (due) parts.push(`${plural(due, 'carte')} à réviser`);
  $('home-sub').textContent = parts.length ? parts.join(' · ') : 'Journée libre : c’est le bon moment pour avancer une note ou réviser.';

  renderToday(events, urgent);
  renderExams();
  renderHomeTasks();
  renderHomeReview(due);
  renderRecent();
  refreshIcons();
}

// La frise du jour : événements à leur heure, puis tâches du jour et en retard
function renderToday(events, urgent) {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rows = events.map((event) => {
    const { start, end } = eventMinutes(event);   // agenda.js
    const timed = !event.allDay && isValidTime(event.start);
    const status = timed && minutes >= start && minutes < end ? 'now' : timed && minutes >= end ? 'past' : '';
    const note = noteTitle(event.noteId);
    return `
      <li class="tl-item ${status}" style="--kind:${eventKind(event).color}">
        <span class="tl-time">${timed ? event.start : 'Journée'}</span>
        <span class="tl-bar"></span>
        <button class="tl-main" data-event="${event.id}">
          <span class="tl-title">${esc(event.title)}</span>
          <span class="tl-sub">${eventKind(event).label}${status === 'now' ? ' · en cours' : ''}${note ? ` · ${esc(note)}` : ''}</span>
        </button>
        ${event.noteId ? `<button class="icon-btn small" data-open-note="${event.noteId}" aria-label="Ouvrir la note liée"><i data-lucide="file-text"></i></button>` : '<span></span>'}
      </li>`;
  });

  const tasks = urgent.slice(0, 5).map(taskRowHtml); // tasks.js
  if (!rows.length && !tasks.length) {
    $('today-list').innerHTML = `
      <li class="empty-state">
        <strong>Rien de prévu aujourd’hui</strong>
        Ajoute tes cours et tes contrôles : ils s’afficheront ici chaque matin.
        <button class="pill-btn" data-quick="event"><i data-lucide="calendar-plus"></i>Ajouter un événement</button>
      </li>`;
    return;
  }
  $('today-list').innerHTML = rows.join('') + (tasks.length ? `<li><ul class="task-list compact">${tasks.join('')}</ul></li>` : '');
}

// Les prochains examens, avec un compte à rebours
function renderExams() {
  const exams = upcomingEvents(120).filter((event) => event.kind === 'examen').slice(0, 3);
  if (!exams.length) {
    $('exam-list').innerHTML = `
      <li class="empty-state">Aucun examen prévu. Ajoute tes contrôles dans l’agenda (type « Examen ») pour voir le compte à rebours.</li>`;
    return;
  }
  $('exam-list').innerHTML = exams.map((event) => {
    const days = daysBetween(todayYmd(), event.date);
    const big = days === 0 ? 'Auj.' : days;
    const small = days === 0 ? '' : days === 1 ? 'jour' : 'jours';
    return `
      <li><button class="exam" data-event="${event.id}">
        <span class="countdown"><b>${big}</b>${small ? `<small>${small}</small>` : ''}</span>
        <span class="tl-main">
          <span class="tl-title">${esc(event.title)}</span>
          <span class="tl-sub">${esc(formatDay(event.date, { weekday: 'long', day: 'numeric', month: 'long' }))}${event.start && !event.allDay ? ` · ${event.start}` : ''}</span>
        </span>
      </button></li>`;
  }).join('');
}

function renderHomeTasks() {
  const open = openTasks().sort(byDue).slice(0, 5);
  $('home-tasks').innerHTML = open.length
    ? open.map(taskRowHtml).join('')
    : '<li class="empty-state">Aucune tâche en cours. <button class="link-btn" data-quick="task">Ajouter une tâche</button></li>';
}

function renderHomeReview(due) {
  if (!state.cards.length) {
    $('home-review').innerHTML = `
      <div class="empty-state">
        Transforme tes cours en cartes question / réponse, puis révise quelques minutes par jour.
        <button class="pill-btn" data-goto="review"><i data-lucide="layers"></i>Créer des cartes</button>
      </div>`;
    return;
  }
  $('home-review').innerHTML = `
    <div class="review-mini">
      <div>
        <span class="big-num">${due}</span>
        <p class="muted">carte${due > 1 ? 's' : ''} à revoir aujourd’hui</p>
      </div>
      <button class="btn btn-primary" data-quick="review" ${due ? '' : 'disabled'}><i data-lucide="play"></i><span>${due ? 'Réviser' : 'À jour'}</span></button>
    </div>`;
}

// Les notes modifiées récemment
function renderRecent() {
  const recent = [...allNotes()].sort((a, b) => b.note.updated - a.note.updated).slice(0, 6);
  $('recent').innerHTML = recent.map(({ cat, sub, note }) => `
    <li>
      <button class="recent-card glow" data-open="${note.id}" style="--cover:${note.cover || 'transparent'}">
        <span class="recent-path">${esc(cat.name)} / ${esc(sub.name)}</span>
        <span class="recent-title">${esc(note.title || 'Sans titre')}</span>
        <span class="recent-preview">${esc(plainText(note.html).trim().slice(0, 160)) || 'Note vide'}</span>
        <time>${formatDate(note.updated)}</time>
      </button>
    </li>`).join('') || '<li class="empty-list">Aucune note pour l’instant.</li>';
}

// Actions rapides (en haut, et dans les cartes vides)
function runQuick(kind) {
  if (kind === 'note') newNote();
  if (kind === 'event') openEventEditor();
  if (kind === 'task') newTaskPrompt();
  if (kind === 'review') {
    if (dueCards().length) startSession(null);
    else setView('review');
  }
}

$$('[data-page="home"]').forEach((page) => page.addEventListener('click', (event) => {
  const quick = event.target.closest('[data-quick]');
  const ev = event.target.closest('[data-event]');
  const note = event.target.closest('[data-open-note]');
  const recent = event.target.closest('.recent-card[data-open]');
  if (quick) runQuick(quick.dataset.quick);
  else if (note) openNoteAnywhere(note.dataset.openNote);
  else if (ev) openEventEditor(ev.dataset.event);
  else if (recent) openNoteAnywhere(recent.dataset.open);
}));

// L'accueil se met à jour tout seul (l'heure avance, un cours commence…)
setInterval(() => {
  if (view === 'home' && !document.hidden) renderHome();
}, 60000);
