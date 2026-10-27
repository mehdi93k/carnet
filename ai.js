// ===== Assistant IA : résumer, expliquer, réviser avec Claude =====
//
// Le site ne contient aucune clé secrète. Il envoie le texte choisi à ton propre
// serveur (adresse dans les Paramètres, voir server/carnet-ia/LISEZMOI.md), qui
// ajoute la clé et interroge Claude. Sans serveur, l'assistant reste éteint :
// aucune réponse n'est inventée.
//
// Règles : rien ne part sans un clic, l'accord est demandé la première fois,
// et seul le texte choisi (une note ou une sélection) est envoyé.

const AI_MAX_TEXT = 20000;
const AI_TIMEOUT_MS = 90000;

const AI_ACTIONS = [
  { id: 'resumer', label: 'Résumer', icon: 'list-collapse' },
  { id: 'expliquer', label: 'Expliquer simplement', icon: 'lightbulb' },
  { id: 'fiche', label: 'Créer une fiche', icon: 'notebook-tabs' },
  { id: 'flashcards', label: 'Générer des flashcards', icon: 'layers' },
  { id: 'corriger', label: 'Corriger', icon: 'spell-check' },
  { id: 'reformuler', label: 'Reformuler', icon: 'wand-sparkles' },
  { id: 'questions', label: 'Questions d’entraînement', icon: 'circle-help' },
  { id: 'extraire', label: 'Notions, dates, formules', icon: 'scan-search' },
  { id: 'organiser', label: 'Organiser en parties', icon: 'list-tree' },
  { id: 'taches', label: 'Devoirs → tâches', icon: 'list-checks' },
];
const actionLabel = (id) => (id === 'question' ? 'Réponse à ta question' : (AI_ACTIONS.find((a) => a.id === id) || {}).label || 'Assistant');

const AI_ERRORS = {
  origin: 'Le serveur IA refuse cette adresse de site. Ajoute-la à ALLOWED_ORIGINS dans wrangler.toml.',
  code: 'Code d’accès incorrect. Vérifie-le dans les Paramètres.',
  config: 'Le serveur IA n’a pas de clé API. Ajoute-la avec « npx wrangler secret put ANTHROPIC_API_KEY ».',
  key: 'La clé API du serveur est refusée par Anthropic. Crée une nouvelle clé et remplace-la.',
  rate: 'Trop de demandes en peu de temps. Attends quelques minutes.',
  busy: 'Claude est très demandé en ce moment. Réessaie dans une minute.',
  too_long: 'Texte trop long pour une seule demande (20 000 caractères au maximum) : sélectionne une partie.',
  empty: 'Il n’y a pas de texte à envoyer.',
  question: 'Écris ta question.',
  refusal: 'Claude a refusé de répondre à cette demande.',
  format: 'La réponse n’était pas dans le bon format. Réessaie.',
};

let aiSource = 'note';     // la page Assistant travaille sur une note ou sur un texte collé
let aiNoteId = null;       // la note choisie sur la page
let aiController = null;   // permet d'annuler la demande en cours
let aiPageResult = null;   // le dernier résultat affiché sur la page

const aiReady = () => Boolean(settings.aiUrl);

// ----- Texte Markdown simple -> HTML (le texte est d'abord échappé : rien n'est exécuté) -----

function inlineMd(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function mdToHtml(markdown) {
  const out = [];
  let list = null; // 'ul' ou 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  String(markdown).split('\n').forEach((raw) => {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { closeList(); return; }
    if ((m = line.match(/^#{3,}\s+(.*)/))) { closeList(); out.push(`<h3>${inlineMd(m[1])}</h3>`); return; }
    if ((m = line.match(/^#{1,2}\s+(.*)/))) { closeList(); out.push(`<h2>${inlineMd(m[1])}</h2>`); return; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inlineMd(m[1])}</li>`);
      return;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inlineMd(m[1])}</li>`);
      return;
    }
    closeList();
    out.push(`<p>${inlineMd(line)}</p>`);
  });
  closeList();
  return out.join('');
}

// ----- Envoi au serveur -----

async function callAi(payload, signal) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.aiCode) headers['X-Carnet-Code'] = settings.aiCode;
  let response;
  try {
    response = await fetch(settings.aiUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal });
  } catch (error) {
    // Demande annulée : par le bouton « Annuler », ou parce qu'elle a pris trop de temps
    if (signal && signal.aborted) throw new Error(signal.reason === 'timeout' ? 'La réponse prend trop de temps. Réessaie avec un texte plus court.' : 'cancelled');
    throw new Error(navigator.onLine ? 'Impossible de joindre le serveur IA. Vérifie son adresse dans les Paramètres.' : 'Pas de connexion Internet : l’assistant en a besoin.');
  }
  let data = {};
  try { data = await response.json(); } catch (error) { /* réponse vide */ }
  if (!response.ok) throw new Error(AI_ERRORS[data.error] || `Le serveur IA a répondu une erreur (${response.status}).`);
  return data;
}

// Lance une action. target : l'élément où afficher l'attente puis le résultat.
// context : { text, question, noteId, fromSelection }
async function runAi(action, context, target) {
  if (!aiReady()) {
    setView('ai');
    return;
  }
  const text = (context.text || '').trim();
  if (!text) {
    renderAiError(target, 'Il n’y a pas de texte à envoyer : écris quelque chose ou choisis une autre note.');
    return;
  }
  if (text.length > AI_MAX_TEXT) {
    renderAiError(target, `Texte trop long (${text.length.toLocaleString('fr-FR')} caractères, 20 000 au maximum) : sélectionne une partie.`);
    return;
  }

  // Première fois : on explique ce qui part, et on demande l'accord
  if (!settings.aiConsent) {
    const ok = await askAiConsent(target, text.length);
    if (!ok) return;
  }

  if (aiController) aiController.abort('replaced');
  const controller = new AbortController();
  aiController = controller;
  const timer = setTimeout(() => controller.abort('timeout'), AI_TIMEOUT_MS);
  renderAiLoading(target, action);

  try {
    const data = await callAi({ action, text, question: context.question || '', today: todayYmd() }, controller.signal);
    const result = { action, ...context, text: data.text || '', data: data.data || null, truncated: data.truncated, model: data.model };
    if (target === $('ai-result')) aiPageResult = result;
    renderAiResult(target, result);
  } catch (error) {
    if (error.message !== 'cancelled') renderAiError(target, error.message);
  } finally {
    clearTimeout(timer);
    if (aiController === controller) aiController = null;
  }
}

function askAiConsent(target, length) {
  return new Promise((resolve) => {
    target.innerHTML = `
      <div class="ai-consent">
        <p><strong>Avant le premier envoi</strong></p>
        <p>Le texte choisi (${length.toLocaleString('fr-FR')} caractères) va être envoyé à ton serveur IA, puis à Claude, l’IA d’Anthropic, pour préparer la réponse.
           Rien d’autre ne part : ni tes autres notes, ni tes fichiers.</p>
        <label class="toggle"><input type="checkbox" id="ai-consent-remember" checked><span class="toggle-track" aria-hidden="true"></span>Ne plus me demander sur cet appareil</label>
        <div class="row-actions">
          <button class="btn btn-primary" id="ai-consent-ok"><i data-lucide="send-horizontal"></i><span>Envoyer</span></button>
          <button class="pill-btn" id="ai-consent-no">Annuler</button>
        </div>
      </div>`;
    refreshIcons();
    target.querySelector('#ai-consent-ok').addEventListener('click', () => {
      if (target.querySelector('#ai-consent-remember').checked) {
        settings.aiConsent = true;
        saveSettings();
      }
      resolve(true);
    });
    target.querySelector('#ai-consent-no').addEventListener('click', () => {
      renderAiEmpty(target);
      resolve(false);
    });
  });
}

// ----- Affichage des états -----

function renderAiEmpty(target) {
  if (target === $('ai-result')) {
    target.innerHTML = `
      <div class="empty-state">
        <strong>La réponse s’affichera ici</strong>
        Choisis une note (ou colle un texte), puis une action. Tu pourras copier la réponse, l’ajouter à ta note ou en faire une nouvelle note.
      </div>`;
  } else {
    closeModals();
  }
}

function renderAiLoading(target, action) {
  target.innerHTML = `
    <div class="loading" role="status">
      <div class="loading-label"><span class="spinner" aria-hidden="true"></span>${esc(actionLabel(action))} en cours… Claude lit ton texte.</div>
      <div class="loading-line"></div><div class="loading-line"></div><div class="loading-line"></div>
      <div class="row-actions"><button class="pill-btn" data-ai="cancel">Annuler</button></div>
    </div>`;
}

function renderAiError(target, message) {
  target.innerHTML = `
    <div class="empty-state">
      <strong>Pas de réponse</strong>
      <p class="form-error">${esc(message)}</p>
    </div>`;
}

function renderAiResult(target, result) {
  const source = noteTitle(result.noteId);
  let body;
  let actions;
  if (result.action === 'flashcards') {
    const cards = (result.data && Array.isArray(result.data.cards) ? result.data.cards : []).filter((c) => c.front && c.back);
    result.items = cards;
    body = cards.length
      ? `<div class="ai-cards">${cards.map((c) => `<div class="ai-card"><b>${esc(c.front)}</b><span>${esc(c.back)}</span></div>`).join('')}</div>`
      : '<p class="muted">Aucune carte n’a pu être créée à partir de ce texte.</p>';
    actions = cards.length ? `<button class="btn btn-primary" data-ai="add-cards"><i data-lucide="layers"></i><span>Ajouter ${plural(cards.length, 'carte')} aux révisions</span></button>` : '';
  } else if (result.action === 'taches') {
    const tasks = (result.data && Array.isArray(result.data.tasks) ? result.data.tasks : []).filter((t) => t.title);
    result.items = tasks;
    body = tasks.length
      ? `<ul class="task-list compact">${tasks.map((t) => `<li class="task"><span class="check" aria-hidden="true"></span><span class="task-title">${esc(t.title)}</span>${isValidYmd(t.due) ? `<span class="due">${esc(relativeDay(t.due))}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Aucune tâche trouvée dans ce texte.</p>';
    actions = tasks.length ? `<button class="btn btn-primary" data-ai="add-tasks"><i data-lucide="list-checks"></i><span>Ajouter ${plural(tasks.length, 'tâche')}</span></button>` : '';
  } else {
    body = `<div class="ai-output">${mdToHtml(result.text)}</div>`;
    const replace = result.fromSelection && ['corriger', 'reformuler'].includes(result.action)
      ? '<button class="btn btn-primary" data-ai="replace"><i data-lucide="replace"></i><span>Remplacer la sélection</span></button>' : '';
    const insert = result.noteId
      ? `<button class="${replace ? 'pill-btn' : 'btn btn-primary'}" data-ai="insert"><i data-lucide="corner-down-left"></i><span>${result.fromSelection ? 'Insérer dans la note' : `Ajouter à la fin de « ${esc(source)} »`}</span></button>` : '';
    actions = `${replace}${insert}<button class="pill-btn" data-ai="new-note"><i data-lucide="file-plus"></i>Nouvelle note</button>`;
  }

  target.innerHTML = `
    <div class="ai-result-head"><i data-lucide="sparkles"></i><h3 class="panel-title">${esc(actionLabel(result.action))}${source ? ` · ${esc(source)}` : ''}</h3></div>
    ${result.truncated ? '<p class="notice"><i data-lucide="scissors"></i><span>La réponse a été coupée car elle était très longue.</span></p>' : ''}
    ${body}
    <div class="ai-result-actions">
      ${actions}
      <button class="pill-btn" data-ai="copy"><i data-lucide="copy"></i>Copier</button>
    </div>
    <p class="muted">Réponse générée par IA${result.model ? ` (${esc(result.model)})` : ''} : vérifie-la avant de l’apprendre.</p>`;
  target.aiResult = result;
  refreshIcons();
}

// Le texte brut d'un résultat, pour le copier
function resultAsText(result) {
  if (result.action === 'flashcards') return (result.items || []).map((c) => `${c.front} :: ${c.back}`).join('\n');
  if (result.action === 'taches') return (result.items || []).map((t) => `- ${t.title}${t.due ? ` (${t.due})` : ''}`).join('\n');
  return result.text;
}

async function onResultAction(event) {
  const button = event.target.closest('[data-ai]');
  if (!button) return;
  const target = event.currentTarget;
  const result = target.aiResult;
  const kind = button.dataset.ai;

  if (kind === 'cancel') {
    if (aiController) aiController.abort('cancel');
    renderAiEmpty(target);
    return;
  }
  if (!result) return;

  if (kind === 'copy') {
    try {
      await navigator.clipboard.writeText(resultAsText(result));
      toast('Réponse copiée.');
    } catch (error) {
      toast('Copie impossible ici : sélectionne le texte et copie-le à la main.');
    }
  }
  if (kind === 'add-cards') {
    const deck = noteTitle(result.noteId) || 'Assistant';
    const count = addCards(result.items, deck, result.noteId || ''); // review.js
    renderAll();
    toast(count ? `${plural(count, 'carte')} ajoutée${count > 1 ? 's' : ''} au paquet « ${deck} ».` : 'Ces cartes existent déjà.');
    burst(button);
  }
  if (kind === 'add-tasks') {
    const count = addTasks(result.items, result.noteId || ''); // tasks.js
    renderAll();
    toast(`${plural(count, 'tâche')} ajoutée${count > 1 ? 's' : ''}.`);
    burst(button);
  }
  if (kind === 'replace' || kind === 'insert') {
    const html = mdToHtml(result.text);
    const place = findPlace(result.noteId);
    if (!place) return;
    if (target === $('ai-modal-body') && noteId === result.noteId) {
      // Depuis la note ouverte : à la place de la sélection, ou au curseur
      closeModals();
      if (kind === 'insert' && savedRange) savedRange.collapse(false);
      insertHtmlAtCursor(html);
    } else {
      place.note.html += html;
      place.note.updated = Date.now();
      save();
      renderAll();
    }
    toast(kind === 'replace' ? 'Sélection remplacée.' : `Ajouté à « ${place.note.title || 'Sans titre'} ».`);
  }
  if (kind === 'new-note') {
    const sourcePlace = result.noteId ? findPlace(result.noteId) : null;
    const title = `${actionLabel(result.action)}${sourcePlace ? ` – ${sourcePlace.note.title || 'Sans titre'}` : ''}`;
    closeModals();
    createNoteWithContent(title, mdToHtml(result.text), sourcePlace ? { cat: sourcePlace.cat, sub: sourcePlace.sub } : placeNamed('Assistant', 'Réponses'));
    toast('Nouvelle note créée avec la réponse.');
  }
}

$('ai-result').addEventListener('click', onResultAction);
$('ai-modal-body').addEventListener('click', onResultAction);

// ----- Page « Assistant IA » -----

function noteTextForAi(id) {
  const place = findPlace(id);
  if (!place) return '';
  return `${place.note.title || 'Sans titre'}\n\n${plainText(place.note.html).replace(/\n{3,}/g, '\n\n').trim()}`;
}

function renderAiPage() {
  const ready = aiReady();
  $('ai-status').textContent = ready ? 'Branché' : 'Pas encore branché';
  $('ai-status').className = `status-pill ${ready ? 'on' : 'off'}`;
  $('ai-setup').hidden = ready;
  $('ai-main').hidden = !ready;
  if (!ready) {
    renderAiSetup();
    return;
  }

  // Par défaut : la note ouverte, sinon la plus récente
  if (!aiNoteId || !findPlace(aiNoteId)) {
    const recent = state.recent.find((id) => findPlace(id)) || (allNotes()[0] && allNotes()[0].note.id);
    aiNoteId = noteId && findPlace(noteId) ? noteId : recent || null;
  }
  $$('#ai-source-mode [data-source]').forEach((b) => b.classList.toggle('active', b.dataset.source === aiSource));
  $('ai-note').hidden = aiSource !== 'note';
  $('ai-text').hidden = aiSource !== 'text';
  $('ai-note').innerHTML = noteOptionsHtml(aiNoteId, null) || '<option value="">Aucune note</option>';
  updateAiCount();

  $('ai-actions').innerHTML = AI_ACTIONS.map((a) => `
    <button class="ai-action" data-action="${a.id}"><i data-lucide="${a.icon}"></i><span>${a.label}</span></button>`).join('');

  const target = $('ai-result');
  if (aiPageResult && !aiController) renderAiResult(target, aiPageResult);
  else if (!aiController) renderAiEmpty(target);
  refreshIcons();
}

function updateAiCount() {
  const text = aiSource === 'note' ? noteTextForAi($('ai-note').value) : $('ai-text').value;
  const n = text.trim().length;
  $('ai-count').textContent = n > AI_MAX_TEXT
    ? `${n.toLocaleString('fr-FR')} caractères : trop long, 20 000 au maximum.`
    : `${n.toLocaleString('fr-FR')} caractères seront envoyés.`;
}

function renderAiSetup() {
  $('ai-setup').innerHTML = `
    <h2 class="panel-title">L’assistant n’est pas encore branché</h2>
    <p class="muted">Pour parler à Claude, Carnet a besoin d’un petit serveur à toi, qui garde la clé secrète (elle n’est jamais dans le site).
       L’hébergement est gratuit ; seules les réponses de l’IA sont payantes, à l’usage (de moins d’un centime à quelques centimes par demande).</p>
    <ol>
      <li>Crée une clé API sur <strong>console.anthropic.com</strong> et fixe une limite de dépense.</li>
      <li>Mets en ligne le serveur fourni avec Carnet (dossier <code>server/carnet-ia</code>, guide <code>LISEZMOI.md</code>) sur Cloudflare Workers.</li>
      <li>Colle son adresse ici :</li>
    </ol>
    <form class="ai-ask" id="ai-setup-form">
      <input class="input mono" id="ai-setup-url" type="url" inputmode="url" placeholder="https://carnet-ia.ton-compte.workers.dev" aria-label="Adresse du serveur IA">
      <button class="btn btn-primary" type="submit" aria-label="Brancher"><i data-lucide="plug"></i></button>
    </form>
    <p class="form-error" id="ai-setup-error" hidden></p>
    <p class="muted">Tant que ce n’est pas fait, l’assistant reste éteint : aucune réponse n’est inventée.</p>`;
  $('ai-setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    connectAi($('ai-setup-url').value, settings.aiCode, $('ai-setup-error'));
  });
  refreshIcons();
}

// Vérifie l'adresse (et le code), puis la garde
async function connectAi(url, code, errorBox) {
  const clean = String(url).trim().replace(/\/+$/, '');
  let parsed = null;
  try { parsed = new URL(clean); } catch (error) { /* invalide */ }
  const local = parsed && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (!parsed || (parsed.protocol !== 'https:' && !local)) {
    errorBox.hidden = false;
    errorBox.textContent = 'Adresse invalide : elle doit commencer par https://';
    return false;
  }
  const previous = { aiUrl: settings.aiUrl, aiCode: settings.aiCode };
  settings.aiUrl = clean;
  settings.aiCode = code;
  errorBox.hidden = false;
  errorBox.textContent = 'Vérification…';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), 15000);
    const data = await callAi({ action: 'ping' }, controller.signal);
    clearTimeout(timer);
    saveSettings();
    errorBox.hidden = true;
    toast(`Assistant branché (${data.model || 'Claude'}).`);
    renderAll();
    return true;
  } catch (error) {
    Object.assign(settings, previous);
    errorBox.textContent = error.message === 'cancelled' ? 'Le serveur ne répond pas.' : error.message;
    return false;
  }
}

$('ai-source-mode').addEventListener('click', (event) => {
  const button = event.target.closest('[data-source]');
  if (!button) return;
  aiSource = button.dataset.source;
  renderAiPage();
  if (aiSource === 'text') $('ai-text').focus();
});
$('ai-note').addEventListener('change', (event) => { aiNoteId = event.target.value; updateAiCount(); });
$('ai-text').addEventListener('input', updateAiCount);

function aiPageContext() {
  if (aiSource === 'note') {
    const id = $('ai-note').value;
    return { text: noteTextForAi(id), noteId: id, fromSelection: false };
  }
  return { text: $('ai-text').value, noteId: '', fromSelection: false };
}

$('ai-actions').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  runAi(button.dataset.action, aiPageContext(), $('ai-result'));
});

$('ai-ask').addEventListener('submit', (event) => {
  event.preventDefault();
  const question = $('ai-question').value.trim();
  if (!question) {
    $('ai-question').focus();
    toast('Écris d’abord ta question.');
    return;
  }
  runAi('question', { ...aiPageContext(), question }, $('ai-result'));
});

// Ouvre la page Assistant sur une note (menu « … » d'une note)
function openAiForNote(id) {
  aiSource = 'note';
  aiNoteId = id;
  aiPageResult = null;
  setView('ai');
}

// Ouvre la page Assistant en mettant une action en avant (« Générer avec l'IA » des révisions)
function openAiPage(action) {
  aiPageResult = null;
  setView('ai');
  const button = document.querySelector(`#ai-actions [data-action="${action}"]`);
  if (button) {
    button.focus();
    toast('Choisis la note du cours, puis clique sur l’action en surbrillance.');
  }
}

// ----- Depuis une note : bouton « IA » de la barre d'outils -----

$('note-ai-btn').addEventListener('click', (event) => {
  const note = currentNote();
  if (!note) return;
  if (!aiReady()) {
    setView('ai');
    return;
  }
  const picked = selectedNoteText().trim();
  const context = {
    text: picked || noteTextForAi(note.id),
    noteId: note.id,
    fromSelection: Boolean(picked),
  };
  const items = AI_ACTIONS.map((a) => ({
    label: a.label, icon: a.icon,
    run: () => {
      $('ai-modal-title').textContent = `${a.label}${picked ? ' · sélection' : ''}`;
      openModal('ai-modal');
      runAi(a.id, context, $('ai-modal-body'));
    },
  }));
  items.push('sep', {
    label: 'Poser une question…', icon: 'message-circle-question',
    run: async () => {
      const question = await askText(picked ? 'Ta question sur le texte sélectionné ?' : 'Ta question sur cette note ?');
      if (!question) return;
      $('ai-modal-title').textContent = 'Question';
      openModal('ai-modal');
      runAi('question', { ...context, question }, $('ai-modal-body'));
    },
  });
  menuUnder(event.currentTarget, items, true);
});

// ----- Paramètres -----

function renderAiSettings() {
  $('ai-url').value = settings.aiUrl;
  $('ai-code').value = settings.aiCode;
  $('ai-consent-reset').hidden = !settings.aiConsent;
  $('ai-url-error').hidden = true;
}

$('ai-save').addEventListener('click', async () => {
  const url = $('ai-url').value.trim();
  if (!url) {
    settings.aiUrl = '';
    settings.aiCode = '';
    saveSettings();
    toast('Assistant débranché.');
    renderAll();
    return;
  }
  await connectAi(url, $('ai-code').value.trim(), $('ai-url-error'));
});

$('ai-consent-reset').addEventListener('click', () => {
  settings.aiConsent = false;
  saveSettings();
  renderAiSettings();
  toast('Ton accord sera redemandé avant le prochain envoi.');
});
