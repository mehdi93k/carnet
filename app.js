// ===== Carnet : cœur de l'application =====
//
// Les données ressemblent à ceci :
// categories = [
//   { id, name, color, open, subs: [
//     { id, name, notes: [ note ] }
//   ] }
// ]
// Une note : { id, title, html, font, updated, cover, attachments, schema }
//   - html : le texte mis en forme (gras, couleurs...)
//   - attachments : la liste des fichiers (les fichiers eux-mêmes sont dans files.js)
//   - schema : les cartes et les liens du schéma (schema.js)
//
// Pour la synchro entre appareils, seules loadState() et save() devront changer.

const STORAGE_KEY = 'carnet-v1';
const ACCENT_KEY = 'carnet-accent';
const DEFAULT_FONT = "'Instrument Sans', Inter, system-ui, sans-serif";

// Couleurs des catégories (un petit point pour les reconnaître)
const CATEGORY_COLORS = ['#1b6e66', '#a86b1c', '#7a5ea8', '#2f6fa3', '#5f8a3e', '#b0505a'];
// Couleurs de couverture d'une note (une bande en haut de l'éditeur)
const COVERS = ['', '#cfe6df', '#f1dfc2', '#e1d9f0', '#d5e3f2', '#f1d3d3'];
// Couleurs d'accent que l'utilisateur peut choisir
const ACCENTS = ['#1b6e66', '#2f5fa8', '#7a4fb0', '#a86b1c', '#b0505a'];

// Raccourcis
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Texte brut d'un morceau de HTML (sans les balises)
function plainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent;
}

// Les liens [[Titre]] et les tags #mot d'une note
const linkTitles = (note) => [...plainText(note.html).matchAll(/\[\[([^\]\n]+?)\]\]/g)].map((m) => m[1].trim());
const tagsOf = (note) => [...new Set(
  [...plainText(note.html).matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase())
)];
const sameTitle = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

// Crée une note vide (ou avec un titre et un contenu)
function makeNote(title = '', html = '') {
  return {
    id: uid(), title, html, font: DEFAULT_FONT, updated: Date.now(), cover: '',
    attachments: [], schema: { cards: [], links: [] },
  };
}

// ----- Données -----

function defaultState() {
  return {
    categories: [
      {
        id: uid(), name: 'Cours', color: CATEGORY_COLORS[0], open: true,
        subs: [
          { id: uid(), name: 'Maths', notes: [
            { ...makeNote('Bienvenue dans Carnet',
              '<p>Tape <b>[[Idées]]</b> pour relier une note, ajoute un <b>#tag</b>, ou appuie sur <b>Dicter</b>.</p>'),
              cover: COVERS[1] },
          ] },
          { id: uid(), name: 'Physique-chimie', notes: [] },
        ],
      },
      { id: uid(), name: 'Personnel', color: CATEGORY_COLORS[1], open: true,
        subs: [{ id: uid(), name: 'Idées', notes: [
          { ...makeNote('Idées', '<p>Une idée par ligne.</p>'), cover: COVERS[4] },
        ] }] },
    ],
  };
}

// Ajoute les champs manquants aux notes enregistrées avant cette version
function upgradeNote(note) {
  note.cover = note.cover || '';
  note.attachments = note.attachments || [];
  note.schema = note.schema || { cards: [], links: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : defaultState();
    data.categories.forEach((cat) => cat.subs.forEach((sub) => sub.notes.forEach(upgradeNote)));
    return data;
  } catch (error) {
    console.warn('Lecture impossible, carnet de départ utilisé :', error);
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Sauvegarde impossible :', error);
  }
}

let state = loadState();
let selection = { cat: null, sub: null }; // ce qui est ouvert dans le menu
let noteId = null;                        // la note ouverte
let savedRange = null;                    // le texte sélectionné dans la note
let filterTag = null;                     // tag affiché dans la liste, s'il y en a un
let showGraph = false;                    // le graphe remplace l'éditeur
let activeTab = 'text';                   // volet ouvert : texte, schéma, fichiers, liens

// ----- Lecture des données -----

const findCat = (catId) => state.categories.find((c) => c.id === catId);
const findSub = (catId, subId) => {
  const cat = findCat(catId);
  return cat ? cat.subs.find((s) => s.id === subId) : undefined;
};
const currentSub = () => (selection.cat && selection.sub ? findSub(selection.cat, selection.sub) : null);
const currentNote = () => {
  const sub = currentSub();
  return sub ? sub.notes.find((n) => n.id === noteId) || null : null;
};

// Toutes les notes, avec leur catégorie et leur sous-catégorie
function allNotes() {
  const all = [];
  state.categories.forEach((cat) => cat.subs.forEach((sub) => sub.notes.forEach((note) => all.push({ cat, sub, note }))));
  return all;
}
const findPlace = (id) => allNotes().find((entry) => entry.note.id === id);

// Les notes qui pointent vers celle-ci avec [[Titre]]
function backlinksOf(note) {
  return allNotes().filter(({ note: other }) => other.id !== note.id
    && linkTitles(other).some((title) => sameTitle(title, note.title)));
}

// Date lisible : « 27 oct., 14:32 »
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Relance les icônes Lucide après un changement de l'affichage
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ----- Menu : catégories et sous-catégories -----

function renderTree() {
  $('tree').innerHTML = state.categories.map((cat, index) => {
    const color = cat.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const total = cat.subs.reduce((sum, sub) => sum + sub.notes.length, 0);
    return `
      <li class="cat ${cat.open ? '' : 'collapsed'}">
        <div class="tree-row cat-row" data-row="cat" data-cat="${cat.id}">
          <span class="caret">${cat.open ? '▾' : '▸'}</span>
          <span class="dot" style="background:${color}"></span>
          <span class="name cat-name">${esc(cat.name)}</span>
          <span class="count">${total}</span>
          <span class="tools">
            <button data-action="add-sub">+ Sous</button>
            <button data-action="rename-cat">Renommer</button>
            <button data-action="delete-cat">Supprimer</button>
          </span>
        </div>
        <ul class="subs">
          ${cat.subs.map((sub) => `
            <li class="tree-row sub-row ${selection.sub === sub.id && !filterTag ? 'active' : ''}"
                data-row="sub" data-cat="${cat.id}" data-sub="${sub.id}">
              <span class="name">${esc(sub.name)}</span>
              <span class="count">${sub.notes.length}</span>
              <span class="tools">
                <button data-action="rename-sub">Renommer</button>
                <button data-action="delete-sub">Supprimer</button>
              </span>
            </li>`).join('')}
        </ul>
      </li>`;
  }).join('');
}

// Les tags de toutes les notes, avec leur nombre d'utilisations
function renderTags() {
  const counts = new Map();
  allNotes().forEach(({ note }) => tagsOf(note).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const tags = [...counts].sort((a, b) => b[1] - a[1]);
  $('tags').innerHTML = tags.length
    ? tags.map(([tag, n]) => `
        <li><button class="tag-btn ${filterTag === tag ? 'active' : ''}" data-tag="${esc(tag)}">
          <span>#${esc(tag)}</span><span class="count">${n}</span></button></li>`).join('')
    : '<li class="hint-line">Écris #mot dans une note pour créer un tag.</li>';
}

// ----- Liste des notes -----

// Affiche une liste de cartes : { note, place } où place est le texte « Catégorie · Sous-catégorie »
function renderCards(items, emptyText) {
  if (items.length === 0) {
    $('note-list').innerHTML = `<li class="empty-list">${emptyText}</li>`;
    return;
  }
  $('note-list').innerHTML = items.map(({ note, place }) => `
    <li class="note-card ${note.id === noteId ? 'active' : ''}" data-note="${note.id}" style="--cover:${note.cover || 'transparent'}">
      <h3>${esc(note.title || 'Sans titre')}</h3>
      <p>${esc(plainText(note.html).trim().slice(0, 140)) || 'Note vide'}</p>
      <div class="card-foot">
        <time datetime="${new Date(note.updated).toISOString()}">${formatDate(note.updated)}</time>
        ${place ? `<span class="place">${esc(place)}</span>` : ''}
      </div>
    </li>`).join('');
}

function renderNotes() {
  const sub = currentSub();
  $('new-note').disabled = !sub;

  // Liste filtrée par tag : toutes les notes qui portent ce tag
  if (filterTag) {
    const matches = allNotes().filter(({ note }) => tagsOf(note).includes(filterTag));
    $('sub-title').textContent = `#${filterTag}`;
    $('sub-count').textContent = `${matches.length} note${matches.length === 1 ? '' : 's'} avec ce tag`;
    renderCards(matches.map(({ cat, sub: s, note }) => ({ note, place: `${cat.name} · ${s.name}` })),
      'Aucune note avec ce tag.');
    return;
  }

  if (!sub) {
    $('sub-title').textContent = 'Mes notes';
    $('sub-count').textContent = 'Choisis une sous-catégorie dans le menu';
    renderCards([], 'Ouvre le menu et choisis une sous-catégorie.');
    return;
  }

  const count = sub.notes.length;
  $('sub-title').textContent = sub.name;
  $('sub-count').textContent = `${findCat(selection.cat).name} · ${count} note${count === 1 ? '' : 's'}`;
  // Les notes modifiées récemment apparaissent en haut
  const sorted = [...sub.notes].sort((a, b) => b.updated - a.updated);
  renderCards(sorted.map((note) => ({ note, place: null })),
    'Pas encore de note ici. Crée la première avec « Nouvelle note ».');
}

// Accueil : les 6 notes les plus récentes, toutes catégories confondues
function renderRecent() {
  const recent = [...allNotes()].sort((a, b) => b.note.updated - a.note.updated).slice(0, 6);
  $('recent').innerHTML = recent.map(({ cat, sub, note }) => `
    <li>
      <button class="recent-card" data-open="${note.id}" style="--cover:${note.cover || 'transparent'}">
        <span class="recent-title">${esc(note.title || 'Sans titre')}</span>
        <span class="recent-path">${esc(cat.name)} · ${esc(sub.name)}</span>
        <span class="recent-preview">${esc(plainText(note.html).trim().slice(0, 160)) || 'Note vide'}</span>
        <time>${formatDate(note.updated)}</time>
      </button>
    </li>`).join('') || '<li class="empty-list">Aucune note pour l’instant. Crée-en une depuis une sous-catégorie.</li>';
}

// Accueil : une carte par catégorie, avec ses sous-catégories cliquables
function renderShelf() {
  $('shelf').innerHTML = state.categories.map((cat, index) => {
    const color = cat.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const total = cat.subs.reduce((sum, sub) => sum + sub.notes.length, 0);
    const subs = cat.subs.map((sub) => `
      <li><button data-cat="${cat.id}" data-sub="${sub.id}"><span>${esc(sub.name)}</span><span class="count">${sub.notes.length}</span></button></li>`).join('');
    return `
      <li class="shelf-card">
        <div class="shelf-head">
          <span class="dot" style="background:${color}"></span>
          <span>${esc(cat.name)}</span>
          <span class="count">${total}</span>
        </div>
        <ul>${subs || '<li class="hint-line">Aucune sous-catégorie</li>'}</ul>
      </li>`;
  }).join('');
}

// ----- Vues : accueil, graphe, note -----

// Affiche la bonne vue dans la zone de droite
function renderEditorVisibility() {
  const note = currentNote();
  const showNote = Boolean(note) && !showGraph;
  const showHome = !showGraph && !note;

  $('graph-view').hidden = !showGraph;
  $('home').hidden = !showHome;
  $('editor-inner').hidden = !showNote;

  // Sur téléphone, l'accueil remplace la liste quand aucune catégorie n'est ouverte
  const homeOnPhone = showHome && !currentSub();
  $('app').classList.toggle('show-editor', showGraph || showNote || homeOnPhone);

  if (showHome) {
    renderRecent();
    renderShelf();
  }
  if (showGraph) renderGraph(); // graph.js
  if (showNote) renderNoteView(note);
}

// Remplit les volets d'une note ouverte (le texte, lui, est rempli par openNote)
function renderNoteView(note) {
  $('editor').style.setProperty('--cover', note.cover || 'transparent');
  renderCovers(note);
  showTab(activeTab);
}

function showTab(tab) {
  activeTab = tab;
  $$('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.pane').forEach((pane) => { pane.hidden = pane.dataset.pane !== tab; });

  if (tab === 'schema') renderBoard();   // schema.js
  if (tab === 'files') renderFiles();    // files.js
  if (tab === 'links') renderLinks();
  refreshIcons();
}

// Les couleurs de couverture proposées sous le titre
function renderCovers(note) {
  $('cover-row').innerHTML = COVERS.map((color) => `
    <button class="cover-dot ${note.cover === color ? 'active' : ''}" data-cover="${color}"
            style="background:${color || 'transparent'}" aria-label="${color ? 'Couleur de couverture' : 'Aucune couleur'}"></button>`).join('');
}

// La ligne sous le titre : où est la note et quand elle a été modifiée
function updateMeta(note) {
  const place = findPlace(note.id);
  $('meta').textContent = place
    ? `${place.cat.name} · ${place.sub.name} · modifiée ${formatDate(note.updated)}`
    : `modifiée ${formatDate(note.updated)}`;
}

// Volet Liens : liens sortants et entrants
function renderLinks() {
  const note = currentNote();
  if (!note) return;

  const titles = [...new Set(linkTitles(note))];
  $('links-out').innerHTML = titles.length ? titles.map((title) => {
    const target = allNotes().find(({ note: other }) => sameTitle(other.title, title));
    return target
      ? `<li><button class="link-item" data-open="${target.note.id}"><i data-lucide="file-text"></i>${esc(title)}</button></li>`
      : `<li class="link-missing"><span>${esc(title)}</span><button class="pill-btn small" data-create="${esc(title)}">Créer la note</button></li>`;
  }).join('') : '<li class="hint-line">Tape [[Titre]] dans une note pour créer un lien.</li>';

  const back = backlinksOf(note);
  $('links-in').innerHTML = back.length ? back.map(({ note: other }) => `
    <li><button class="link-item" data-open="${other.id}"><i data-lucide="file-text"></i>${esc(other.title || 'Sans titre')}</button></li>`).join('')
    : '<li class="hint-line">Aucune note ne pointe vers celle-ci pour l’instant.</li>';
}

// Rendu complet après un changement de structure (catégories, notes, vues)
function renderAll() {
  renderTree();
  renderTags();
  renderNotes();
  renderEditorVisibility();
  refreshIcons();
}

// ----- Actions du menu -----

// ----- Questions à l'utilisateur -----
// prompt() et confirm() ne s'affichent pas dans une page publiée : on utilise
// donc une petite fenêtre intégrée à la page, qui renvoie une réponse (Promise).

let dialogDone = null; // fonction qui termine la question en cours

// Affiche la question, avec ou sans champ de texte, et renvoie la réponse
function openDialog({ message, withInput = false, value = '', okLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    dialogDone = (ok) => resolve(withInput ? (ok && $('dialog-input').value.trim()) || null : ok);
    $('dialog-message').textContent = message;
    $('dialog-input').hidden = !withInput;
    $('dialog-input').value = value;
    $('dialog-ok').textContent = okLabel;
    $('dialog-ok').classList.toggle('danger-btn', danger);
    $('dialog-modal').hidden = false;
    (withInput ? $('dialog-input') : $('dialog-ok')).focus();
  });
}

function finishDialog(ok) {
  $('dialog-modal').hidden = true;
  const done = dialogDone;
  dialogDone = null;
  if (done) done(ok);
}

// Demande un nom : renvoie le nom, ou null si annulé ou vide
const askText = (message, value = '') => openDialog({ message, withInput: true, value, okLabel: 'Valider' });
// Demande une confirmation : renvoie true ou false
const askConfirm = (message, okLabel = 'Supprimer') => openDialog({ message, okLabel, danger: true });

$('dialog-ok').addEventListener('click', () => finishDialog(true));
$('dialog-cancel').addEventListener('click', () => finishDialog(false));
$('dialog-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') finishDialog(true);
});

async function addCategory() {
  const name = await askText('Nom de la nouvelle catégorie ?');
  if (!name) return;
  const color = CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length];
  state.categories.push({ id: uid(), name, color, open: true, subs: [] });
  save();
  renderAll();
}

async function treeAction(action, catId, subId) {
  const cat = findCat(catId);
  if (!cat) return;
  const sub = subId ? findSub(catId, subId) : null;

  if (action === 'add-sub') {
    const name = await askText('Nom de la sous-catégorie ?');
    if (!name) return;
    cat.subs.push({ id: uid(), name, notes: [] });
    cat.open = true;
  }
  if (action === 'rename-cat') {
    const name = await askText('Nouveau nom de la catégorie ?', cat.name);
    if (name) cat.name = name;
  }
  if (action === 'rename-sub' && sub) {
    const name = await askText('Nouveau nom de la sous-catégorie ?', sub.name);
    if (name) sub.name = name;
  }
  if (action === 'delete-cat') {
    if (!(await askConfirm(`Supprimer « ${cat.name} » et toutes ses notes ?`))) return;
    state.categories = state.categories.filter((c) => c.id !== catId);
    if (selection.cat === catId) clearSelection();
  }
  if (action === 'delete-sub' && sub) {
    if (!(await askConfirm(`Supprimer « ${sub.name} » et toutes ses notes ?`))) return;
    cat.subs = cat.subs.filter((s) => s.id !== subId);
    if (selection.sub === subId) clearSelection();
  }

  save();
  renderAll();
}

// Clic sur le menu : plier une catégorie, ou ouvrir une sous-catégorie
$('tree').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  const row = event.target.closest('[data-row]');
  if (!row) return;

  const { cat: catId, sub: subId } = row.dataset;
  if (button) {
    treeAction(button.dataset.action, catId, subId);
    return;
  }
  if (row.dataset.row === 'cat') {
    const cat = findCat(catId);
    cat.open = !cat.open;
    save();
    renderTree();
  } else {
    selectSubcategory(catId, subId);
  }
});

function selectSubcategory(catId, subId) {
  selection = { cat: catId, sub: subId };
  noteId = null;
  filterTag = null;
  showGraph = false;
  closeMenu();
  renderAll();
}

function clearSelection() {
  selection = { cat: null, sub: null };
  noteId = null;
}

// Ouvre une note là où elle se trouve (catégorie et sous-catégorie comprises)
function openNoteAnywhere(id) {
  const place = findPlace(id);
  if (!place) return;
  selection = { cat: place.cat.id, sub: place.sub.id };
  openNote(id);
  closeMenu();
}

// Ouvre une note dans l'éditeur
function openNote(id) {
  noteId = id;
  showGraph = false;
  const note = currentNote();
  if (!note) return;

  $('note-title').value = note.title;
  $('note-body').innerHTML = note.html;
  $('note-body').style.fontFamily = note.font;
  $('font-select').value = note.font;
  updateMeta(note);
  renderAll();
}

function newNote() {
  const sub = currentSub();
  if (!sub) return;
  const note = makeNote();
  sub.notes.push(note);
  save();
  activeTab = 'text';
  openNote(note.id);
  $('note-title').focus(); // on commence par le titre
}

// Crée une note avec ce titre dans la même sous-catégorie que la note courante
function createNoteFromLink(title) {
  const place = findPlace(noteId);
  if (!place) return;
  const note = makeNote(title);
  place.sub.notes.push(note);
  save();
  openNoteAnywhere(note.id);
}

async function deleteNote() {
  const note = currentNote();
  if (!note || !(await askConfirm(`Supprimer la note « ${note.title || 'Sans titre'} » ?`))) return;
  const sub = currentSub();
  sub.notes = sub.notes.filter((n) => n.id !== note.id);
  noteId = null;
  save();
  renderAll();
}

// Clics sur la liste des notes, les cartes récentes, les tags et les vues
$('note-list').addEventListener('click', (event) => {
  const card = event.target.closest('[data-note]');
  if (card) openNoteAnywhere(card.dataset.note);
});

$('recent').addEventListener('click', (event) => {
  const card = event.target.closest('[data-open]');
  if (card) openNoteAnywhere(card.dataset.open);
});

$('shelf').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-sub]');
  if (button) selectSubcategory(button.dataset.cat, button.dataset.sub);
});

$('tags').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  filterTag = filterTag === button.dataset.tag ? null : button.dataset.tag;
  showGraph = false;
  renderAll();
});

$('links-out').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open]');
  const create = event.target.closest('[data-create]');
  if (open) openNoteAnywhere(open.dataset.open);
  if (create) createNoteFromLink(create.dataset.create);
});

$('links-in').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open]');
  if (open) openNoteAnywhere(open.dataset.open);
});

// Navigation latérale : accueil ou graphe
$('sidebar').addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]');
  if (!view) return;
  showGraph = view.dataset.view === 'graph';
  if (!showGraph) noteId = null;
  closeMenu();
  renderAll();
});

$('search-btn').addEventListener('click', openSwitcher);

// ----- Éditeur : texte, titre, mise en forme -----

const body = $('note-body');

// Garde en mémoire le texte sélectionné dans la note
// (cliquer sur un menu déroulant ferait perdre la sélection)
document.addEventListener('selectionchange', () => {
  const selected = window.getSelection();
  if (selected.rangeCount && body.contains(selected.anchorNode)) {
    savedRange = selected.getRangeAt(0).cloneRange();
  }
});

function restoreSelection() {
  body.focus();
  if (!savedRange) return;
  const selected = window.getSelection();
  selected.removeAllRanges();
  selected.addRange(savedRange);
}

// Sauvegarde la note après une modification du texte
function noteChanged() {
  const note = currentNote();
  if (!note) return;
  note.html = body.innerHTML;
  touch(note);
}

// Date de modification, sauvegarde, puis rafraîchissement de la liste
function touch(note) {
  note.updated = Date.now();
  save();
  renderNotes();
  renderTags();
  updateMeta(note);
}

function runCommand(name) {
  restoreSelection();
  document.execCommand(name, false, null);
  noteChanged();
}

// Applique un style CSS (police, taille, couleur) au texte sélectionné.
// Renvoie false si rien n'est sélectionné.
function styleSelection(property, value) {
  restoreSelection();
  const selected = window.getSelection();
  if (!selected.rangeCount || selected.isCollapsed) return false;

  const range = selected.getRangeAt(0);
  const span = document.createElement('span');
  span.style[property] = value;
  span.appendChild(range.extractContents());
  range.insertNode(span);

  // On resélectionne le texte modifié, pour pouvoir enchaîner les réglages
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  selected.removeAllRanges();
  selected.addRange(newRange);

  noteChanged();
  return true;
}

// Les boutons de la barre ne doivent pas voler le focus au texte
$('toolbar').addEventListener('mousedown', (event) => {
  if (event.target.closest('button')) event.preventDefault();
});

$('toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-cmd]');
  if (button) runCommand(button.dataset.cmd);
});

$('font-select').addEventListener('change', (event) => {
  const font = event.target.value;
  if (styleSelection('fontFamily', font)) return;   // du texte est sélectionné
  const note = currentNote();                        // sinon : police de toute la note
  if (!note) return;
  note.font = font;
  body.style.fontFamily = font;
  noteChanged();
});

$('size-select').addEventListener('change', (event) => {
  styleSelection('fontSize', `${event.target.value}px`);
});

$('color-input').addEventListener('input', (event) => {
  styleSelection('color', event.target.value);
});

$('highlight-input').addEventListener('input', (event) => {
  styleSelection('backgroundColor', event.target.value);
});

$('heading-select').addEventListener('change', (event) => {
  restoreSelection();
  document.execCommand('formatBlock', false, event.target.value);
  noteChanged();
  event.target.value = 'p';
});

$('note-title').addEventListener('input', (event) => {
  const note = currentNote();
  if (!note) return;
  note.title = event.target.value;
  touch(note);
});

body.addEventListener('input', noteChanged);

$('cover-row').addEventListener('click', (event) => {
  const dot = event.target.closest('[data-cover]');
  const note = currentNote();
  if (!dot || !note) return;
  note.cover = dot.dataset.cover;
  $('editor').style.setProperty('--cover', note.cover || 'transparent');
  touch(note);
  renderCovers(note);
});

$('delete-note').addEventListener('click', deleteNote);
$('new-note').addEventListener('click', newNote);
$('add-cat').addEventListener('click', addCategory);

// Onglets de la note
$$('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
});

// Retour à la liste (téléphone) et menu (téléphone)
$$('[data-back]').forEach((button) => {
  button.addEventListener('click', () => $('app').classList.remove('show-editor'));
});

// ----- Menu sur téléphone -----

function openMenu() { $('app').classList.add('menu-open'); }
function closeMenu() { $('app').classList.remove('menu-open'); }
$$('[data-open-menu]').forEach((button) => button.addEventListener('click', openMenu));
$('scrim').addEventListener('click', closeMenu);

// ----- Couleur d'accent -----

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  try { localStorage.setItem(ACCENT_KEY, color); } catch (error) { /* pas grave */ }
}

function renderAccents() {
  let current = ACCENTS[0];
  try { current = localStorage.getItem(ACCENT_KEY) || current; } catch (error) { /* pas grave */ }
  applyAccent(current);
  $('accents').innerHTML = ACCENTS.map((color) => `
    <button class="accent-dot ${color === current ? 'active' : ''}" data-accent="${color}"
            style="background:${color}" aria-label="Couleur d'accent ${color}"></button>`).join('');
}

$('accents').addEventListener('click', (event) => {
  const dot = event.target.closest('[data-accent]');
  if (!dot) return;
  applyAccent(dot.dataset.accent);
  renderAccents();
});

// ----- Fenêtres : aller à une note (Ctrl+O), fermeture -----

let switchItems = [];
let switchIndex = 0;

function openSwitcher() {
  $('switcher-modal').hidden = false;
  $('switch-input').value = '';
  switchIndex = 0;
  renderSwitcher();
  $('switch-input').focus();
}

function renderSwitcher() {
  const query = $('switch-input').value.trim().toLowerCase();
  switchItems = allNotes()
    .filter(({ note }) => !query
      || (note.title || '').toLowerCase().includes(query)
      || plainText(note.html).toLowerCase().includes(query))
    .slice(0, 8);
  switchIndex = Math.min(switchIndex, Math.max(0, switchItems.length - 1));
  $('switch-list').innerHTML = switchItems.map(({ cat, sub, note }, i) => `
    <li><button class="switch-item ${i === switchIndex ? 'active' : ''}" data-open="${note.id}">
      <span>${esc(note.title || 'Sans titre')}</span><span class="place">${esc(cat.name)} · ${esc(sub.name)}</span>
    </button></li>`).join('') || '<li class="hint-line">Aucune note trouvée.</li>';
}

$('switch-input').addEventListener('input', () => { switchIndex = 0; renderSwitcher(); });

$('switch-input').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    switchIndex = (switchIndex + step + switchItems.length) % Math.max(1, switchItems.length);
    renderSwitcher();
  }
  if (event.key === 'Enter' && switchItems[switchIndex]) {
    closeModals();
    openNoteAnywhere(switchItems[switchIndex].note.id);
  }
});

$('switch-list').addEventListener('click', (event) => {
  const item = event.target.closest('[data-open]');
  if (!item) return;
  closeModals();
  openNoteAnywhere(item.dataset.open);
});

// Ferme toutes les fenêtres (et coupe la caméra si elle tourne)
function closeModals() {
  if (dialogDone) finishDialog(false); // une question en cours reçoit « non »
  $$('.modal').forEach((modal) => { modal.hidden = true; });
}

$$('[data-close]').forEach((button) => button.addEventListener('click', closeModals));

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openSwitcher();
  }
  if (event.key === 'Escape') closeModals();
});

// ----- Petit message en bas de l'écran -----

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3800);
}

// ----- Démarrage -----

renderAccents();
renderAll();
