// ===== Carnet : cœur de l'application =====
//
// Les données ressemblent à ceci :
// categories = [                      (les « dossiers »)
//   { id, name, color, open, subs: [  (les « sous-dossiers »)
//     { id, name, notes: [ note ] }
//   ] }
// ]
// Une note : { id, title, html, font, created, updated, cover, favorite, pinned, attachments, schema }
//   - html : le texte mis en forme (gras, couleurs, titres...)
//   - attachments : la liste des fichiers (les fichiers eux-mêmes sont dans files.js)
//   - schema : les cartes et les liens du schéma (schema.js)
// state.recent garde les dernières notes ouvertes sur cet appareil.
//
// Pour la synchro entre appareils, seules loadState() et save() devront changer.

const STORAGE_KEY = 'carnet-v1';
const SETTINGS_KEY = 'carnet-settings';

// Couleurs des dossiers (un petit point pour les reconnaître)
const CATEGORY_COLORS = ['#a28bf0', '#6ec6e6', '#7fd1b0', '#e6c278', '#ef8a8a', '#e591b2'];
// Couleurs d'une note (un liseré dans la liste)
const COVERS = ['', '#a28bf0', '#6ec6e6', '#7fd1b0', '#e6c278', '#e591b2'];
// Couleurs d'accent proposées dans les paramètres
const ACCENTS = [
  { name: 'Lavande', color: '#a28bf0' },
  { name: 'Cyan', color: '#6ec6e6' },
  { name: 'Menthe', color: '#7fd1b0' },
  { name: 'Ambre', color: '#e6c278' },
  { name: 'Rose', color: '#e591b2' },
];
// Polices de lecture proposées dans les paramètres
const READ_FONTS = {
  serif: "'Newsreader', Georgia, serif",
  sans: "'Inter', system-ui, sans-serif",
};
// Anciennes polices par défaut : on les remplace par la police de lecture choisie
const OLD_DEFAULT_FONTS = ["'Instrument Sans', Inter, system-ui, sans-serif", 'Segoe UI, system-ui, sans-serif'];

// Raccourcis
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const isPhone = () => window.matchMedia('(max-width: 900px)').matches;
const isNarrow = () => window.matchMedia('(max-width: 1280px)').matches;

// Texte brut d'un morceau de HTML (sans les balises).
// Un retour à la ligne est ajouté après chaque bloc, sinon « #cours » collé
// à la ligne suivante donnerait un faux tag « #coursfin ».
function plainText(html) {
  const div = document.createElement('div');
  div.innerHTML = String(html).replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>|<br\s*\/?>/gi, '$&\n');
  return div.textContent;
}

// Les liens [[Titre]] et les tags #mot d'une note
const linkTitles = (note) => [...plainText(note.html).matchAll(/\[\[([^\]\n]+?)\]\]/g)].map((m) => m[1].trim());
const tagsOf = (note) => [...new Set(
  [...plainText(note.html).matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase())
)];
const sameTitle = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const wordCount = (note) => (plainText(note.html).match(/[\p{L}\p{N}'’-]+/gu) || []).length;

// Crée une note vide (ou avec un titre et un contenu)
function makeNote(title = '', html = '') {
  const now = Date.now();
  return {
    id: uid(), title, html, font: '', created: now, updated: now, cover: '',
    favorite: false, pinned: false, attachments: [], schema: { cards: [], links: [] },
  };
}

// ----- Données -----

function defaultState() {
  const welcome = {
    ...makeNote('Bienvenue dans Carnet', [
      '<p>Carnet est ton espace de notes. Quelques raccourcis pour commencer :</p>',
      '<ul><li>Tape <b>#</b> puis espace pour un titre, <b>-</b> pour une liste, <b>&gt;</b> pour une citation.</li>',
      '<li>Écris <b>[[Idées]]</b> pour relier une autre note, puis Ctrl+clic dessus pour l’ouvrir. Le lien apparaît aussi dans les détails, à droite.</li>',
      '<li>Ajoute un tag comme <b>#cours</b> pour retrouver tes notes par thème.</li>',
      '<li>Clic droit sur une note pour la mettre en favori, l’épingler ou la dupliquer.</li></ul>',
      '<blockquote>Une idée notée est une idée qui ne se perd pas.</blockquote>',
    ].join('')),
    cover: COVERS[1],
    pinned: true,
  };
  return {
    recent: [],
    categories: [
      {
        id: uid(), name: 'Cours', color: CATEGORY_COLORS[0], open: true,
        subs: [
          { id: uid(), name: 'Maths', notes: [welcome] },
          { id: uid(), name: 'Physique-chimie', notes: [] },
        ],
      },
      {
        id: uid(), name: 'Personnel', color: CATEGORY_COLORS[3], open: true,
        subs: [{ id: uid(), name: 'Idées', notes: [
          { ...makeNote('Idées', '<p>Une idée par ligne. #projets</p>'), cover: COVERS[2], favorite: true },
        ] }],
      },
    ],
  };
}

// Ajoute les champs manquants aux notes enregistrées avec une ancienne version
function upgradeNote(note) {
  note.cover = note.cover || '';
  note.attachments = note.attachments || [];
  note.schema = note.schema || { cards: [], links: [] };
  note.created = note.created || note.updated || Date.now();
  note.favorite = Boolean(note.favorite);
  note.pinned = Boolean(note.pinned);
  if (!note.font || OLD_DEFAULT_FONTS.includes(note.font)) note.font = '';
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : defaultState();
    data.recent = Array.isArray(data.recent) ? data.recent : [];
    data.categories.forEach((cat) => cat.subs.forEach((sub) => sub.notes.forEach(upgradeNote)));
    return data;
  } catch (error) {
    console.warn('Lecture impossible, carnet de départ utilisé :', error);
    return defaultState();
  }
}

// Sauvegarde, et indicateur « Enregistrement… » puis « Enregistré » en haut
let saveTimer = null;
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Sauvegarde impossible :', error);
    showSaveState('error');
    return;
  }
  showSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => showSaveState('saved'), 450);
}

function showSaveState(kind) {
  const box = $('save-state');
  if (!box) return;
  box.classList.toggle('saving', kind === 'saving');
  $('save-text').textContent = { saving: 'Enregistrement…', error: 'Non enregistré', saved: 'Enregistré' }[kind];
}

// ----- Paramètres (enregistrés sur cet appareil) -----

function loadSettings() {
  const defaults = { accent: ACCENTS[0].color, readFont: 'serif', readSize: '18', sidebar: true, inspector: !isNarrow() };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (error) {
    return defaults;
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { /* pas grave */ }
}

// Applique les paramètres : couleur d'accent, police et taille de lecture, panneaux
function applySettings() {
  const root = document.documentElement.style;
  root.setProperty('--accent', settings.accent);
  root.setProperty('--read', READ_FONTS[settings.readFont] || READ_FONTS.serif);
  root.setProperty('--read-size', `${settings.readSize}px`);
  $('app').classList.toggle('sb-off', !settings.sidebar);
  $('sheet').classList.toggle('ins-on', settings.inspector);
  $('read-font').value = settings.readFont;
  $('read-size').value = settings.readSize;
}

let state = loadState();
let settings = loadSettings();
let selection = { cat: null, sub: null }; // le sous-dossier ouvert
let noteId = null;                        // la note ouverte
let savedRange = null;                    // le texte sélectionné dans la note
let filterTag = null;                     // tag affiché dans la liste, s'il y en a un
let showGraph = false;                    // le graphe remplace l'éditeur
let activeTab = 'text';                   // volet ouvert : texte, schéma, fichiers

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

// Toutes les notes, avec leur dossier et leur sous-dossier
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

// Dates lisibles : « 27 oct., 14:32 » et « 27 octobre 2026 »
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
const formatLong = (timestamp) => new Date(timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// Relance les icônes Lucide après un changement de l'affichage
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ----- Barre latérale -----

// Une note dans une liste du menu (récentes, favoris, épinglées)
function sideItem(note, icon) {
  return `
    <li><button class="side-item ${note.id === noteId && !showGraph ? 'active' : ''}" data-open="${note.id}">
      <i data-lucide="${icon}"></i><span class="label-text">${esc(note.title || 'Sans titre')}</span>
    </button></li>`;
}

function renderSidebarLists() {
  const byId = new Map(allNotes().map(({ note }) => [note.id, note]));

  const recent = state.recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 5);
  $('side-recent').innerHTML = recent.length
    ? recent.map((note) => sideItem(note, 'clock')).join('')
    : '<li class="side-empty">Les notes ouvertes apparaîtront ici.</li>';

  const favorites = allNotes().filter(({ note }) => note.favorite);
  $('fav-list').innerHTML = favorites.length
    ? favorites.map(({ note }) => sideItem(note, 'star')).join('')
    : '<li class="side-empty">Clique sur l’étoile d’une note pour l’ajouter ici.</li>';

  const pinned = allNotes().filter(({ note }) => note.pinned);
  $('pin-list').innerHTML = pinned.length
    ? pinned.map(({ note }) => sideItem(note, 'pin')).join('')
    : '<li class="side-empty">Une note épinglée reste aussi en haut de son dossier.</li>';

  // Vue active dans la navigation
  $$('.nav-item[data-view]').forEach((item) => {
    const active = item.dataset.view === 'graph' ? showGraph : (!showGraph && !currentNote() && !filterTag);
    item.classList.toggle('active', active);
  });
}

function renderTree() {
  $('tree').innerHTML = state.categories.map((cat, index) => {
    const color = cat.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const total = cat.subs.reduce((sum, sub) => sum + sub.notes.length, 0);
    return `
      <li class="cat ${cat.open ? '' : 'collapsed'}">
        <div class="tree-row cat-row" data-row="cat" data-cat="${cat.id}">
          <span class="caret"><i data-lucide="chevron-down"></i></span>
          <span class="dot" style="background:${color}"></span>
          <span class="name cat-name">${esc(cat.name)}</span>
          <span class="count">${total}</span>
          <button class="icon-btn small row-more" data-action="menu" aria-label="Actions du dossier ${esc(cat.name)}"><i data-lucide="more-horizontal"></i></button>
        </div>
        <ul class="subs">
          ${cat.subs.map((sub) => `
            <li class="tree-row sub-row ${selection.sub === sub.id && !filterTag && !showGraph ? 'active' : ''}"
                data-row="sub" data-cat="${cat.id}" data-sub="${sub.id}">
              <span class="name">${esc(sub.name)}</span>
              <span class="count">${sub.notes.length}</span>
              <button class="icon-btn small row-more" data-action="menu" aria-label="Actions du sous-dossier ${esc(sub.name)}"><i data-lucide="more-horizontal"></i></button>
            </li>`).join('')}
        </ul>
      </li>`;
  }).join('') || '<li class="side-empty">Crée ton premier dossier avec le bouton +.</li>';
}

// Les tags de toutes les notes, avec leur nombre d'utilisations
function renderTags() {
  const counts = new Map();
  allNotes().forEach(({ note }) => tagsOf(note).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const tags = [...counts].sort((a, b) => b[1] - a[1]);
  $('tags').innerHTML = tags.length
    ? tags.map(([tag, n]) => `
        <li><button class="tag-btn ${filterTag === tag ? 'active' : ''}" data-tag="${esc(tag)}">
          #${esc(tag)}<span class="count">${n}</span></button></li>`).join('')
    : '<li class="side-empty">Écris #mot dans une note pour créer un tag.</li>';
}

// ----- Liste des notes -----

// Les notes épinglées d'abord, puis les plus récentes
const byPinThenDate = (a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updated - a.updated);

function renderCards(items, emptyText) {
  if (items.length === 0) {
    $('note-list').innerHTML = `<li class="empty-list">${emptyText}</li>`;
    return;
  }
  $('note-list').innerHTML = items.map(({ note, place }) => `
    <li class="note-card ${note.id === noteId ? 'active' : ''}" data-note="${note.id}" style="--cover:${note.cover || 'transparent'}">
      <div class="card-top">
        <h3>${esc(note.title || 'Sans titre')}</h3>
        ${note.pinned ? '<span class="badge-icon" title="Épinglée"><i data-lucide="pin"></i></span>' : ''}
        ${note.favorite ? '<span class="badge-icon" title="Favori"><i data-lucide="star"></i></span>' : ''}
      </div>
      <p>${esc(plainText(note.html).trim().slice(0, 140)) || 'Note vide'}</p>
      <div class="card-foot">
        <time datetime="${new Date(note.updated).toISOString()}">${formatDate(note.updated)}</time>
        ${place ? `<span class="place">${esc(place)}</span>` : ''}
      </div>
    </li>`).join('');
}

function renderNotes() {
  const sub = currentSub();

  // Liste filtrée par tag : toutes les notes qui portent ce tag
  if (filterTag) {
    const matches = allNotes().filter(({ note }) => tagsOf(note).includes(filterTag));
    $('sub-title').textContent = `#${filterTag}`;
    $('sub-count').textContent = `${matches.length} note${matches.length === 1 ? '' : 's'} avec ce tag`;
    renderCards(matches.sort((a, b) => byPinThenDate(a.note, b.note))
      .map(({ cat, sub: s, note }) => ({ note, place: `${cat.name} / ${s.name}` })), 'Aucune note avec ce tag.');
    return;
  }

  if (!sub) {
    const total = allNotes().length;
    $('sub-title').textContent = 'Toutes les notes';
    $('sub-count').textContent = `${total} note${total === 1 ? '' : 's'}`;
    renderCards(allNotes().sort((a, b) => byPinThenDate(a.note, b.note)).slice(0, 40)
      .map(({ cat, sub: s, note }) => ({ note, place: `${cat.name} / ${s.name}` })),
    'Aucune note pour l’instant. Crée un dossier dans le menu, puis une note.');
    return;
  }

  const count = sub.notes.length;
  $('sub-title').textContent = sub.name;
  $('sub-count').textContent = `${findCat(selection.cat).name} · ${count} note${count === 1 ? '' : 's'}`;
  renderCards([...sub.notes].sort(byPinThenDate).map((note) => ({ note, place: null })),
    'Ce dossier est vide.<br>Crée la première note avec le bouton en haut.');
}

// ----- Accueil -----

function renderRecent() {
  const recent = [...allNotes()].sort((a, b) => b.note.updated - a.note.updated).slice(0, 6);
  $('recent').innerHTML = recent.map(({ cat, sub, note }) => `
    <li>
      <button class="recent-card" data-open="${note.id}" style="--cover:${note.cover || 'transparent'}">
        <span class="recent-path">${esc(cat.name)} / ${esc(sub.name)}</span>
        <span class="recent-title">${esc(note.title || 'Sans titre')}</span>
        <span class="recent-preview">${esc(plainText(note.html).trim().slice(0, 160)) || 'Note vide'}</span>
        <time>${formatDate(note.updated)}</time>
      </button>
    </li>`).join('') || '<li class="empty-list">Aucune note pour l’instant.</li>';

  const notes = allNotes();
  const links = notes.reduce((sum, { note }) => sum + linkTitles(note).length, 0);
  $('home-sub').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'} · ${state.categories.length} dossier${state.categories.length === 1 ? '' : 's'} · ${links} lien${links === 1 ? '' : 's'} entre notes`;
}

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
        <ul>${subs || '<li class="side-empty">Aucun sous-dossier</li>'}</ul>
      </li>`;
  }).join('');
}

// ----- Barre supérieure et panneau de détails -----

function renderCrumbs() {
  const note = currentNote();
  const sub = currentSub();
  const sep = '<span class="sep">/</span>';
  let html;
  if (showGraph) {
    html = '<span class="crumb current">Graphe</span>';
  } else if (sub) {
    const cat = findCat(selection.cat);
    html = `<span class="crumb">${esc(cat.name)}</span>${sep}`
      + `<button class="crumb ${note ? '' : 'current'}" data-crumb-sub="${sub.id}" data-cat="${cat.id}">${esc(sub.name)}</button>`
      + (note ? `${sep}<span class="crumb current">${esc(note.title || 'Sans titre')}</span>` : '');
  } else {
    html = `<span class="crumb current">${filterTag ? `#${esc(filterTag)}` : 'Accueil'}</span>`;
  }
  $('crumbs').innerHTML = html;

  // Les actions de note n'apparaissent que si une note est ouverte
  $('note-actions').hidden = !note || showGraph;
  if (note) {
    $('fav-btn').classList.toggle('on', note.favorite);
    $('fav-btn').setAttribute('aria-pressed', String(note.favorite));
    $('pin-btn').classList.toggle('on', note.pinned);
    $('pin-btn').setAttribute('aria-pressed', String(note.pinned));
  }
}

function renderInspector() {
  const note = showGraph ? null : currentNote();
  $('insp-body').hidden = !note;
  $('insp-empty').hidden = Boolean(note);
  if (!note) return;

  const place = findPlace(note.id);
  const words = wordCount(note);
  const rows = [
    ['Dossier', place ? `${place.cat.name} / ${place.sub.name}` : '—'],
    ['Créée', formatLong(note.created)],
    ['Modifiée', formatDate(note.updated)],
    ['Mots', words.toLocaleString('fr-FR')],
    ['Lecture', words ? `${Math.max(1, Math.round(words / 230))} min` : '—'],
    ['Fichiers', String(note.attachments.length)],
    ['Cartes du schéma', String(note.schema.cards.length)],
  ];
  $('props').innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd title="${esc(value)}">${esc(value)}</dd>`).join('');

  const tags = tagsOf(note);
  $('note-tags').innerHTML = tags.length
    ? tags.map((tag) => `<li><button class="tag-btn ${filterTag === tag ? 'active' : ''}" data-tag="${esc(tag)}">#${esc(tag)}</button></li>`).join('')
    : '<li class="side-empty">Aucun tag. Écris #mot dans la note.</li>';

  renderLinks();
}

// Liens sortants et entrants de la note ouverte
function renderLinks() {
  const note = currentNote();
  if (!note) return;

  const titles = [...new Set(linkTitles(note))];
  $('links-out').innerHTML = titles.length ? titles.map((title) => {
    const target = allNotes().find(({ note: other }) => sameTitle(other.title, title));
    return target
      ? `<li><button class="link-item" data-open="${target.note.id}"><i data-lucide="arrow-up-right"></i><span>${esc(title)}</span></button></li>`
      : `<li class="link-missing"><span>${esc(title)}</span><button class="pill-btn small" data-create="${esc(title)}">Créer</button></li>`;
  }).join('') : '<li class="side-empty">Tape [[Titre]] pour relier une note.</li>';

  const back = backlinksOf(note);
  $('links-in').innerHTML = back.length ? back.map(({ note: other }) => `
    <li><button class="link-item" data-open="${other.id}"><i data-lucide="corner-down-right"></i><span>${esc(other.title || 'Sans titre')}</span></button></li>`).join('')
    : '<li class="side-empty">Aucune note ne renvoie ici pour l’instant.</li>';
}

// ----- Vues : accueil, graphe, note -----

function renderEditorVisibility() {
  const note = currentNote();
  const showNote = Boolean(note) && !showGraph;
  const showHome = !showGraph && !note;

  $('graph-view').hidden = !showGraph;
  $('home').hidden = !showHome;
  $('editor-inner').hidden = !showNote;
  // Le panneau de détails ne prend de la place que si une note est ouverte
  $('sheet').classList.toggle('has-note', showNote);
  $('inspector-toggle').hidden = !showNote;

  // Sur téléphone, l'accueil remplace la liste quand aucun dossier n'est ouvert
  const homeOnPhone = showHome && !currentSub() && !filterTag;
  $('app').classList.toggle('show-editor', showGraph || showNote || homeOnPhone);

  if (showHome) {
    renderRecent();
    renderShelf();
  }
  if (showGraph) renderGraph(); // graph.js
  if (showNote) renderNoteView(note);
}

function renderNoteView(note) {
  renderCovers(note);
  showTab(activeTab);
}

function showTab(tab) {
  activeTab = ['text', 'schema', 'files'].includes(tab) ? tab : 'text';
  $$('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.pane').forEach((pane) => { pane.hidden = pane.dataset.pane !== activeTab; });

  if (activeTab === 'schema') renderBoard(); // schema.js
  if (activeTab === 'files') renderFiles();  // files.js
  refreshIcons();
}

function renderCovers(note) {
  $('cover-row').innerHTML = COVERS.map((color) => `
    <button class="cover-dot ${note.cover === color ? 'active' : ''}" data-cover="${color}"
            style="background:${color || 'transparent'}" title="${color ? 'Couleur de la note' : 'Aucune couleur'}"
            aria-label="${color ? 'Couleur de la note' : 'Aucune couleur'}"></button>`).join('');
}

// La ligne sous le titre : date, nombre de mots, tags
function updateMeta(note) {
  const words = wordCount(note);
  const tags = tagsOf(note).map((tag) => `<span class="tag-inline">#${esc(tag)}</span>`).join(' ');
  $('meta').innerHTML = `Modifiée ${formatDate(note.updated)} · ${words} mot${words === 1 ? '' : 's'}${tags ? ` · ${tags}` : ''}`;
}

// Rendu complet après un changement de structure (dossiers, notes, vues)
function renderAll() {
  renderTree();
  renderTags();
  renderSidebarLists();
  renderNotes();
  renderEditorVisibility();
  renderCrumbs();
  renderInspector();
  refreshIcons();
}

// ----- Questions à l'utilisateur -----
// Une petite fenêtre intégrée à la page remplace prompt() et confirm() :
// elle est plus jolie, et elle marche aussi là où ces fenêtres sont bloquées.

let dialogDone = null; // fonction qui termine la question en cours

function openDialog({ message, withInput = false, value = '', okLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    dialogDone = (ok) => resolve(withInput ? (ok && $('dialog-input').value.trim()) || null : ok);
    $('dialog-message').textContent = message;
    $('dialog-input').hidden = !withInput;
    $('dialog-input').value = value;
    $('dialog-ok').textContent = okLabel;
    $('dialog-ok').classList.toggle('danger-btn', danger);
    $('dialog-ok').classList.toggle('primary', !danger);
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
const askConfirm = (message, okLabel = 'Supprimer') => openDialog({ message, okLabel, danger: okLabel === 'Supprimer' });

$('dialog-ok').addEventListener('click', () => finishDialog(true));
$('dialog-cancel').addEventListener('click', () => finishDialog(false));
$('dialog-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') finishDialog(true);
});

// ----- Menu contextuel -----
// items : [{ label, icon, run, danger, kbd }] ou 'sep' pour un séparateur

function showContextMenu(items, x, y) {
  const menu = $('ctx-menu');
  menu.innerHTML = items.map((item, i) => (item === 'sep'
    ? '<div class="ctx-sep" role="separator"></div>'
    : `<button class="ctx-item ${item.danger ? 'danger' : ''}" role="menuitem" data-index="${i}">
         <i data-lucide="${item.icon}"></i>${esc(item.label)}${item.kbd ? `<kbd>${item.kbd}</kbd>` : ''}
       </button>`)).join('');
  menu.hidden = false;
  refreshIcons();

  // Le menu reste dans l'écran
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

  menu.onclick = (event) => {
    const button = event.target.closest('[data-index]');
    if (!button) return;
    hideContextMenu();
    items[Number(button.dataset.index)].run();
  };
  const first = menu.querySelector('.ctx-item');
  if (first) first.focus();
}

function hideContextMenu() {
  $('ctx-menu').hidden = true;
}

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#ctx-menu')) hideContextMenu();
});

// Les actions possibles sur une note
function noteMenuItems(id) {
  const place = findPlace(id);
  if (!place) return [];
  const { note } = place;
  return [
    { label: 'Ouvrir', icon: 'file-text', run: () => openNoteAnywhere(id) },
    { label: note.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: 'star', run: () => toggleFavorite(note) },
    { label: note.pinned ? 'Désépingler' : 'Épingler', icon: 'pin', run: () => togglePin(note) },
    { label: 'Dupliquer', icon: 'copy', run: () => duplicateNote(id) },
    { label: 'Copier le lien [[…]]', icon: 'link-2', run: () => copyLink(note) },
    { label: 'QR code', icon: 'qr-code', run: () => { openNoteAnywhere(id); if (typeof openQr === 'function') openQr(); } },
    'sep',
    { label: 'Supprimer', icon: 'trash-2', danger: true, run: () => deleteNoteById(id) },
  ];
}

// Les actions possibles sur un dossier ou un sous-dossier
function folderMenuItems(catId, subId) {
  if (subId) {
    return [
      { label: 'Nouvelle note ici', icon: 'square-pen', run: () => { selectSubcategory(catId, subId); newNote(); } },
      { label: 'Renommer', icon: 'pencil', run: () => treeAction('rename-sub', catId, subId) },
      'sep',
      { label: 'Supprimer le sous-dossier', icon: 'trash-2', danger: true, run: () => treeAction('delete-sub', catId, subId) },
    ];
  }
  return [
    { label: 'Nouveau sous-dossier', icon: 'folder-plus', run: () => treeAction('add-sub', catId) },
    { label: 'Renommer', icon: 'pencil', run: () => treeAction('rename-cat', catId) },
    'sep',
    { label: 'Supprimer le dossier', icon: 'trash-2', danger: true, run: () => treeAction('delete-cat', catId) },
  ];
}

// ----- Actions sur les dossiers -----

async function addCategory() {
  const name = await askText('Nom du nouveau dossier ?');
  if (!name) return;
  const color = CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length];
  const cat = { id: uid(), name, color, open: true, subs: [{ id: uid(), name: 'Général', notes: [] }] };
  state.categories.push(cat);
  save();
  selectSubcategory(cat.id, cat.subs[0].id);
}

async function treeAction(action, catId, subId) {
  const cat = findCat(catId);
  if (!cat) return;
  const sub = subId ? findSub(catId, subId) : null;

  if (action === 'add-sub') {
    const name = await askText(`Nom du sous-dossier dans « ${cat.name} » ?`);
    if (!name) return;
    cat.subs.push({ id: uid(), name, notes: [] });
    cat.open = true;
  }
  if (action === 'rename-cat') {
    const name = await askText('Nouveau nom du dossier ?', cat.name);
    if (name) cat.name = name;
  }
  if (action === 'rename-sub' && sub) {
    const name = await askText('Nouveau nom du sous-dossier ?', sub.name);
    if (name) sub.name = name;
  }
  if (action === 'delete-cat') {
    const total = cat.subs.reduce((sum, s) => sum + s.notes.length, 0);
    if (!(await askConfirm(`Supprimer le dossier « ${cat.name} » et ses ${total} note${total === 1 ? '' : 's'} ?`))) return;
    state.categories = state.categories.filter((c) => c.id !== catId);
    if (selection.cat === catId) clearSelection();
  }
  if (action === 'delete-sub' && sub) {
    if (!(await askConfirm(`Supprimer « ${sub.name} » et ses ${sub.notes.length} note${sub.notes.length === 1 ? '' : 's'} ?`))) return;
    cat.subs = cat.subs.filter((s) => s.id !== subId);
    if (selection.sub === subId) clearSelection();
  }

  save();
  renderAll();
}

// Clic sur l'arbre : plier un dossier, ouvrir un sous-dossier, ou ouvrir le menu « … »
$('tree').addEventListener('click', (event) => {
  const row = event.target.closest('[data-row]');
  if (!row) return;
  const { cat: catId, sub: subId } = row.dataset;

  if (event.target.closest('[data-action="menu"]')) {
    const rect = event.target.closest('button').getBoundingClientRect();
    showContextMenu(folderMenuItems(catId, subId), rect.left, rect.bottom + 4);
    return;
  }
  if (row.dataset.row === 'cat') {
    const cat = findCat(catId);
    cat.open = !cat.open;
    save();
    renderTree();
    refreshIcons();
  } else {
    selectSubcategory(catId, subId);
  }
});

$('tree').addEventListener('contextmenu', (event) => {
  const row = event.target.closest('[data-row]');
  if (!row) return;
  event.preventDefault();
  showContextMenu(folderMenuItems(row.dataset.cat, row.dataset.sub), event.clientX, event.clientY);
});

function selectSubcategory(catId, subId) {
  selection = { cat: catId, sub: subId };
  noteId = null;
  filterTag = null;
  showGraph = false;
  closeDrawer();
  renderAll();
}

function clearSelection() {
  selection = { cat: null, sub: null };
  noteId = null;
}

// ----- Actions sur les notes -----

// Ouvre une note là où elle se trouve (dossier et sous-dossier compris)
function openNoteAnywhere(id) {
  const place = findPlace(id);
  if (!place) return;
  selection = { cat: place.cat.id, sub: place.sub.id };
  openNote(id);
  closeDrawer();
}

function openNote(id) {
  noteId = id;
  showGraph = false;
  const note = currentNote();
  if (!note) return;

  // Mémorise la note dans les « récentes »
  state.recent = [id, ...state.recent.filter((other) => other !== id)].slice(0, 8);
  save();

  $('note-title').value = note.title;
  $('note-body').innerHTML = note.html;
  $('note-body').style.fontFamily = note.font || '';
  $('font-select').value = note.font || '';
  updateMeta(note);
  renderAll();
}

// Nouvelle note : dans le sous-dossier ouvert, ou celui de la note ouverte, ou le premier
function newNote() {
  let sub = currentSub();
  if (!sub) {
    let cat = state.categories.find((c) => c.subs.length);
    if (!cat) {
      cat = state.categories[0] || { id: uid(), name: 'Notes', color: CATEGORY_COLORS[0], open: true, subs: [] };
      if (!state.categories.includes(cat)) state.categories.push(cat);
      cat.subs.push({ id: uid(), name: 'Général', notes: [] });
    }
    sub = cat.subs[0];
    selection = { cat: cat.id, sub: sub.id };
  }
  const note = makeNote();
  sub.notes.push(note);
  save();
  activeTab = 'text';
  filterTag = null;
  openNote(note.id);
  $('note-title').focus();
}

// Crée une note avec ce titre, à côté de la note ouverte
function createNoteFromLink(title) {
  const place = findPlace(noteId);
  if (!place) return;
  const note = makeNote(title);
  place.sub.notes.push(note);
  save();
  openNoteAnywhere(note.id);
}

function duplicateNote(id) {
  const place = findPlace(id);
  if (!place) return;
  const copy = {
    ...JSON.parse(JSON.stringify(place.note)),
    id: uid(), title: `${place.note.title || 'Sans titre'} (copie)`,
    created: Date.now(), updated: Date.now(), attachments: [], favorite: false, pinned: false,
  };
  place.sub.notes.push(copy);
  save();
  toast('Note dupliquée (sans ses fichiers).');
  openNoteAnywhere(copy.id);
}

async function copyLink(note) {
  const text = `[[${note.title || 'Sans titre'}]]`;
  try {
    await navigator.clipboard.writeText(text);
    toast(`${text} copié : colle-le dans une autre note.`);
  } catch (error) {
    toast(`Copie impossible ici. Écris ${text} dans une autre note.`);
  }
}

function toggleFavorite(note) {
  note.favorite = !note.favorite;
  save();
  renderAll();
  toast(note.favorite ? 'Ajoutée aux favoris.' : 'Retirée des favoris.');
}

function togglePin(note) {
  note.pinned = !note.pinned;
  save();
  renderAll();
  toast(note.pinned ? 'Note épinglée.' : 'Note désépinglée.');
}

async function deleteNoteById(id) {
  const place = findPlace(id);
  if (!place) return;
  if (!(await askConfirm(`Supprimer la note « ${place.note.title || 'Sans titre'} » ?`))) return;
  place.sub.notes = place.sub.notes.filter((n) => n.id !== id);
  state.recent = state.recent.filter((other) => other !== id);
  if (noteId === id) noteId = null;
  save();
  renderAll();
  toast('Note supprimée.');
}

// Clics sur les listes : menu, liste des notes, accueil, tags, liens
$('note-list').addEventListener('click', (event) => {
  const card = event.target.closest('[data-note]');
  if (card) openNoteAnywhere(card.dataset.note);
});

$('note-list').addEventListener('contextmenu', (event) => {
  const card = event.target.closest('[data-note]');
  if (!card) return;
  event.preventDefault();
  showContextMenu(noteMenuItems(card.dataset.note), event.clientX, event.clientY);
});

$('recent').addEventListener('click', (event) => {
  const card = event.target.closest('[data-open]');
  if (card) openNoteAnywhere(card.dataset.open);
});

$('shelf').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-sub]');
  if (button) selectSubcategory(button.dataset.cat, button.dataset.sub);
});

// Tags : dans le menu et dans les détails
function onTagClick(event) {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  filterTag = filterTag === button.dataset.tag ? null : button.dataset.tag;
  showGraph = false;
  if (isPhone()) {
    noteId = null;
    closeDrawer();
  }
  renderAll();
}
$('tags').addEventListener('click', onTagClick);
$('note-tags').addEventListener('click', onTagClick);

$('inspector').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open]');
  const create = event.target.closest('[data-create]');
  if (open) openNoteAnywhere(open.dataset.open);
  if (create) createNoteFromLink(create.dataset.create);
});

// Barre latérale : vues, listes de notes, clic droit
$('sidebar').addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]');
  const open = event.target.closest('[data-open]');
  if (open) {
    openNoteAnywhere(open.dataset.open);
    return;
  }
  if (!view) return;
  showGraph = view.dataset.view === 'graph';
  noteId = null;
  filterTag = null;
  if (!showGraph) clearSelection();
  closeDrawer();
  renderAll();
});

$('sidebar').addEventListener('contextmenu', (event) => {
  const item = event.target.closest('.side-item[data-open]');
  if (!item) return;
  event.preventDefault();
  showContextMenu(noteMenuItems(item.dataset.open), event.clientX, event.clientY);
});

$('crumbs').addEventListener('click', (event) => {
  const crumb = event.target.closest('[data-crumb-sub]');
  if (crumb) selectSubcategory(crumb.dataset.cat, crumb.dataset.crumbSub);
});

// Barre supérieure
$('fav-btn').addEventListener('click', () => { const note = currentNote(); if (note) toggleFavorite(note); });
$('pin-btn').addEventListener('click', () => { const note = currentNote(); if (note) togglePin(note); });
$('more-btn').addEventListener('click', (event) => {
  const note = currentNote();
  if (!note) return;
  const rect = event.currentTarget.getBoundingClientRect();
  showContextMenu(noteMenuItems(note.id).filter((item) => item === 'sep' || item.label !== 'Ouvrir'), rect.right - 210, rect.bottom + 6);
});

$('search-btn').addEventListener('click', openSwitcher);
$('new-note').addEventListener('click', newNote);
$('sb-new-note').addEventListener('click', newNote);
$('add-cat').addEventListener('click', addCategory);

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

// Date de modification, sauvegarde, puis rafraîchissement de ce qui en dépend
function touch(note) {
  note.updated = Date.now();
  save();
  renderNotes();
  renderTags();
  renderSidebarLists();
  renderCrumbs();
  renderInspector();
  updateMeta(note);
  refreshIcons();
}

function runCommand(name) {
  restoreSelection();
  document.execCommand(name, false, null);
  noteChanged();
}

// Citation ou bloc de code : un second clic revient au texte normal
function toggleBlock(tag) {
  restoreSelection();
  const current = String(document.queryCommandValue('formatBlock')).toLowerCase();
  document.execCommand('formatBlock', false, current === tag ? 'p' : tag);
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
  const command = event.target.closest('button[data-cmd]');
  const block = event.target.closest('button[data-block]');
  if (command) runCommand(command.dataset.cmd);
  if (block) toggleBlock(block.dataset.block);
});

$('font-select').addEventListener('change', (event) => {
  const font = event.target.value;
  if (font && styleSelection('fontFamily', font)) return; // du texte est sélectionné
  const note = currentNote();                               // sinon : police de toute la note
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

// Entrée dans le titre : on passe au texte
$('note-title').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    body.focus();
  }
});

body.addEventListener('input', noteChanged);

// Ctrl+clic (ou Cmd+clic) sur un [[lien]] dans le texte : ouvre la note liée,
// ou la crée si elle n'existe pas encore (comme dans Obsidian)
body.addEventListener('click', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const selected = window.getSelection();
  const node = selected.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent;
  const offset = selected.anchorOffset;
  const start = text.lastIndexOf('[[', offset);
  const end = text.indexOf(']]', offset);
  if (start < 0 || end < 0 || text.slice(start, end).includes(']]')) return;

  const title = text.slice(start + 2, end).trim();
  if (!title) return;
  event.preventDefault();
  const target = allNotes().find(({ note }) => sameTitle(note.title, title));
  if (target) {
    openNoteAnywhere(target.note.id);
  } else {
    createNoteFromLink(title);
    toast(`Note « ${title} » créée.`);
  }
});

// Raccourcis façon Markdown : en début de ligne, « # » + espace donne un titre, etc.
const MARKDOWN_SHORTCUTS = {
  '#': ['formatBlock', 'h1'],
  '##': ['formatBlock', 'h2'],
  '###': ['formatBlock', 'h3'],
  '>': ['formatBlock', 'blockquote'],
  '```': ['formatBlock', 'pre'],
  '-': ['insertUnorderedList'],
  '*': ['insertUnorderedList'],
  '1.': ['insertOrderedList'],
  '---': ['insertHorizontalRule'],
};

body.addEventListener('keydown', (event) => {
  const selected = window.getSelection();
  if (event.isComposing || !selected.rangeCount || !selected.isCollapsed) return;
  const node = selected.anchorNode;

  // Entrée sur une ligne vide d'une citation ou d'un bloc de code : on en sort
  if (event.key === 'Enter' && !event.shiftKey) {
    const element = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
    const block = element && element.closest('blockquote, pre');
    if (block && body.contains(block) && block.textContent.trim() === '') {
      event.preventDefault();
      document.execCommand('formatBlock', false, 'p');
      noteChanged();
    }
    return;
  }

  if (event.key !== ' ' || !node || node.nodeType !== Node.TEXT_NODE) return;
  const before = node.textContent.slice(0, selected.anchorOffset);
  const action = MARKDOWN_SHORTCUTS[before];
  // Seulement si la ligne ne contient que le symbole
  if (!action || node.textContent.trim() !== before) return;

  event.preventDefault();
  // On efface le symbole caractère par caractère : le curseur reste en place
  for (let i = 0; i < before.length; i++) document.execCommand('delete', false, null);
  document.execCommand(action[0], false, action[1] || null);
  noteChanged();
});

$('cover-row').addEventListener('click', (event) => {
  const dot = event.target.closest('[data-cover]');
  const note = currentNote();
  if (!dot || !note) return;
  note.cover = dot.dataset.cover;
  touch(note);
  renderCovers(note);
});

// Onglets de la note
$$('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
});

// Retour à la liste (téléphone)
$$('[data-back]').forEach((button) => {
  button.addEventListener('click', () => $('app').classList.remove('show-editor'));
});

// ----- Panneaux : menu, détails, tiroir sur téléphone -----

function toggleSidebar() {
  if (isPhone()) {
    $('app').classList.toggle('menu-open');
    return;
  }
  settings.sidebar = !settings.sidebar;
  saveSettings();
  applySettings();
}

function toggleInspector() {
  settings.inspector = !settings.inspector;
  saveSettings();
  applySettings();
  renderInspector();
  refreshIcons();
}

function openDrawer() { $('app').classList.add('menu-open'); }
function closeDrawer() { $('app').classList.remove('menu-open'); }

$('sidebar-toggle').addEventListener('click', toggleSidebar);
$('inspector-toggle').addEventListener('click', toggleInspector);
$('inspector-close').addEventListener('click', toggleInspector);
$$('[data-open-menu]').forEach((button) => button.addEventListener('click', openDrawer));
$('scrim').addEventListener('click', closeDrawer);

// ----- Paramètres -----

function renderAccents() {
  $('accents').innerHTML = ACCENTS.map(({ name, color }) => `
    <button class="accent-dot ${color === settings.accent ? 'active' : ''}" data-accent="${color}"
            style="background:${color}" title="${name}" aria-label="Accent ${name}"></button>`).join('');
}

$('settings-btn').addEventListener('click', () => {
  renderAccents();
  $('settings-modal').hidden = false;
  refreshIcons();
});

$('accents').addEventListener('click', (event) => {
  const dot = event.target.closest('[data-accent]');
  if (!dot) return;
  settings.accent = dot.dataset.accent;
  saveSettings();
  applySettings();
  renderAccents();
  if (showGraph) renderGraph();
});

$('read-font').addEventListener('change', (event) => {
  settings.readFont = event.target.value;
  saveSettings();
  applySettings();
});

$('read-size').addEventListener('change', (event) => {
  settings.readSize = event.target.value;
  saveSettings();
  applySettings();
});

// ----- Recherche globale (Ctrl+O) -----

let switchItems = [];
let switchIndex = 0;

function openSwitcher() {
  $('switcher-modal').hidden = false;
  $('switch-input').value = '';
  switchIndex = 0;
  renderSwitcher();
  refreshIcons();
  $('switch-input').focus();
}

// Met en valeur le mot cherché dans un texte
function highlight(text, query) {
  if (!query) return esc(text);
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return esc(text);
  return esc(text.slice(0, index)) + `<mark>${esc(text.slice(index, index + query.length))}</mark>` + esc(text.slice(index + query.length));
}

function renderSwitcher() {
  const query = $('switch-input').value.trim().toLowerCase();
  const tagQuery = query.startsWith('#') ? query.slice(1) : null;

  switchItems = allNotes()
    .map((entry) => ({ ...entry, text: plainText(entry.note.html) }))
    .filter(({ note, text }) => {
      if (!query) return true;
      if (tagQuery !== null) return tagsOf(note).some((tag) => tag.startsWith(tagQuery));
      return (note.title || '').toLowerCase().includes(query) || text.toLowerCase().includes(query);
    })
    .sort((a, b) => b.note.updated - a.note.updated)
    .slice(0, 9);

  switchIndex = Math.min(switchIndex, Math.max(0, switchItems.length - 1));
  $('switch-list').innerHTML = switchItems.map(({ cat, sub, note, text }, i) => {
    // Un extrait du contenu autour du mot cherché
    const at = query && tagQuery === null ? text.toLowerCase().indexOf(query) : -1;
    const snippet = at >= 0 ? text.slice(Math.max(0, at - 30), at + 60).trim() : '';
    return `
      <li><button class="switch-item ${i === switchIndex ? 'active' : ''}" data-open="${note.id}">
        <i data-lucide="file-text"></i>
        <span class="s-title">${highlight(note.title || 'Sans titre', tagQuery === null ? query : '')}
          ${snippet ? `<span class="s-snippet">${highlight(snippet, query)}</span>` : ''}</span>
        <span class="place">${esc(cat.name)} / ${esc(sub.name)}</span>
      </button></li>`;
  }).join('') || '<li class="hint-line">Aucune note trouvée.</li>';
  refreshIcons();
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

// Un clic sur le fond sombre ferme la fenêtre
$$('.modal').forEach((modal) => modal.addEventListener('mousedown', (event) => {
  if (event.target === modal) closeModals();
}));

// Ferme toutes les fenêtres et le menu contextuel
function closeModals() {
  if (dialogDone) finishDialog(false); // une question en cours reçoit « non »
  $$('.modal').forEach((modal) => { modal.hidden = true; });
  hideContextMenu();
}

$$('[data-close]').forEach((button) => button.addEventListener('click', closeModals));

// ----- Raccourcis clavier -----
// (Ctrl+N est réservé par le navigateur : la nouvelle note est sur Alt+N)

document.addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (ctrl && (key === 'o' || key === 'k' || key === 'p')) {
    event.preventDefault();
    openSwitcher();
  } else if (event.altKey && key === 'n') {
    event.preventDefault();
    newNote();
  } else if (ctrl && key === '\\') {
    event.preventDefault();
    toggleSidebar();
  } else if (ctrl && key === '.') {
    event.preventDefault();
    toggleInspector();
  } else if (event.key === 'Escape') {
    closeModals();
    closeDrawer();
  }
});

// ----- Petit message en bas de l'écran -----

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ----- Démarrage -----

applySettings();
renderAll();
showSaveState('saved');
