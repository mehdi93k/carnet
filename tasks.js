// ===== Tâches : ce qu'il reste à faire =====
//
// Une tâche : { id, title, due: "2026-11-03" ou "", done, doneAt, noteId, created, updated }
// Les tâches sont rangées par échéance : en retard, aujourd'hui, cette semaine, plus tard, sans date.

let editingTaskId = null;
let showDone = false;

// Une ligne de tâche (utilisée ici, sur l'accueil et dans la vue jour de l'agenda)
function taskRowHtml(task) {
  const today = todayYmd();
  let due = '';
  if (task.due) {
    const kind = !task.done && task.due < today ? 'late' : task.due === today ? 'today' : '';
    due = `<span class="due ${kind}">${esc(relativeDay(task.due))}</span>`;
  }
  const title = noteTitle(task.noteId);
  const note = title ? `<button class="note-chip" data-open="${task.noteId}" title="Ouvrir la note"><i data-lucide="file-text"></i><span>${esc(title)}</span></button>` : '';
  return `
    <li class="task ${task.done ? 'done' : ''}">
      <button class="check" role="checkbox" aria-checked="${task.done}" data-check="${task.id}" aria-label="${task.done ? 'Rouvrir' : 'Terminer'} « ${esc(task.title)} »"><i data-lucide="check"></i></button>
      <button class="task-title" data-task="${task.id}" title="Modifier">${esc(task.title)}</button>
      <span class="task-meta">${due}${note}</span>
    </li>`;
}

// Tâches ouvertes : d'abord celles qui ont une date (la plus proche), puis les autres
const byDue = (a, b) => ((a.due || '9999').localeCompare(b.due || '9999')) || (a.created - b.created);

function renderTasks() {
  const today = todayYmd();
  const weekEnd = ymd(addDays(new Date(), 7));
  const open = openTasks().sort(byDue);
  const done = state.tasks.filter((task) => task.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const groups = [
    { key: 'late', title: 'En retard', items: open.filter((t) => t.due && t.due < today) },
    { key: 'today', title: 'Aujourd’hui', items: open.filter((t) => t.due === today) },
    { key: 'week', title: 'Cette semaine', items: open.filter((t) => t.due > today && t.due <= weekEnd) },
    { key: 'later', title: 'Plus tard', items: open.filter((t) => t.due > weekEnd) },
    { key: 'nodate', title: 'Sans date', items: open.filter((t) => !t.due) },
  ].filter((group) => group.items.length);

  const late = groups.find((g) => g.key === 'late');
  $('tasks-sub').textContent = open.length
    ? `${plural(open.length, 'tâche')} à faire${late ? ` · ${late.items.length} en retard` : ''}`
    : 'Tout est fait. Ajoute la prochaine tâche ci-dessous.';

  let html = groups.map((group) => `
    <section class="task-group ${group.key}">
      <h2 class="section-title">${group.title} <span class="count">${group.items.length}</span></h2>
      <ul class="task-list">${group.items.map(taskRowHtml).join('')}</ul>
    </section>`).join('');

  if (!open.length && !done.length) {
    html = `
      <div class="panel empty-state">
        <strong>Aucune tâche pour l’instant</strong>
        Écris « DM de maths », choisis une date si tu veux, puis « Ajouter ». Les tâches datées apparaissent aussi dans l’agenda.
      </div>`;
  }

  if (done.length) {
    html += `
      <section class="task-group done-group">
        <h2 class="section-title">
          <button class="done-toggle" id="done-toggle" aria-expanded="${showDone}">
            <i data-lucide="${showDone ? 'chevron-down' : 'chevron-right'}"></i>Terminées <span class="count">${done.length}</span>
          </button>
        </h2>
        ${showDone ? `
          <ul class="task-list">${done.slice(0, 30).map(taskRowHtml).join('')}</ul>
          <div class="row-actions"><button class="pill-btn small" id="clear-done">Effacer les tâches terminées</button></div>` : ''}
      </section>`;
  }
  $('task-groups').innerHTML = html;
  refreshIcons();
}

function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  task.updated = Date.now();
  save();
  renderAll();
  if (task.done) toast(`Bravo, « ${task.title} » est faite.`);
}

// Ajoute plusieurs tâches d'un coup (assistant IA). Renvoie le nombre ajouté.
function addTasks(list, noteIdForAll = '') {
  let count = 0;
  list.forEach(({ title, due }) => {
    const clean = String(title || '').trim().slice(0, 200);
    if (!clean) return;
    state.tasks.push({
      id: uid(), title: clean, due: isValidYmd(due) ? due : '', done: false, doneAt: null,
      noteId: noteIdForAll, created: Date.now(), updated: Date.now(),
    });
    count++;
  });
  if (count) save();
  return count;
}

// ----- Ajouter depuis la page -----

$('task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('task-input').value.trim();
  const due = $('task-due').value;
  if (!title) {
    $('task-error').hidden = false;
    $('task-error').textContent = 'Écris d’abord ce qu’il y a à faire.';
    $('task-input').setAttribute('aria-invalid', 'true');
    $('task-input').focus();
    return;
  }
  if (due && !isValidYmd(due)) {
    $('task-error').hidden = false;
    $('task-error').textContent = 'Cette date n’est pas valide.';
    return;
  }
  $('task-error').hidden = true;
  $('task-input').removeAttribute('aria-invalid');
  addTasks([{ title, due }]);
  $('task-input').value = '';
  renderAll();
  burst(event.submitter);
  $('task-input').focus();
});

$('task-input').addEventListener('input', () => {
  $('task-error').hidden = true;
  $('task-input').removeAttribute('aria-invalid');
});

// Clics sur les tâches, où qu'elles soient : cocher, modifier, ouvrir la note liée
document.addEventListener('click', (event) => {
  const check = event.target.closest('[data-check]');
  const edit = event.target.closest('.task [data-task]');
  const note = event.target.closest('.note-chip[data-open]');
  if (check) toggleTask(check.dataset.check);
  else if (edit) openTaskEditor(edit.dataset.task);
  else if (note) openNoteAnywhere(note.dataset.open);

  if (event.target.closest('#done-toggle')) {
    showDone = !showDone;
    renderTasks();
  }
  if (event.target.closest('#clear-done')) clearDone();
});

async function clearDone() {
  const count = state.tasks.filter((t) => t.done).length;
  if (!(await askConfirm(`Effacer ${plural(count, 'tâche')} terminée${count > 1 ? 's' : ''} ?`, 'Effacer'))) return;
  state.tasks = state.tasks.filter((t) => !t.done);
  save();
  renderAll();
}

// ----- Fenêtre de tâche -----

function openTaskEditor(id = null, preset = {}) {
  const existing = id ? state.tasks.find((t) => t.id === id) : null;
  editingTaskId = existing ? existing.id : null;
  const data = existing || { title: '', due: '', noteId: '', ...preset };
  $('task-modal-title').textContent = existing ? 'Modifier la tâche' : 'Nouvelle tâche';
  $('tk-title').value = data.title;
  $('tk-due').value = data.due || '';
  $('tk-note').innerHTML = noteOptionsHtml(data.noteId, 'Aucune');
  $('tk-delete').hidden = !existing;
  $('tk-error').hidden = true;
  $('tk-title').removeAttribute('aria-invalid');
  openModal('task-modal', 'tk-title');
}

// Alt+T ou « Nouvelle tâche » : sur la page Tâches on écrit directement, ailleurs une fenêtre s'ouvre
function newTaskPrompt() {
  if (view === 'tasks') {
    $('task-input').focus();
    return;
  }
  openTaskEditor(null, { noteId: view === 'notes' && noteId ? noteId : '' });
}

$('task-edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('tk-title').value.trim();
  const due = $('tk-due').value;
  const error = !title ? 'Donne un titre à la tâche.' : due && !isValidYmd(due) ? 'Cette date n’est pas valide.' : '';
  $('tk-title').setAttribute('aria-invalid', String(!title));
  $('tk-error').hidden = !error;
  $('tk-error').textContent = error;
  if (error) return;

  const values = { title, due, noteId: $('tk-note').value, updated: Date.now() };
  if (editingTaskId) {
    Object.assign(state.tasks.find((t) => t.id === editingTaskId), values);
  } else {
    state.tasks.push({ id: uid(), done: false, doneAt: null, created: Date.now(), ...values });
  }
  save();
  closeModals();
  renderAll();
  toast(editingTaskId ? 'Tâche modifiée.' : 'Tâche ajoutée.');
});

$('tk-delete').addEventListener('click', async () => {
  const existing = state.tasks.find((t) => t.id === editingTaskId);
  if (!existing) return;
  $('task-modal').hidden = true;
  if (!(await askConfirm(`Supprimer la tâche « ${existing.title} » ?`))) {
    $('task-modal').hidden = false;
    return;
  }
  state.tasks = state.tasks.filter((t) => t.id !== existing.id);
  save();
  closeModals();
  renderAll();
  toast('Tâche supprimée.');
});
