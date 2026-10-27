// ===== Schémas : des cartes reliées entre elles, un tableau par note =====
//
// note.schema = { cards: [{ id, x, y, w, text }], links: [{ from, to }] }
// Les cartes se glissent par leur barre du haut. « Relier » permet de tracer
// une flèche entre deux cartes (clic sur la première, puis sur la seconde).

const CARD_HEIGHT = 84; // hauteur approximative d'une carte, pour centrer les liens

let boardSelected = null; // carte sélectionnée
let linkMode = false;     // mode « Relier » activé ?
let linkFrom = null;      // première carte choisie en mode « Relier »

// Centre d'une carte, utilisé pour tracer les liens
const cardCenter = (card) => [card.x + card.w / 2, card.y + CARD_HEIGHT / 2];

// Dessine toutes les cartes et tous les liens de la note ouverte
function renderBoard() {
  const note = currentNote();
  if (!note) return;
  const { cards } = note.schema;

  $('board').innerHTML = `
    <svg class="board-links" id="board-links" aria-hidden="true"></svg>
    ${cards.map((card) => `
      <div class="card-box ${card.id === boardSelected ? 'selected' : ''} ${card.id === linkFrom ? 'link-source' : ''}"
           data-card="${card.id}" style="left:${card.x}px;top:${card.y}px;width:${card.w}px">
        <div class="card-grip" title="Glisser la carte"></div>
        <div class="card-text" contenteditable="true" spellcheck="false" data-placeholder="Écris ici…">${esc(card.text)}</div>
      </div>`).join('')}`;

  drawLinks();
  $('board').classList.toggle('linking', linkMode);
  $('schema-link').classList.toggle('active', linkMode);
  $('schema-link').setAttribute('aria-pressed', String(linkMode));
  $('schema-hint').textContent = linkMode
    ? 'Clique la première carte, puis la seconde.'
    : 'Glisse une carte par sa barre du haut. Clique son texte pour l’écrire.';
}

// Dessine les flèches entre les cartes reliées
function drawLinks() {
  const note = currentNote();
  const svg = $('board-links');
  if (!note || !svg) return;

  const byId = new Map(note.schema.cards.map((card) => [card.id, card]));
  svg.innerHTML = note.schema.links.map(({ from, to }) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) return '';
    const [x1, y1] = cardCenter(a);
    const [x2, y2] = cardCenter(b);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join('');
}

// Ajoute une carte, décalée pour ne pas tomber sur les autres
$('schema-add').addEventListener('click', () => {
  const note = currentNote();
  if (!note) return;
  const n = note.schema.cards.length;
  const card = {
    id: uid(),
    x: 36 + (n % 4) * 230,
    y: 36 + Math.floor(n / 4) * 130,
    w: 200,
    text: '',
  };
  note.schema.cards.push(card);
  boardSelected = card.id;
  touch(note);
  renderBoard();
  const text = $('board').querySelector(`[data-card="${card.id}"] .card-text`);
  if (text) text.focus();
});

$('schema-link').addEventListener('click', () => {
  linkMode = !linkMode;
  linkFrom = null;
  renderBoard();
});

// Supprime la carte sélectionnée, et les liens qui la touchent
function deleteSelectedCard() {
  const note = currentNote();
  if (!note || !boardSelected) return;
  note.schema.cards = note.schema.cards.filter((card) => card.id !== boardSelected);
  note.schema.links = note.schema.links.filter((link) => link.from !== boardSelected && link.to !== boardSelected);
  boardSelected = null;
  touch(note);
  renderBoard();
}

$('schema-delete').addEventListener('click', deleteSelectedCard);

// Touche Suppr : efface la carte sélectionnée (sauf si on écrit dans une carte)
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Delete' || activeTab !== 'schema' || !boardSelected) return;
  if (event.target.closest('[contenteditable]')) return;
  deleteSelectedCard();
});

// Clic sur le tableau : sélection, liens ou déplacement
$('board').addEventListener('pointerdown', (event) => {
  const note = currentNote();
  if (!note) return;
  const box = event.target.closest('.card-box');

  // Clic dans le vide : on désélectionne
  if (!box) {
    boardSelected = null;
    linkFrom = null;
    renderBoard();
    return;
  }

  const card = note.schema.cards.find((c) => c.id === box.dataset.card);
  if (!card) return;

  // Mode « Relier » : on choisit deux cartes
  if (linkMode && !event.target.closest('.card-text')) {
    chooseForLink(note, card);
    return;
  }

  boardSelected = card.id;
  if (event.target.closest('.card-grip')) {
    startDrag(event, note, card, box);
  } else {
    document.querySelectorAll('.card-box.selected').forEach((el) => el.classList.remove('selected'));
    box.classList.add('selected');
  }
});

function chooseForLink(note, card) {
  if (!linkFrom) {
    linkFrom = card.id;
  } else {
    const exists = note.schema.links.some((link) => link.from === linkFrom && link.to === card.id);
    if (linkFrom !== card.id && !exists) {
      note.schema.links.push({ from: linkFrom, to: card.id });
      touch(note);
    }
    linkFrom = null;
  }
  renderBoard();
}

// Glisser une carte : on suit la souris, puis on sauvegarde à la fin
function startDrag(event, note, card, box) {
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = card.x;
  const originY = card.y;

  const move = (e) => {
    card.x = Math.max(0, originX + e.clientX - startX);
    card.y = Math.max(0, originY + e.clientY - startY);
    box.style.left = `${card.x}px`;
    box.style.top = `${card.y}px`;
    drawLinks();
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    touch(note);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Écrire dans une carte : on sauvegarde sans redessiner (sinon le curseur sauterait)
$('board').addEventListener('input', (event) => {
  const text = event.target.closest('.card-text');
  const note = currentNote();
  if (!text || !note) return;
  const card = note.schema.cards.find((c) => c.id === text.closest('[data-card]').dataset.card);
  if (!card) return;
  card.text = text.innerText;
  touch(note);
});
