// ===== Fichiers, pièces jointes et scanner de documents =====
//
// Les fichiers sont rangés dans IndexedDB, une base du navigateur qui accepte
// de gros fichiers (localStorage, lui, est limité à quelques Mo).
// La note ne garde que la liste : nom, type, taille et identifiant.

// ----- Stockage des fichiers -----

const FileStore = (() => {
  let dbPromise = null;

  // Ouvre la base une seule fois
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('carnet-files', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  // Lance une opération sur la table « files » et attend qu'elle soit finie
  async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const request = action(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    put: (id, blob) => run('readwrite', (store) => store.put(blob, id)),
    get: (id) => run('readonly', (store) => store.get(id)),
    remove: (id) => run('readwrite', (store) => store.delete(id)),
  };
})();

// ----- Enregistrer un fichier -----
// Dans une page publiée, un lien de téléchargement ne marche pas : il faut passer
// par la capacité « downloads » (déclarée dans la page), qui demande l'accord de la personne.
// Hors de la page publiée, un lien de téléchargement classique suffit.

async function saveFile(file) {
  const claude = window.claude;
  if (!claude) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    return;
  }

  const downloads = await claude.use('downloads').catch(() => null);
  if (!downloads) {
    toast('Enregistrer un fichier n’est pas possible dans cette fenêtre.');
    return;
  }
  try {
    await downloads.save({ filename: file.name, data: file });
    toast(`« ${file.name} » enregistré.`);
  } catch (error) {
    const messages = {
      rejected_extension: 'Ce type de fichier ne peut pas être enregistré ici.',
      declined: 'Enregistrement annulé.',
      too_large: 'Fichier trop gros pour être enregistré ici.',
    };
    toast(messages[error.code] || 'Enregistrement impossible pour le moment.');
  }
}

// Ouvre une image dans une fenêtre d'aperçu ; les autres fichiers s'enregistrent
function openFile(file) {
  if (!file.type.startsWith('image/')) {
    saveFile(file);
    return;
  }
  $('preview-title').textContent = file.name;
  $('preview-img').src = URL.createObjectURL(file);
  $('preview-modal').hidden = false;
}

// ----- Pièces jointes -----

const fileIcon = (type) => {
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'file-text';
  return 'file';
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// Ajoute des fichiers (choisis, glissés ou scannés) à la note ouverte
async function addFiles(files) {
  const note = currentNote();
  if (!note) return;
  for (const file of files) {
    const id = uid();
    await FileStore.put(id, file);
    note.attachments.push({ id, name: file.name, type: file.type || 'application/octet-stream', size: file.size });
  }
  touch(note);
  renderFiles();
  if (files.length) toast(`${files.length} fichier${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''}.`);
}

function renderFiles() {
  const note = currentNote();
  if (!note) return;
  const list = $('file-list');

  if (note.attachments.length === 0) {
    list.innerHTML = '<li class="hint-line">Aucun fichier pour l’instant.</li>';
    return;
  }

  list.innerHTML = note.attachments.map((file) => `
    <li class="file-item" data-file="${file.id}">
      <div class="file-thumb">
        ${file.type.startsWith('image/') ? '<img alt="" class="thumb">' : `<i data-lucide="${fileIcon(file.type)}"></i>`}
      </div>
      <div class="file-info">
        <span class="file-name">${esc(file.name)}</span>
        <span class="muted">${formatSize(file.size)}</span>
      </div>
      <div class="file-actions">
        <button class="icon-btn small" data-action="open" title="Ouvrir" aria-label="Ouvrir"><i data-lucide="external-link"></i></button>
        <button class="icon-btn small" data-action="share" title="Partager" aria-label="Partager"><i data-lucide="share-2"></i></button>
        <button class="icon-btn small" data-action="download" title="Télécharger" aria-label="Télécharger"><i data-lucide="download"></i></button>
        <button class="icon-btn small danger" data-action="delete" title="Supprimer" aria-label="Supprimer"><i data-lucide="trash-2"></i></button>
      </div>
    </li>`).join('');

  refreshIcons();

  // Les images montrent leur miniature
  note.attachments.filter((file) => file.type.startsWith('image/')).forEach(async (file) => {
    const blob = await FileStore.get(file.id);
    const img = list.querySelector(`[data-file="${file.id}"] img`);
    if (blob && img) img.src = URL.createObjectURL(blob);
  });
}

// Partage natif (AirDrop, WhatsApp, Mail...) quand le navigateur le permet, sinon enregistrement
async function shareFile(file) {
  if (!window.claude && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      // la personne a annulé : rien à faire
    }
    return;
  }
  await saveFile(file);
}

$('file-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  const note = currentNote();
  if (!button || !note) return;

  const item = button.closest('[data-file]');
  const meta = note.attachments.find((file) => file.id === item.dataset.file);
  if (!meta) return;

  if (button.dataset.action === 'delete') {
    if (!(await askConfirm(`Supprimer « ${meta.name} » ?`))) return;
    await FileStore.remove(meta.id);
    note.attachments = note.attachments.filter((file) => file.id !== meta.id);
    touch(note);
    renderFiles();
    return;
  }

  const blob = await FileStore.get(meta.id);
  if (!blob) {
    toast('Fichier introuvable.');
    return;
  }
  const file = new File([blob], meta.name, { type: meta.type });

  if (button.dataset.action === 'open') openFile(file);
  if (button.dataset.action === 'download') saveFile(file);
  if (button.dataset.action === 'share') shareFile(file);
});

// Glisser-déposer et bouton « Choisir des fichiers »
const dropZone = $('drop-zone');
['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.add('over');
}));
['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, () => dropZone.classList.remove('over')));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  addFiles([...event.dataTransfer.files]);
});

$('pick-files').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (event) => {
  addFiles([...event.target.files]);
  event.target.value = '';
});

// ----- Scanner de document -----
//
// Principe : on prend une photo de la feuille, on place ses quatre coins,
// puis le programme la redresse (perspective) et la rend nette, en noir et blanc.

let scanSource = null;               // image source, réduite si elle est très grande
let corners = [];                    // les 4 coins, en proportions (0 à 1) : haut gauche, haut droit, bas droit, bas gauche
let draggedCorner = -1;

// Pas de flux vidéo ici : la photo passe par l'appareil photo du téléphone
// (ou un fichier image), ce qui marche dans une page publiée.
function openScan() {
  if (!currentNote()) {
    toast('Ouvre une note avant de scanner.');
    return;
  }
  $('scan-modal').hidden = false;
  showScanStep('camera');
}

function showScanStep(step) {
  $('scan-camera').hidden = step !== 'camera';
  $('scan-crop').hidden = step !== 'crop';
}

// Charge une photo choisie sur l'appareil
function usePhoto(file) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    useCanvas(canvas);
  };
  img.src = URL.createObjectURL(file);
}

function useCanvas(canvas) {
  scanSource = limitSize(canvas, 2000); // une image trop grande ralentit le calcul
  corners = [[0.08, 0.06], [0.92, 0.06], [0.92, 0.94], [0.08, 0.94]];
  $('crop-img').src = scanSource.toDataURL('image/jpeg', 0.92);
  showScanStep('crop');
  drawCrop();
}

function limitSize(canvas, max) {
  const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  if (scale === 1) return canvas;
  const smaller = document.createElement('canvas');
  smaller.width = Math.round(canvas.width * scale);
  smaller.height = Math.round(canvas.height * scale);
  smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
  return smaller;
}

// Met à jour le cadre (polygone) et les poignées
function drawCrop() {
  $('crop-poly').setAttribute('points', corners.map(([x, y]) => `${x},${y}`).join(' '));
  document.querySelectorAll('.handle').forEach((handle, i) => {
    handle.style.left = `${corners[i][0] * 100}%`;
    handle.style.top = `${corners[i][1] * 100}%`;
  });
}

$('crop-stage').addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.handle');
  if (!handle) return;
  draggedCorner = Number(handle.dataset.corner);
  handle.setPointerCapture(event.pointerId);
});

$('crop-stage').addEventListener('pointermove', (event) => {
  if (draggedCorner < 0) return;
  const rect = $('crop-stage').getBoundingClientRect();
  const clamp = (v) => Math.min(1, Math.max(0, v));
  corners[draggedCorner] = [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
  drawCrop();
});

window.addEventListener('pointerup', () => { draggedCorner = -1; });

// Traitement : redressement puis noir et blanc, puis ajout à la note
function applyScan() {
  const quad = corners.map(([x, y]) => [x * scanSource.width, y * scanSource.height]);
  const page = warpToRect(scanSource, quad);
  binarize(page);
  page.toBlob(async (blob) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const file = new File([blob], `scan-${stamp}.png`, { type: 'image/png' });
    closeModals();
    await addFiles([file]);
    showTab('files');
  }, 'image/png');
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Résout un système linéaire 8×8 (élimination de Gauss)
function solve8(rows) {
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) {
      if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    }
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const factor = rows[r][c] / rows[c][c];
      for (let k = c; k < 9; k++) rows[r][k] -= factor * rows[c][k];
    }
  }
  return rows.map((row, i) => row[8] / row[i]);
}

// Trouve la transformation qui envoie 4 points « from » sur 4 points « to »
function solveHomography(from, to) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  return solve8(rows);
}

// Applique la transformation à un point
function mapPoint(h, x, y) {
  const d = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

// Redresse la zone délimitée par quad (haut gauche, haut droit, bas droit, bas gauche)
function warpToRect(source, quad) {
  const [tl, tr, br, bl] = quad;
  const w = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const h = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  // Pour chaque pixel de la page redressée, on cherche le pixel correspondant dans la photo
  const H = solveHomography([[0, 0], [w, 0], [w, h], [0, h]], quad);

  const srcData = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  const image = ctx.createImageData(w, h);
  const dst = image.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [u, v] = mapPoint(H, x, y);
      const sx = Math.min(source.width - 1, Math.max(0, Math.round(u)));
      const sy = Math.min(source.height - 1, Math.max(0, Math.round(v)));
      const s = (sy * source.width + sx) * 4;
      const d = (y * w + x) * 4;
      dst[d] = srcData[s];
      dst[d + 1] = srcData[s + 1];
      dst[d + 2] = srcData[s + 2];
      dst[d + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

// Noir et blanc « façon scanner » : chaque pixel est comparé à la moyenne de son voisinage.
// Les zones sombres (l'encre) deviennent noires, le papier reste blanc, même si la lumière varie.
function binarize(canvas) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  // Niveaux de gris
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  }

  // Image intégrale : permet de calculer la moyenne d'une zone en 4 opérations
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += gray[(y - 1) * w + (x - 1)];
      integral[y * W + x] = integral[(y - 1) * W + x] + rowSum;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(w, h) / 40));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + radius + 1);
      const area = (x1 - x0) * (y1 - y0);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const value = gray[y * w + x] < sum / area - 12 ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = value;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// Une photo, qu'elle vienne de l'appareil photo ou d'un fichier, suit le même chemin
function bindPhotoInput(inputId) {
  $(inputId).addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) usePhoto(file);
    event.target.value = '';
  });
}

$('scan-btn').addEventListener('click', openScan);
$('scan-capture').addEventListener('click', () => $('camera-input').click());
$('scan-photo-btn').addEventListener('click', () => $('photo-input').click());
bindPhotoInput('camera-input');
bindPhotoInput('photo-input');
$('scan-retake').addEventListener('click', () => showScanStep('camera'));
$('scan-apply').addEventListener('click', applyScan);
