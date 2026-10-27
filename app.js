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
// events = [{ id, title, kind, date, start, end, allDay, reminder, noteId, details, created, updated }]  (agenda.js)
// tasks  = [{ id, title, due, done, doneAt, noteId, created, updated }]                                 (tasks.js)
// cards  = [{ id, front, back, deck, noteId, box, due, created }]                                        (review.js)
// state.recent garde les dernières notes ouvertes sur cet appareil.
//
// Les dates de l'agenda sont gardées en « heure locale » ("2026-11-03" et "14:30") :
// un contrôle à 8 h reste à 8 h, même lors du passage à l'heure d'hiver.
//
// Pour la synchro entre appareils, seules loadState() et save() devront changer.

const STORAGE_KEY = 'carnet-v1';
const SETTINGS_KEY = 'carnet-settings';
const DATA_VERSION = 2;

// Couleurs des dossiers (un petit point pour les reconnaître)
const CATEGORY_COLORS = ['#8b7cff', '#4fd8ec', '#5ce0b1', '#ffb067', '#ff7b93', '#e591d8'];
// Couleurs d'une note (un liseré dans la liste)
const COVERS = ['', '#8b7cff', '#4fd8ec', '#5ce0b1', '#ffb067', '#ff7b93'];
// Couleurs d'accent proposées dans les paramètres
const ACCENTS = [
  { name: 'Violet', color: '#8b7cff' },
  { name: 'Indigo', color: '#6d8bff' },
  { name: 'Cyan', color: '#4fd8ec' },
  { name: 'Lavande', color: '#b7a6ff' },
  { name: 'Menthe', color: '#5ce0b1' },
  { name: 'Ambre', color: '#ffb067' },
  { name: 'Corail', color: '#ff7b93' },
];
// Polices de lecture proposées dans les paramètres
const READ_FONTS = {
  serif: "'Newsreader', Georgia, serif",
  literata: "'Literata', Georgia, serif",
  sans: "'Geist', system-ui, sans-serif",
  dys: "'Atkinson Hyperlegible', Verdana, sans-serif",
};
// Les polices de l'éditeur. « google » : la police est chargée seulement quand on s'en sert.
const FONT_LIBRARY = [
  { label: 'Lecture (par défaut)', value: '' },
  { label: 'Geist', value: "'Geist', system-ui, sans-serif" },
  { label: 'Inter', value: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;600' },
  { label: 'Manrope', value: "'Manrope', system-ui, sans-serif" },
  { label: 'DM Sans', value: "'DM Sans', system-ui, sans-serif", google: 'DM+Sans:wght@400;600' },
  { label: 'Newsreader', value: "'Newsreader', Georgia, serif" },
  { label: 'Literata', value: "'Literata', Georgia, serif", google: 'Literata:opsz,wght@7..72,400;7..72,600' },
  { label: 'Lora', value: "'Lora', Georgia, serif", google: 'Lora:wght@400;600' },
  { label: 'Atkinson Hyperlegible', value: "'Atkinson Hyperlegible', Verdana, sans-serif", google: 'Atkinson+Hyperlegible:wght@400;700' },
  { label: 'Caveat (manuscrite)', value: "'Caveat', cursive", google: 'Caveat:wght@500;700' },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Instrument Sans', value: "'Instrument Sans', Inter, system-ui, sans-serif", google: 'Instrument+Sans:wght@400;600' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
];
// Anciennes polices par défaut : on les remplace par la police de lecture choisie
const OLD_DEFAULT_FONTS = ["'Instrument Sans', Inter, system-ui, sans-serif", 'Segoe UI, system-ui, sans-serif'];

// Types d'événements de l'agenda, avec leur couleur
const EVENT_KINDS = {
  cours: { label: 'Cours', color: '#4fd8ec' },
  examen: { label: 'Examen', color: '#ff7b93' },
  devoir: { label: 'Devoir', color: '#ffb067' },
  limite: { label: 'Date limite', color: '#b18cff' },
  perso: { label: 'Perso', color: '#5ce0b1' },
};

// Raccourcis
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const isPhone = () => window.matchMedia('(max-width: 900px)').matches;
const isNarrow = () => window.matchMedia('(max-width: 1280px)').matches;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

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

// ----- Dates en heure locale -----
// « 2026-11-03 » est construit avec les champs locaux : pas de décalage de fuseau.

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
function parseYmd(text) {
  const [y, m, d] = String(text).split('-').map(Number);
  return new Date(y, m - 1, d);
}
const isValidYmd = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text || '') && ymd(parseYmd(text)) === text;
const isValidTime = (text) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text || '');
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const todayYmd = () => ymd(new Date());
// Nombre de jours entre deux dates (arrondi : un jour d'heure d'été fait 23 h)
const daysBetween = (from, to) => Math.round((parseYmd(to) - parseYmd(from)) / 86400000);
const minutesOf = (time) => (isValidTime(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null);
// Lundi de la semaine d'une date (en France, la semaine commence le lundi)
const startOfWeek = (date) => addDays(date, -((date.getDay() + 6) % 7));

// « dimanche 1er novembre » : en français, on écrit « 1er » pour le premier du mois
const formatDay = (text, options = { weekday: 'long', day: 'numeric', month: 'long' }) => parseYmd(text)
  .toLocaleDateString('fr-FR', options).replace(/\b1 (?=\p{L})/u, '1er ');
// « aujourd'hui », « demain », « hier », ou la date
function relativeDay(text) {
  const diff = daysBetween(todayYmd(), text);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  return formatDay(text, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Dates lisibles : « 27 oct., 14:32 » et « 27 octobre 2026 »
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
const formatLong = (timestamp) => new Date(timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

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
      '<li>Écris une ligne <b>Question :: Réponse</b> : elle peut devenir une carte de révision.</li>',
      '<li>Clic droit sur une note pour la mettre en favori, l’épingler ou l’ajouter à l’agenda.</li></ul>',
      '<p>Qu’est-ce qu’une dérivée ? :: Le taux de variation instantané d’une fonction.</p>',
      '<blockquote>Une idée notée est une idée qui ne se perd pas.</blockquote>',
    ].join('')),
    cover: COVERS[1],
    pinned: true,
  };
  return {
    version: DATA_VERSION,
    recent: [],
    events: [],
    tasks: [],
    cards: [],
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

// Complète des données lues (ancienne version, autre onglet, sauvegarde importée)
function upgradeData(data) {
  data.recent = Array.isArray(data.recent) ? data.recent : [];
  data.events = Array.isArray(data.events) ? data.events : [];
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.cards = Array.isArray(data.cards) ? data.cards : [];
  data.categories.forEach((cat) => {
    cat.subs = Array.isArray(cat.subs) ? cat.subs : [];
    cat.subs.forEach((sub) => {
      sub.notes = Array.isArray(sub.notes) ? sub.notes : [];
      sub.notes.forEach(upgradeNote);
    });
  });
  data.version = DATA_VERSION;
  return data;
}

// Des données valides ont au moins une liste de dossiers
const looksLikeData = (data) => data && typeof data === 'object' && Array.isArray(data.categories);

function backupRaw(key, raw) {
  try {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  } catch (error) {
    console.warn('Copie de sécurité impossible (stockage plein ?) :', error);
  }
}

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Stockage inaccessible :', error);
  }
  if (!raw) return defaultState();

  try {
    const data = JSON.parse(raw);
    if (!looksLikeData(data)) throw new Error('format inconnu');
    // Avant de passer à la nouvelle version, on garde une copie intacte de l'ancienne
    if ((data.version || 1) < DATA_VERSION) backupRaw(`carnet-backup-v${data.version || 1}`, raw);
    return upgradeData(data);
  } catch (error) {
    // Données illisibles : on les met de côté au lieu de les écraser
    console.warn('Lecture impossible, copie gardée et carnet de départ utilisé :', error);
    backupRaw(`carnet-illisible-${Date.now()}`, raw);
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
    toast('Sauvegarde impossible : le stockage de ce navigateur est peut-être plein. Exporte une sauvegarde dans les Paramètres.');
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
  box.classList.toggle('error', kind === 'error');
  $('save-text').textContent = { saving: 'Enregistrement…', error: 'Non enregistré', saved: 'Enregistré' }[kind];
}

// ----- Paramètres (enregistrés sur cet appareil) -----

function loadSettings() {
  const defaults = {
    accent: ACCENTS[0].color, theme: 'night', fx: 'rich', name: '',
    readFont: 'serif', readSize: '18', sidebar: true, inspector: !isNarrow(),
    aiUrl: '', aiCode: '', aiConsent: false,
  };
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    if (saved.accent === '#a28bf0') saved.accent = defaults.accent; // ancienne couleur par défaut
    return saved;
  } catch (error) {
    return defaults;
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { /* pas grave */ }
}

const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
const resolvedTheme = () => (settings.theme === 'day' || (settings.theme === 'auto' && prefersLight.matches) ? 'day' : 'night');

// Applique les paramètres : thème, accent, effets, police et taille de lecture, panneaux
function applySettings() {
  const root = document.documentElement;
  const theme = resolvedTheme();
  root.dataset.theme = theme;
  if (settings.fx === 'low') root.dataset.fx = 'low';
  else delete root.dataset.fx;
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--read', READ_FONTS[settings.readFont] || READ_FONTS.serif);
  root.style.setProperty('--read-size', `${settings.readSize}px`);
  $('theme-color').setAttribute('content', theme === 'day' ? '#eef0fa' : '#090c1d');
  if (settings.readFont === 'literata') ensureFont("'Literata'");
  if (settings.readFont === 'dys') ensureFont("'Atkinson Hyperlegible'");

  $('app').classList.toggle('sb-off', !settings.sidebar);
  // Sur petit écran, les détails passent par-dessus la note : ils ne s'ouvrent que sur demande
  $('sheet').classList.toggle('ins-on', isNarrow() ? inspectorOverlay : settings.inspector);
  $('read-font').value = settings.readFont;
  $('read-size').value = settings.readSize;
}
prefersLight.addEventListener('change', () => { if (settings.theme === 'auto') applySettings(); });
window.matchMedia('(max-width: 1280px)').addEventListener('change', () => { inspectorOverlay = false; applySettings(); });

// Charge une police Google la première fois qu'elle sert (elle ne ralentit pas le démarrage)
const loadedFonts = new Set();
function ensureFont(text) {
  FONT_LIBRARY.forEach((font) => {
    const name = font.value.split(',')[0];
    if (!font.google || loadedFonts.has(font.google) || !String(text).includes(name.replace(/'/g, ''))) return;
    loadedFonts.add(font.google);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    document.head.appendChild(link);
  });
}

let state = loadState();
let settings = loadSettings();
let view = 'home';                        // espace affiché : home, notes, agenda, tasks, review, ai, qr, graph
let selection = { cat: null, sub: null }; // le sous-dossier ouvert
let noteId = null;                        // la note ouverte
let savedRange = null;                    // le texte sélectionné dans la note
let filterTag = null;                     // tag affiché dans la liste, s'il y en a un
let activeTab = 'text';                   // volet ouvert : texte, schéma, fichiers
let inspectorOverlay = false;             // détails ouverts par-dessus la note (petits écrans)

const VIEW_NAMES = {
  home: 'Accueil', notes: 'Mes notes', agenda: 'Agenda', tasks: 'Tâches',
  review: 'Révisions', ai: 'Assistant IA', qr: 'QR codes', graph: 'Graphe',
};

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
const noteTitle = (id) => {
  const place = id ? findPlace(id) : null;
  return place ? place.note.title || 'Sans titre' : '';
};

// Les notes qui pointent vers celle-ci avec [[Titre]]
function backlinksOf(note) {
  return allNotes().filter(({ note: other }) => other.id !== note.id
    && linkTitles(other).some((title) => sameTitle(title, note.title)));
}

// Les options d'un menu déroulant « choisir une note », rangées par dossier
function noteOptionsHtml(selectedId, emptyLabel = 'Aucune') {
  const groups = state.categories.map((cat) => {
    const options = cat.subs.flatMap((sub) => sub.notes.map((note) => `
      <option value="${note.id}" ${note.id === selectedId ? 'selected' : ''}>${esc(sub.name)} · ${esc(note.title || 'Sans titre')}</option>`));
    return options.length ? `<optgroup label="${esc(cat.name)}">${options.join('')}</optgroup>` : '';
  }).join('');
  return `${emptyLabel === null ? '' : `<option value="">${esc(emptyLabel)}</option>`}${groups}`;
}

// ----- Agenda, tâches et cartes : petites requêtes utilisées partout -----

const eventKind = (event) => EVENT_KINDS[event.kind] || EVENT_KINDS.perso;
const byEventTime = (a, b) => (a.date.localeCompare(b.date))
  || (Number(!a.allDay) - Number(!b.allDay))
  || ((a.start || '').localeCompare(b.start || ''));
const eventsOnDay = (day) => state.events.filter((event) => event.date === day).sort(byEventTime);
// Les événements à venir (à partir d'aujourd'hui), dans l'ordre
function upcomingEvents(days = 30) {
  const today = todayYmd();
  const last = ymd(addDays(new Date(), days));
  return state.events.filter((event) => event.date >= today && event.date <= last).sort(byEventTime);
}
const openTasks = () => state.tasks.filter((task) => !task.done);
// Tâches en retard ou pour aujourd'hui
const urgentTasks = () => openTasks().filter((task) => task.due && task.due <= todayYmd());
const dueCards = () => state.cards.filter((card) => !card.due || card.due <= todayYmd());
const eventTimeLabel = (event) => (event.allDay || !event.start ? 'Journée' : `${event.start}${event.end ? `–${event.end}` : ''}`);

// Relance les icônes Lucide après un changement de l'affichage
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ----- Barre latérale -----

// Une note dans une liste du menu (favoris, épinglées)
function sideItem(note, icon) {
  return `
    <li><button class="side-item ${note.id === noteId && view === 'notes' ? 'active' : ''}" data-open="${note.id}">
      <i data-lucide="${icon}"></i><span class="label-text">${esc(note.title || 'Sans titre')}</span>
    </button></li>`;
}

function setBadge(id, count, alert = false) {
  const badge = $(id);
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('alert', alert);
}

function renderSidebarLists() {
  const favorites = allNotes().filter(({ note }) => note.favorite);
  $('fav-list').innerHTML = favorites.length
    ? favorites.map(({ note }) => sideItem(note, 'star')).join('')
    : '<li class="side-empty">Clique sur l’étoile d’une note pour l’ajouter ici.</li>';

  const pinned = allNotes().filter(({ note }) => note.pinned);
  $('pin-list').innerHTML = pinned.length
    ? pinned.map(({ note }) => sideItem(note, 'pin')).join('')
    : '<li class="side-empty">Une note épinglée reste aussi en haut de son dossier.</li>';

  // Espace actif dans la navigation (menu et barre du téléphone)
  $$('[data-view]').forEach((item) => {
    const active = item.dataset.view === view && !(view === 'notes' && filterTag && item.closest('.nav'));
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  // Petits compteurs : événements du jour, tâches urgentes, cartes à revoir
  const late = openTasks().some((task) => task.due && task.due < todayYmd());
  setBadge('badge-agenda', eventsOnDay(todayYmd()).length);
  setBadge('badge-tasks', urgentTasks().length, late);
  setBadge('badge-review', dueCards().length);
}

function renderTree() {
  $('tree').innerHTML = state.categories.map((cat, index) => {
    const color = cat.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const total = cat.subs.reduce((sum, sub) => sum + sub.notes.length, 0);
    return `
      <li class="cat ${cat.open ? '' : 'collapsed'}">
        <div class="tree-row cat-row" data-row="cat" data-cat="${cat.id}">
          <span class="caret"><i data-lucide="chevron-down"></i></span>
          <span class="dot" style="background:${color};color:${color}"></span>
          <span class="name cat-name">${esc(cat.name)}</span>
          <span class="count">${total}</span>
          <button class="icon-btn small row-more" data-action="menu" aria-label="Actions du dossier ${esc(cat.name)}"><i data-lucide="more-horizontal"></i></button>
        </div>
        <ul class="subs">
          ${cat.subs.map((sub) => `
            <li class="tree-row sub-row ${selection.sub === sub.id && !filterTag && view === 'notes' ? 'active' : ''}"
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
  $('note-list').innerHTML = items.map(({ note, place }, i) => `
    <li class="note-card ${note.id === noteId ? 'active' : ''}" data-note="${note.id}" style="--cover:${note.cover || 'transparent'};animation-delay:${Math.min(i, 12) * 18}ms">
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
    $('sub-count').textContent = `${plural(matches.length, 'note')} avec ce tag`;
    renderCards(matches.sort((a, b) => byPinThenDate(a.note, b.note))
      .map(({ cat, sub: s, note }) => ({ note, place: `${cat.name} / ${s.name}` })), 'Aucune note avec ce tag.');
    return;
  }

  if (!sub) {
    const total = allNotes().length;
    $('sub-title').textContent = 'Toutes les notes';
    $('sub-count').textContent = plural(total, 'note');
    renderCards(allNotes().sort((a, b) => byPinThenDate(a.note, b.note)).slice(0, 40)
      .map(({ cat, sub: s, note }) => ({ note, place: `${cat.name} / ${s.name}` })),
    'Aucune note pour l’instant. Crée un dossier dans le menu, puis une note.');
    return;
  }

  const count = sub.notes.length;
  $('sub-title').textContent = sub.name;
  $('sub-count').textContent = `${findCat(selection.cat).name} · ${plural(count, 'note')}`;
  renderCards([...sub.notes].sort(byPinThenDate).map((note) => ({ note, place: null })),
    'Ce dossier est vide.<br>Crée la première note avec le bouton en haut.');
}

// Les dossiers, en cartes (Mes notes, sans note ouverte)
function renderShelf() {
  const total = allNotes().length;
  $('notes-home-sub').textContent = `${plural(total, 'note')} · ${plural(state.categories.length, 'dossier')}`;
  $('shelf').innerHTML = state.categories.map((cat, index) => {
    const color = cat.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const count = cat.subs.reduce((sum, sub) => sum + sub.notes.length, 0);
    const subs = cat.subs.map((sub) => `
      <li><button data-cat="${cat.id}" data-sub="${sub.id}"><span>${esc(sub.name)}</span><span class="count">${sub.notes.length}</span></button></li>`).join('');
    return `
      <li class="shelf-card glow">
        <div class="shelf-head">
          <span class="dot" style="background:${color};color:${color}"></span>
          <span>${esc(cat.name)}</span>
          <span class="count">${count}</span>
        </div>
        <ul>${subs || '<li class="side-empty">Aucun sous-dossier</li>'}</ul>
      </li>`;
  }).join('') || '<li class="empty-list">Crée ton premier dossier avec le bouton + du menu.</li>';
}

// ----- Barre supérieure et panneau de détails -----

function renderCrumbs() {
  const note = view === 'notes' ? currentNote() : null;
  const sub = currentSub();
  const sep = '<span class="sep">/</span>';
  let html;
  if (view !== 'notes') {
    html = `<span class="crumb current">${VIEW_NAMES[view]}</span>`;
  } else if (filterTag && !note) {
    html = `<span class="crumb current">#${esc(filterTag)}</span>`;
  } else if (sub) {
    const cat = findCat(selection.cat);
    html = `<span class="crumb">${esc(cat.name)}</span>${sep}`
      + `<button class="crumb ${note ? '' : 'current'}" data-crumb-sub="${sub.id}" data-cat="${cat.id}">${esc(sub.name)}</button>`
      + (note ? `${sep}<span class="crumb current">${esc(note.title || 'Sans titre')}</span>` : '');
  } else {
    html = '<span class="crumb current">Mes notes</span>';
  }
  $('crumbs').innerHTML = html;

  // Les actions de note n'apparaissent que si une note est ouverte
  $('note-actions').hidden = !note;
  if (note) {
    $('fav-btn').classList.toggle('on', note.favorite);
    $('fav-btn').setAttribute('aria-pressed', String(note.favorite));
    $('pin-btn').classList.toggle('on', note.pinned);
    $('pin-btn').setAttribute('aria-pressed', String(note.pinned));
  }
}

function renderInspector() {
  const note = view === 'notes' ? currentNote() : null;
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

  // Événements et tâches liés à cette note
  const events = state.events.filter((event) => event.noteId === note.id).sort(byEventTime);
  const tasks = state.tasks.filter((task) => task.noteId === note.id && !task.done);
  $('note-events').innerHTML = [
    ...events.map((event) => `
      <li><button class="link-item" data-event="${event.id}" style="--kind:${eventKind(event).color}">
        <span class="kdot"></span><span>${esc(event.title)}</span><span class="when">${relativeDay(event.date)}</span>
      </button></li>`),
    ...tasks.map((task) => `
      <li><button class="link-item" data-task="${task.id}">
        <i data-lucide="circle"></i><span>${esc(task.title)}</span>${task.due ? `<span class="when">${relativeDay(task.due)}</span>` : ''}
      </button></li>`),
  ].join('') || '<li class="side-empty">Ajoute un contrôle ou une date limite liée à cette note.</li>';

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

// ----- Espaces : accueil, notes, agenda… -----

// Ce que chaque espace doit dessiner quand il s'affiche (fonctions des autres fichiers)
const PAGE_RENDERERS = {
  home: () => renderHome(),       // home.js
  agenda: () => renderAgenda(),   // agenda.js
  tasks: () => renderTasks(),     // tasks.js
  review: () => renderReview(),   // review.js
  ai: () => renderAiPage(),       // ai.js
  qr: () => renderQrPage(),       // qr.js
  graph: () => renderGraph(),     // graph.js
};

function renderEditorVisibility() {
  const note = view === 'notes' ? currentNote() : null;
  const pageMode = view !== 'notes';

  $('sheet').classList.toggle('mode-page', pageMode);
  $$('[data-page]').forEach((page) => { page.hidden = page.dataset.page !== view; });
  $('notes-empty').hidden = !(view === 'notes' && !note);
  $('editor-inner').hidden = !note;
  // Le panneau de détails ne prend de la place que si une note est ouverte
  $('sheet').classList.toggle('has-note', Boolean(note));
  $('inspector-toggle').hidden = !note;

  // Sur téléphone : une page prend tout l'écran ; dans « Mes notes », la liste, ou la note ouverte
  $('app').classList.toggle('show-editor', pageMode || Boolean(note));
  $('app').classList.toggle('writing', Boolean(note) && isPhone());

  if (PAGE_RENDERERS[view]) PAGE_RENDERERS[view]();
  if (view === 'notes' && !note) renderShelf();
  if (note) renderNoteView(note);
}

// Change d'espace (le dossier et la note ouverts sont gardés pour y revenir)
function setView(next) {
  if (!VIEW_NAMES[next]) return;
  if (view === 'qr' && next !== 'qr' && typeof clearQrPreview === 'function') clearQrPreview();
  view = next;
  if (next !== 'notes') filterTag = null;
  closeDrawer();
  renderAll();
  const pane = document.querySelector(`[data-page="${next}"]`);
  if (pane) pane.scrollTop = 0;
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
  $('meta').innerHTML = `Modifiée ${formatDate(note.updated)} · ${plural(words, 'mot')}${tags ? ` · ${tags}` : ''}`;
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

// ----- Fenêtres -----

let lastFocus = null; // l'élément qui avait le focus avant d'ouvrir une fenêtre

function openModal(id, focusId) {
  if (!document.querySelector('.modal:not([hidden])')) lastFocus = document.activeElement;
  $(id).hidden = false;
  refreshIcons();
  const target = focusId ? $(focusId) : $(id).querySelector('input:not([type="hidden"]):not([hidden]), textarea, select, button.btn-primary');
  if (target) setTimeout(() => target.focus(), 30);
}

// Ferme toutes les fenêtres et le menu contextuel
function closeModals() {
  if (dialogDone) finishDialog(false); // une question en cours reçoit « non »
  const wasOpen = document.querySelector('.modal:not([hidden])');
  $$('.modal').forEach((modal) => { modal.hidden = true; });
  hideContextMenu();
  if (wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

// ----- Questions à l'utilisateur -----
// Une petite fenêtre intégrée à la page remplace prompt() et confirm() :
// elle est plus jolie, et elle marche aussi là où ces fenêtres sont bloquées.

let dialogDone = null; // fonction qui termine la question en cours

function openDialog({ message, withInput = false, value = '', okLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    if (dialogDone) finishDialog(false);
    if (!document.querySelector('.modal:not([hidden])')) lastFocus = document.activeElement;
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

// Flèches haut/bas dans le menu
$('ctx-menu').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...$('ctx-menu').querySelectorAll('.ctx-item')];
  const index = items.indexOf(document.activeElement);
  const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
  if (next) next.focus();
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#ctx-menu')) hideContextMenu();
});

// Ouvre un menu juste sous un bouton
function menuUnder(button, items, alignRight = false) {
  const rect = button.getBoundingClientRect();
  showContextMenu(items, alignRight ? rect.right - 230 : rect.left, rect.bottom + 6);
}

// Le menu « Créer »
function createMenuItems() {
  return [
    { label: 'Nouvelle note', icon: 'square-pen', kbd: 'Alt N', run: newNote },
    { label: 'Nouvel événement', icon: 'calendar-plus', kbd: 'Alt E', run: () => openEventEditor() },
    { label: 'Nouvelle tâche', icon: 'list-plus', kbd: 'Alt T', run: () => newTaskPrompt() },
    { label: 'Nouvelle carte de révision', icon: 'layers', run: () => openCardEditor() },
    'sep',
    { label: 'Nouveau dossier', icon: 'folder-plus', run: addCategory },
  ];
}

// Les actions possibles sur une note
function noteMenuItems(id) {
  const place = findPlace(id);
  if (!place) return [];
  const { note } = place;
  return [
    { label: 'Ouvrir', icon: 'file-text', run: () => openNoteAnywhere(id) },
    { label: note.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: 'star', run: () => toggleFavorite(note) },
    { label: note.pinned ? 'Désépingler' : 'Épingler', icon: 'pin', run: () => togglePin(note) },
    { label: 'Ajouter une échéance à l’agenda', icon: 'calendar-plus', run: () => eventFromNote(id) },
    { label: 'Assistant IA', icon: 'sparkles', run: () => openAiForNote(id) },
    { label: 'Dupliquer', icon: 'copy', run: () => duplicateNote(id) },
    { label: 'Copier le lien [[…]]', icon: 'link-2', run: () => copyLink(note) },
    { label: 'QR code', icon: 'qr-code', run: () => openQrForNote(id) },
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
    if (!(await askConfirm(`Supprimer le dossier « ${cat.name} » et ses ${plural(total, 'note')} ?`))) return;
    cat.subs.forEach((s) => s.notes.forEach((n) => forgetNote(n.id)));
    state.categories = state.categories.filter((c) => c.id !== catId);
    if (selection.cat === catId) clearSelection();
  }
  if (action === 'delete-sub' && sub) {
    if (!(await askConfirm(`Supprimer « ${sub.name} » et ses ${plural(sub.notes.length, 'note')} ?`))) return;
    sub.notes.forEach((n) => forgetNote(n.id));
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
  view = 'notes';
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
  view = 'notes';
  const note = currentNote();
  if (!note) return;
  if (typeof Voice !== 'undefined') Voice.close();
  // Petit écran : les détails se referment pour laisser voir la note ouverte
  if (isNarrow() && inspectorOverlay) {
    inspectorOverlay = false;
    $('sheet').classList.remove('ins-on');
  }

  // Mémorise la note dans les « récentes »
  state.recent = [id, ...state.recent.filter((other) => other !== id)].slice(0, 8);
  save();

  ensureFont(note.font + note.html);
  $('note-title').value = note.title;
  $('note-body').innerHTML = note.html;
  $('note-body').style.fontFamily = note.font || '';
  $('font-select').value = note.font || '';
  savedRange = null;
  updateMeta(note);
  renderAll();
  $('editor-inner').scrollTop = 0;
}

// Où ranger une nouvelle note : le sous-dossier ouvert, sinon le premier (créé au besoin)
function placeForNewNote() {
  let sub = currentSub();
  if (sub) return { cat: findCat(selection.cat), sub };
  let cat = state.categories.find((c) => c.subs.length);
  if (!cat) {
    cat = state.categories[0] || { id: uid(), name: 'Notes', color: CATEGORY_COLORS[0], open: true, subs: [] };
    if (!state.categories.includes(cat)) state.categories.push(cat);
    cat.subs.push({ id: uid(), name: 'Général', notes: [] });
  }
  sub = cat.subs[0];
  return { cat, sub };
}

// Range une note dans un sous-dossier nommé (« Reçues », « Assistant »…), créé au besoin
function placeNamed(catName, subName) {
  let cat = state.categories.find((c) => sameTitle(c.name, catName));
  if (!cat) {
    cat = { id: uid(), name: catName, color: CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length], open: true, subs: [] };
    state.categories.push(cat);
  }
  let sub = cat.subs.find((s) => sameTitle(s.name, subName));
  if (!sub) {
    sub = { id: uid(), name: subName, notes: [] };
    cat.subs.push(sub);
  }
  return { cat, sub };
}

// Nouvelle note : dans le sous-dossier ouvert, ou celui de la note ouverte, ou le premier
function newNote() {
  const place = placeForNewNote();
  selection = { cat: place.cat.id, sub: place.sub.id };
  const note = makeNote();
  place.sub.notes.push(note);
  save();
  activeTab = 'text';
  filterTag = null;
  openNote(note.id);
  closeDrawer();
  $('note-title').focus();
}

// Crée une note avec un contenu (assistant IA, QR code reçu…) et l'ouvre
function createNoteWithContent(title, html, place = placeForNewNote()) {
  const note = makeNote(title, html);
  place.sub.notes.push(note);
  save();
  openNoteAnywhere(note.id);
  return note;
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

// Une note supprimée : on retire aussi ses liens dans l'agenda, les tâches et les cartes
function forgetNote(id) {
  state.recent = state.recent.filter((other) => other !== id);
  state.events.forEach((event) => { if (event.noteId === id) event.noteId = ''; });
  state.tasks.forEach((task) => { if (task.noteId === id) task.noteId = ''; });
  state.cards.forEach((card) => { if (card.noteId === id) card.noteId = ''; });
  if (noteId === id) noteId = null;
}

async function deleteNoteById(id) {
  const place = findPlace(id);
  if (!place) return;
  if (!(await askConfirm(`Supprimer la note « ${place.note.title || 'Sans titre'} » ?`))) return;
  place.sub.notes = place.sub.notes.filter((n) => n.id !== id);
  forgetNote(id);
  save();
  renderAll();
  toast('Note supprimée.');
}

// Clics sur les listes : menu, liste des notes, dossiers, tags, liens
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

$('shelf').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-sub]');
  if (button) selectSubcategory(button.dataset.cat, button.dataset.sub);
});
$('notes-home-new').addEventListener('click', newNote);

// Tags : dans le menu et dans les détails
function onTagClick(event) {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  filterTag = filterTag === button.dataset.tag ? null : button.dataset.tag;
  view = 'notes';
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
  const ev = event.target.closest('[data-event]');
  const task = event.target.closest('[data-task]');
  if (open) openNoteAnywhere(open.dataset.open);
  if (create) createNoteFromLink(create.dataset.create);
  if (ev) openEventEditor(ev.dataset.event);  // agenda.js
  if (task) openTaskEditor(task.dataset.task); // tasks.js
});
$('insp-add-event').addEventListener('click', () => { if (noteId) eventFromNote(noteId); });

// Navigation : menu latéral et barre du téléphone
function onNavClick(event) {
  const target = event.target.closest('[data-view]');
  const open = event.target.closest('[data-open]');
  if (open) {
    openNoteAnywhere(open.dataset.open);
    return;
  }
  if (!target) return;
  const next = target.dataset.view;
  // « Mes notes » depuis le menu : on revient à la liste complète
  if (next === 'notes' && view === 'notes') {
    clearSelection();
    filterTag = null;
  }
  setView(next);
}
$('sidebar').addEventListener('click', onNavClick);
$('tabbar').addEventListener('click', onNavClick);

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

// Boutons « Agenda → », « Tout voir → » des pages
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-goto]');
  if (link) setView(link.dataset.goto);
});

// Barre supérieure
$('fav-btn').addEventListener('click', () => { const note = currentNote(); if (note) toggleFavorite(note); });
$('pin-btn').addEventListener('click', () => { const note = currentNote(); if (note) togglePin(note); });
$('event-btn').addEventListener('click', () => { if (noteId) eventFromNote(noteId); });
$('more-btn').addEventListener('click', (event) => {
  const note = currentNote();
  if (!note) return;
  menuUnder(event.currentTarget, noteMenuItems(note.id).filter((item) => item === 'sep' || item.label !== 'Ouvrir'), true);
});
$('create-btn').addEventListener('click', (event) => menuUnder(event.currentTarget, createMenuItems(), true));
$('sb-create').addEventListener('click', (event) => menuUnder(event.currentTarget, createMenuItems()));

$('search-btn').addEventListener('click', openSwitcher);
$('new-note').addEventListener('click', newNote);
$('sb-new-note').addEventListener('click', newNote);
$('add-cat').addEventListener('click', addCategory);

// ----- Éditeur : texte, titre, mise en forme -----

const body = $('note-body');

// Les polices de l'éditeur
$('font-select').innerHTML = FONT_LIBRARY.map((font) => `<option value="${esc(font.value)}">${esc(font.label)}</option>`).join('');

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
  const selected = window.getSelection();
  selected.removeAllRanges();
  if (savedRange && body.contains(savedRange.startContainer)) {
    selected.addRange(savedRange);
    return;
  }
  // Pas d'endroit mémorisé : on se place à la fin du texte
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  selected.addRange(range);
}

// Le texte sélectionné dans la note (ou une chaîne vide)
function selectedNoteText() {
  const selected = window.getSelection();
  if (selected.rangeCount && !selected.isCollapsed && body.contains(selected.anchorNode)) return selected.toString();
  if (savedRange && !savedRange.collapsed && body.contains(savedRange.startContainer)) return savedRange.toString();
  return '';
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

// Insère du HTML à l'endroit du curseur (ou à la fin de la note)
function insertHtmlAtCursor(html) {
  restoreSelection();
  document.execCommand('insertHTML', false, html);
  noteChanged();
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
  ensureFont(font);
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

// Retour à la liste (téléphone) : on ferme la note
$$('[data-back]').forEach((button) => {
  button.addEventListener('click', () => {
    noteId = null;
    if (typeof Voice !== 'undefined') Voice.close();
    renderAll();
  });
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
  if (isNarrow()) {
    inspectorOverlay = !inspectorOverlay;
  } else {
    settings.inspector = !settings.inspector;
    saveSettings();
  }
  applySettings();
  renderInspector();
  refreshIcons();
}

function openDrawer() { $('app').classList.add('menu-open'); }
function closeDrawer() { $('app').classList.remove('menu-open'); }

$('sidebar-toggle').addEventListener('click', toggleSidebar);
$('sidebar-open').addEventListener('click', toggleSidebar);
$('inspector-toggle').addEventListener('click', toggleInspector);
$('inspector-close').addEventListener('click', toggleInspector);
$$('[data-open-menu]').forEach((button) => button.addEventListener('click', openDrawer));
$('scrim').addEventListener('click', closeDrawer);

// ----- Paramètres -----

function renderSettings() {
  $('accents').innerHTML = ACCENTS.map(({ name, color }) => `
    <button class="accent-dot ${color === settings.accent ? 'active' : ''}" data-accent="${color}"
            style="background:${color}" title="${name}" aria-label="Accent ${name}" aria-pressed="${color === settings.accent}"></button>`).join('');
  $$('[data-theme-choice]').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === settings.theme));
  $$('[data-fx]').forEach((b) => b.classList.toggle('active', b.dataset.fx === settings.fx));
  $('name-input').value = settings.name;
  if (typeof renderAiSettings === 'function') renderAiSettings();     // ai.js
  if (typeof renderInstallHelp === 'function') renderInstallHelp();   // pwa.js
  renderStorageInfo();
}

$('settings-btn').addEventListener('click', () => {
  renderSettings();
  closeDrawer();
  openModal('settings-modal', 'settings-title');
});

$('accents').addEventListener('click', (event) => {
  const dot = event.target.closest('[data-accent]');
  if (!dot) return;
  settings.accent = dot.dataset.accent;
  saveSettings();
  applySettings();
  renderSettings();
  if (view === 'graph') renderGraph();
});

$('theme-seg').addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-choice]');
  if (!button) return;
  settings.theme = button.dataset.themeChoice;
  saveSettings();
  applySettings();
  renderSettings();
  if (view === 'graph') renderGraph();
});

$('fx-seg').addEventListener('click', (event) => {
  const button = event.target.closest('[data-fx]');
  if (!button) return;
  settings.fx = button.dataset.fx;
  saveSettings();
  applySettings();
  renderSettings();
});

$('name-input').addEventListener('input', (event) => {
  settings.name = event.target.value.trim().slice(0, 40);
  saveSettings();
  if (view === 'home') renderHome();
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

// ----- Mes données : sauvegarde, restauration, protection -----

async function renderStorageInfo() {
  const info = $('storage-info');
  let text = 'Tes notes sont enregistrées sur cet appareil, dans ce navigateur. Exporte une sauvegarde de temps en temps.';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate();
      text += ` Espace utilisé : ${(usage / (1024 * 1024)).toFixed(1)} Mo.`;
    }
    if (navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()) {
      text += ' Protection contre l’effacement : activée.';
      $('persist-btn').hidden = true;
    }
  } catch (error) { /* pas grave */ }
  info.textContent = text;
}

function exportData() {
  const payload = { app: 'carnet', version: DATA_VERSION, exported: new Date().toISOString(), state };
  const file = new File([JSON.stringify(payload, null, 2)], `carnet-sauvegarde-${todayYmd()}.json`, { type: 'application/json' });
  saveFile(file); // files.js
  toast('Sauvegarde exportée (les fichiers joints ne sont pas inclus).');
}

async function importData(file) {
  let data;
  try {
    const parsed = JSON.parse(await file.text());
    data = parsed && parsed.app === 'carnet' ? parsed.state : parsed;
    if (!looksLikeData(data)) throw new Error('format inconnu');
  } catch (error) {
    toast('Ce fichier n’est pas une sauvegarde Carnet lisible.');
    return;
  }
  const count = data.categories.reduce((sum, cat) => sum + (cat.subs || []).reduce((s, sub) => s + (sub.notes || []).length, 0), 0);
  if (!(await askConfirm(`Remplacer tes notes actuelles par cette sauvegarde (${plural(count, 'note')}) ?\nUne copie de tes notes actuelles est gardée sur cet appareil.`, 'Remplacer'))) return;
  try { localStorage.setItem('carnet-avant-import', JSON.stringify(state)); } catch (error) { /* stockage plein */ }
  state = upgradeData(data);
  clearSelection();
  save();
  closeModals();
  setView('home');
  toast('Sauvegarde importée.');
}

$('export-btn').addEventListener('click', exportData);
$('import-btn').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) importData(file);
  event.target.value = '';
});
$('persist-btn').addEventListener('click', async () => {
  if (!navigator.storage || !navigator.storage.persist) {
    toast('Ce navigateur ne propose pas cette protection.');
    return;
  }
  const granted = await navigator.storage.persist();
  toast(granted ? 'Protection activée : le navigateur ne videra pas tes notes pour faire de la place.' : 'Le navigateur a refusé pour l’instant. Installer l’application aide souvent.');
  renderStorageInfo();
});

// ----- Plusieurs onglets ouverts : on suit les changements des autres -----
// Si une autre fenêtre de Carnet enregistre, on reprend ses données, sauf la note
// qu'on est en train d'écrire si notre version est plus récente.

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  let incoming;
  try {
    incoming = JSON.parse(event.newValue);
    if (!looksLikeData(incoming)) return;
  } catch (error) {
    return;
  }
  upgradeData(incoming);
  const mine = currentNote();
  const editing = mine && (document.activeElement === body || document.activeElement === $('note-title'));
  state = incoming;
  const theirs = noteId ? findPlace(noteId) : null;

  if (mine && theirs) {
    if (mine.updated > theirs.note.updated) {
      Object.assign(theirs.note, mine);      // notre version, plus récente, est gardée
    } else if (theirs.note.updated > mine.updated && !editing) {
      $('note-title').value = theirs.note.title;
      body.innerHTML = theirs.note.html;     // l'autre fenêtre a modifié cette note
    }
  }
  if (noteId && !findPlace(noteId)) noteId = null;
  renderAll();
});

// ----- Recherche globale (Ctrl+K) -----

let switchItems = [];
let switchIndex = 0;

function openSwitcher() {
  closeDrawer();
  $('switch-input').value = '';
  switchIndex = 0;
  renderSwitcher();
  openModal('switcher-modal', 'switch-input');
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
    const id = switchItems[switchIndex].note.id;
    closeModals();
    openNoteAnywhere(id);
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

$$('[data-close]').forEach((button) => button.addEventListener('click', closeModals));

// ----- Raccourcis clavier -----
// (Ctrl+N est réservé par le navigateur : la nouvelle note est sur Alt+N)

const VIEW_KEYS = { 1: 'home', 2: 'notes', 3: 'agenda', 4: 'tasks', 5: 'review', 6: 'ai' };

document.addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
  if (ctrl && (key === 'o' || key === 'k' || key === 'p')) {
    event.preventDefault();
    openSwitcher();
  } else if (event.altKey && !ctrl && key === 'n') {
    event.preventDefault();
    newNote();
  } else if (event.altKey && !ctrl && key === 'e') {
    event.preventDefault();
    openEventEditor();
  } else if (event.altKey && !ctrl && key === 't') {
    event.preventDefault();
    newTaskPrompt();
  } else if (event.altKey && !ctrl && VIEW_KEYS[event.key]) {
    event.preventDefault();
    setView(VIEW_KEYS[event.key]);
  } else if (ctrl && key === '\\') {
    event.preventDefault();
    toggleSidebar();
  } else if (ctrl && key === '.') {
    event.preventDefault();
    toggleInspector();
  } else if (event.key === 'Escape') {
    closeModals();
    closeDrawer();
  } else if (!typing && key === '/' && !ctrl) {
    event.preventDefault();
    openSwitcher();
  }
});

// ----- Reflet lumineux qui suit le pointeur (éléments .glow) -----

let glowFrame = 0;
document.addEventListener('pointermove', (event) => {
  const element = event.target.closest && event.target.closest('.glow');
  if (!element || glowFrame) return;
  glowFrame = requestAnimationFrame(() => {
    glowFrame = 0;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    element.style.setProperty('--my', `${event.clientY - rect.top}px`);
  });
}, { passive: true });

// Petit éclat lumineux sur un bouton important (création, enregistrement)
function burst(button) {
  if (!button) return;
  button.classList.remove('bursting');
  void button.offsetWidth; // relance l'animation
  button.classList.add('bursting');
}

// ----- En ligne / hors ligne -----

function renderOnline() {
  const online = navigator.onLine;
  $('sync-status').classList.toggle('offline', !online);
  $('sync-text').textContent = online ? 'Enregistré sur cet appareil' : 'Hors ligne · tes notes restent enregistrées';
}
window.addEventListener('online', renderOnline);
window.addEventListener('offline', renderOnline);

// ----- Petit message en bas de l'écran -----

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3600);
}

// Le démarrage est dans start.js, une fois tous les fichiers chargés.
