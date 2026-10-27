// ===== Révisions : cartes question / réponse, revues au bon moment =====
//
// Une carte : { id, front, back, deck, noteId, box, due, created }
// Méthode des « boîtes de Leitner » : une carte sue monte d'une boîte et revient
// plus tard (1, 3, 7, 14 puis 30 jours) ; une carte ratée retourne dans la boîte 1.

const INTERVALS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 }; // jours avant de revoir une carte, selon sa boîte

let openDeck = null;   // le paquet dont on regarde les cartes
let session = null;    // la séance en cours : { queue, index, revealed, known, again, total }
let editingCardId = null;

const deckOf = (card) => card.deck || 'Général';

function decks() {
  const map = new Map();
  state.cards.forEach((card) => {
    const name = deckOf(card);
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(card);
  });
  return [...map].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
}

// Ajoute des cartes (assistant IA, import). Renvoie le nombre ajouté.
function addCards(list, deck = 'Général', noteIdForAll = '') {
  let count = 0;
  list.forEach(({ front, back }) => {
    const f = String(front || '').trim().slice(0, 500);
    const b = String(back || '').trim().slice(0, 1500);
    if (!f || !b) return;
    const duplicate = state.cards.some((card) => card.front === f && deckOf(card) === deck);
    if (duplicate) return;
    state.cards.push({ id: uid(), front: f, back: b, deck, noteId: noteIdForAll, box: 1, due: todayYmd(), created: Date.now() });
    count++;
  });
  if (count) save();
  return count;
}

// ----- Affichage -----

function renderReview() {
  const due = dueCards().length;
  $('review-sub').textContent = state.cards.length
    ? `${plural(state.cards.length, 'carte')} · ${due ? `${due} à revoir aujourd’hui` : 'rien à revoir aujourd’hui'}`
    : 'Crée tes premières cartes pour réviser en quelques minutes par jour.';

  if (session) renderSession();
  else if (openDeck) renderDeck(openDeck);
  else renderDecks();
  refreshIcons();
}

function renderDecks() {
  const list = decks();
  if (!list.length) {
    $('review-body').innerHTML = `
      <div class="panel empty-state">
        <strong>Aucune carte pour l’instant</strong>
        Trois façons d’en créer : « Nouvelle carte », « Importer de mes notes » (lignes « Question :: Réponse »),
        ou « Générer avec l’IA » à partir d’un cours.
      </div>`;
    return;
  }
  const today = todayYmd();
  $('review-body').innerHTML = `
    <ul class="deck-grid">
      ${list.map(([name, cards]) => {
        const due = cards.filter((c) => !c.due || c.due <= today).length;
        const mastered = cards.filter((c) => c.box >= 3).length;
        const percent = Math.round((mastered / cards.length) * 100);
        return `
          <li class="deck glow">
            <h2 class="deck-name">${esc(name)}</h2>
            <div class="deck-stats">
              <span><b>${cards.length}</b> carte${cards.length > 1 ? 's' : ''}</span>
              <span class="due-n"><b>${due}</b> à revoir</span>
              <span><b>${percent} %</b> maîtrisées</span>
            </div>
            <div class="deck-bar" role="img" aria-label="${percent} % des cartes maîtrisées"><span style="width:${percent}%"></span></div>
            <div class="deck-actions">
              <button class="btn btn-primary" data-study="${esc(name)}" ${due ? '' : 'data-all="1"'}><i data-lucide="play"></i><span>${due ? 'Réviser' : 'Réviser quand même'}</span></button>
              <button class="pill-btn" data-deck="${esc(name)}">Voir les cartes</button>
            </div>
          </li>`;
      }).join('')}
    </ul>`;
}

function renderDeck(name) {
  const cards = state.cards.filter((card) => deckOf(card) === name);
  if (!cards.length) {
    openDeck = null;
    renderDecks();
    return;
  }
  $('review-body').innerHTML = `
    <div class="row-actions">
      <button class="pill-btn" id="deck-back"><i data-lucide="arrow-left"></i>Tous les paquets</button>
      <button class="btn btn-primary" data-study="${esc(name)}" data-all="1"><i data-lucide="play"></i><span>Réviser tout le paquet</span></button>
    </div>
    <h2 class="panel-title">${esc(name)} · ${plural(cards.length, 'carte')}</h2>
    <ul class="card-list">
      ${cards.map((card) => `
        <li class="card-row">
          <p><b>${esc(card.front)}</b></p>
          <p class="back">${esc(card.back)}</p>
          <span class="row-actions">
            <span class="due">${card.due && card.due > todayYmd() ? relativeDay(card.due) : 'à revoir'}</span>
            <button class="icon-btn small" data-edit-card="${card.id}" aria-label="Modifier la carte"><i data-lucide="pencil"></i></button>
          </span>
        </li>`).join('')}
    </ul>`;
}

// ----- Séance de révision -----

function startSession(deckName, all = false) {
  const today = todayYmd();
  const cards = state.cards.filter((card) => (!deckName || deckOf(card) === deckName) && (all || !card.due || card.due <= today));
  if (!cards.length) {
    toast('Aucune carte à revoir pour le moment.');
    return;
  }
  // Ordre mélangé, pour ne pas apprendre la liste par cœur
  const queue = cards.map((card) => card.id).sort(() => Math.random() - 0.5);
  session = { queue, index: 0, revealed: false, known: 0, again: 0, total: queue.length, retried: new Set() };
  if (view !== 'review') setView('review');
  else renderReview();
}

function renderSession() {
  const card = state.cards.find((c) => c.id === session.queue[session.index]);
  if (!card) {
    const total = session.known + session.again;
    $('review-body').innerHTML = `
      <div class="panel session-end">
        <span class="big-num">${session.known}/${total || session.total}</span>
        <strong>Séance terminée</strong>
        <p class="muted">${session.again ? `${plural(session.again, 'carte')} à retravailler : elles reviendront aujourd’hui.` : 'Tout est su. Les cartes reviendront dans quelques jours.'}</p>
        <button class="btn btn-primary" id="session-done">Revenir aux paquets</button>
      </div>`;
    return;
  }
  const done = session.index;
  const percent = Math.round((done / session.queue.length) * 100);
  $('review-body').innerHTML = `
    <div class="session">
      <div class="session-top">
        <button class="icon-btn" id="session-quit" aria-label="Arrêter la séance"><i data-lucide="x"></i></button>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${session.queue.length}" aria-valuenow="${done}"><span style="width:${percent}%"></span></div>
        <span class="muted num">${done + 1}/${session.queue.length}</span>
      </div>
      <div class="flash ${session.revealed ? 'flipped' : ''}" id="flash">
        <div class="flash-inner">
          <div class="flash-face front"><small>${esc(deckOf(card))} · Question</small><p>${esc(card.front)}</p></div>
          <div class="flash-face back"><small>Réponse</small><p>${esc(card.back)}</p></div>
        </div>
      </div>
      <div class="session-actions">
        ${session.revealed ? `
          <button class="pill-btn grade-again" data-grade="again"><kbd>1</kbd>À revoir</button>
          <button class="btn btn-primary" data-grade="known"><kbd>2</kbd>Je savais</button>` : `
          <button class="btn btn-primary" id="reveal"><kbd>Espace</kbd>Voir la réponse</button>`}
      </div>
    </div>`;
}

function grade(known) {
  const card = state.cards.find((c) => c.id === session.queue[session.index]);
  if (!card) return;
  if (known) {
    card.box = Math.min(5, (card.box || 1) + 1);
    card.due = ymd(addDays(new Date(), INTERVALS[card.box]));
    session.known++;
  } else {
    card.box = 1;
    card.due = todayYmd();
    session.again++;
    // Une carte ratée revient une fois à la fin de la séance
    if (!session.retried.has(card.id)) {
      session.retried.add(card.id);
      session.queue.push(card.id);
    }
  }
  save();
  session.index++;
  session.revealed = false;
  renderSidebarLists();
  renderReview();
}

$('review-body').addEventListener('click', (event) => {
  const study = event.target.closest('[data-study]');
  const deck = event.target.closest('[data-deck]');
  const edit = event.target.closest('[data-edit-card]');
  const gradeButton = event.target.closest('[data-grade]');
  if (study) startSession(study.dataset.study, Boolean(study.dataset.all));
  if (deck) { openDeck = deck.dataset.deck; renderReview(); }
  if (edit) openCardEditor(edit.dataset.editCard);
  if (event.target.closest('#deck-back')) { openDeck = null; renderReview(); }
  if (event.target.closest('#reveal') || event.target.closest('#flash')) {
    if (session && !session.revealed) { session.revealed = true; renderReview(); }
  }
  if (gradeButton) grade(gradeButton.dataset.grade === 'known');
  if (event.target.closest('#session-quit') || event.target.closest('#session-done')) {
    session = null;
    renderReview();
  }
});

// Clavier pendant une séance : Espace pour retourner, 1 ou 2 pour répondre
document.addEventListener('keydown', (event) => {
  if (!session || view !== 'review' || document.querySelector('.modal:not([hidden])')) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ((event.key === ' ' || event.key === 'Enter') && !session.revealed) {
    event.preventDefault();
    session.revealed = true;
    renderReview();
  } else if (session.revealed && (event.key === '1' || event.key === '2')) {
    grade(event.key === '2');
  }
});

// ----- Importer les lignes « Question :: Réponse » des notes -----

function importFromNotes() {
  let count = 0;
  allNotes().forEach(({ note }) => {
    const pairs = plainText(note.html).split('\n')
      .map((line) => line.split('::'))
      .filter((parts) => parts.length === 2 && parts[0].trim() && parts[1].trim())
      .map(([front, back]) => ({ front, back }));
    count += addCards(pairs, note.title || 'Sans titre', note.id);
  });
  renderAll();
  toast(count ? `${plural(count, 'carte')} importée${count > 1 ? 's' : ''} de tes notes.` : 'Aucune nouvelle ligne « Question :: Réponse » trouvée dans tes notes.');
}

$('cards-import').addEventListener('click', importFromNotes);
$('cards-ai').addEventListener('click', () => openAiPage('flashcards')); // ai.js
$('card-new').addEventListener('click', () => openCardEditor(null, { deck: openDeck || '' }));

// ----- Fenêtre de carte -----

function openCardEditor(id = null, preset = {}) {
  const existing = id ? state.cards.find((c) => c.id === id) : null;
  editingCardId = existing ? existing.id : null;
  const data = existing || { front: '', back: '', deck: '', ...preset };
  $('card-modal-title').textContent = existing ? 'Modifier la carte' : 'Nouvelle carte';
  $('cd-front').value = data.front;
  $('cd-back').value = data.back;
  $('cd-deck').value = data.deck || '';
  $('deck-names').innerHTML = decks().map(([name]) => `<option value="${esc(name)}">`).join('');
  $('cd-delete').hidden = !existing;
  $('cd-error').hidden = true;
  openModal('card-modal', 'cd-front');
}

$('card-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const front = $('cd-front').value.trim();
  const back = $('cd-back').value.trim();
  const deck = $('cd-deck').value.trim() || 'Général';
  const error = !front ? 'Écris la question.' : !back ? 'Écris la réponse.' : '';
  $('cd-front').setAttribute('aria-invalid', String(!front));
  $('cd-back').setAttribute('aria-invalid', String(Boolean(front) && !back));
  $('cd-error').hidden = !error;
  $('cd-error').textContent = error;
  if (error) return;

  if (editingCardId) {
    Object.assign(state.cards.find((c) => c.id === editingCardId), { front, back, deck });
  } else {
    state.cards.push({ id: uid(), front, back, deck, noteId: view === 'notes' && noteId ? noteId : '', box: 1, due: todayYmd(), created: Date.now() });
  }
  save();
  closeModals();
  renderAll();
  toast(editingCardId ? 'Carte modifiée.' : 'Carte ajoutée : elle est à revoir aujourd’hui.');
});

$('cd-delete').addEventListener('click', async () => {
  const existing = state.cards.find((c) => c.id === editingCardId);
  if (!existing) return;
  $('card-modal').hidden = true;
  if (!(await askConfirm('Supprimer cette carte ?'))) {
    $('card-modal').hidden = false;
    return;
  }
  state.cards = state.cards.filter((c) => c.id !== existing.id);
  save();
  closeModals();
  renderAll();
});
