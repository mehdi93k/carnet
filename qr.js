// ===== QR codes : partager une note, un lien ou un texte =====
//
// Trois sortes de QR codes :
//   - « lien » : le dessin contient une adresse web ; le contenu reste sur la page ;
//   - « texte » : le dessin contient le texte lui-même (court) ;
//   - « note » : un lien vers Carnet qui contient aussi le texte de la note, compressé,
//     après le signe # (cette partie n'est jamais envoyée à un serveur). Le téléphone
//     ouvre Carnet, qui propose d'ajouter la note. Rien n'est publié sur Internet.

const QR_LIMIT = 2600;             // au-delà, le QR code devient trop dense pour être lu
const PUBLIC_URL = 'https://mehdi93k.github.io/carnet/';
const QR_PREFIX = 'carnet:';       // ancien format (texte à coller), toujours accepté

let qrKind = null;     // note, link ou text
let qrNoteId = null;
let qrTab = 'create';
let qrPayload = '';    // ce que contient le QR code affiché
let qrTimer = null;

// ----- Encodage d'une note -----

function bytesToBase64url(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Compresse (quand le navigateur sait le faire) pour faire tenir des notes plus longues
async function packNote(note) {
  const text = plainText(note.html).replace(/\n{3,}/g, '\n\n').trim();
  const bytes = new TextEncoder().encode(JSON.stringify({ t: note.title || 'Sans titre', x: text }));
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return `z${bytesToBase64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return `b${bytesToBase64url(bytes)}`;
}

async function unpackNote(packed) {
  let bytes = base64urlToBytes(packed.slice(1));
  if (packed[0] === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('old-browser');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Adresse du site à mettre dans le QR code (le téléphone doit pouvoir l'ouvrir)
const siteUrl = () => (location.protocol === 'https:' ? location.href.split('#')[0].split('?')[0] : PUBLIC_URL);

// ----- Page « QR codes » -----

function renderQrPage() {
  $$('#qr-tabs [data-qrtab]').forEach((b) => b.classList.toggle('active', b.dataset.qrtab === qrTab));
  $('qr-create').hidden = qrTab !== 'create';
  $('qr-receive').hidden = qrTab !== 'receive';

  $$('#qr-kind [data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === qrKind)));
  $('qr-note').hidden = qrKind !== 'note';
  $('qr-link').hidden = qrKind !== 'link';
  $('qr-text').hidden = qrKind !== 'text';
  $('qr-privacy').hidden = qrKind !== 'note';
  $('qr-input-area').hidden = !qrKind;

  if (qrKind === 'note') {
    if (!qrNoteId || !findPlace(qrNoteId)) qrNoteId = (noteId && findPlace(noteId)) ? noteId : (allNotes()[0] || { note: {} }).note.id || null;
    $('qr-note').innerHTML = noteOptionsHtml(qrNoteId, null) || '<option value="">Aucune note</option>';
  }
  $('qr-share').hidden = !(navigator.canShare && navigator.share);
  buildQrPreview();
  refreshIcons();
}

function qrError(message) {
  $('qr-error').hidden = !message;
  $('qr-error').textContent = message || '';
}

function clearQrPreview(message = 'Choisis ce que tu veux partager : l’aperçu apparaît ici.') {
  $('qr-box').innerHTML = '';
  $('qr-empty').hidden = false;
  $('qr-empty').textContent = message;
  $('qr-caption').textContent = '';
  qrPayload = '';
  ['qr-download', 'qr-copy', 'qr-share'].forEach((id) => { $(id).disabled = true; });
}

// Prépare le contenu du QR code selon le choix, puis le dessine
async function buildQrPreview() {
  qrError('');
  if (!qrKind) { clearQrPreview(); return; }

  let payload = '';
  let caption = '';
  if (qrKind === 'note') {
    const place = findPlace($('qr-note').value);
    if (!place) { clearQrPreview('Crée d’abord une note.'); return; }
    payload = `${siteUrl()}#note=${await packNote(place.note)}`;
    caption = `Note « ${place.note.title || 'Sans titre'} »`;
  } else if (qrKind === 'link') {
    const value = $('qr-link').value.trim();
    if (!value) { clearQrPreview('Colle ou écris une adresse web.'); return; }
    let url = null;
    try { url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`); } catch (error) { /* invalide */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
      qrError('Ce lien n’est pas valide. Exemple : https://www.exemple.fr');
      clearQrPreview('L’aperçu apparaîtra quand le lien sera valide.');
      return;
    }
    payload = url.href;
    caption = `Lien vers ${url.hostname}`;
  } else {
    payload = $('qr-text').value.trim();
    if (!payload) { clearQrPreview('Écris le texte à mettre dans le QR code.'); return; }
    caption = `Texte · ${plural(payload.length, 'caractère')}`;
  }

  if (payload.length > QR_LIMIT) {
    qrError(qrKind === 'note'
      ? 'Cette note est trop longue pour un QR code. Raccourcis-la, ou partage-la avec « Exporter » ou par fichier.'
      : `Trop long pour un QR code (${payload.length} caractères).`);
    clearQrPreview('Trop long pour être lu par un téléphone.');
    return;
  }
  if (typeof QRCode === 'undefined') {
    qrError('Le générateur de QR code n’a pas pu se charger. Vérifie ta connexion, puis recharge la page.');
    return;
  }

  qrPayload = payload;
  $('qr-box').innerHTML = '';
  $('qr-empty').hidden = true;
  // Dessin en grand (net au téléchargement), affiché plus petit à l'écran
  new QRCode($('qr-box'), {
    text: payload, width: 512, height: 512, colorDark: '#0b0e22', colorLight: '#ffffff',
    correctLevel: payload.length > 900 ? QRCode.CorrectLevel.L : QRCode.CorrectLevel.M,
  });
  $('qr-caption').textContent = caption;
  ['qr-download', 'qr-copy', 'qr-share'].forEach((id) => { $(id).disabled = false; });
}

// Le QR code en image PNG, avec une marge blanche (indispensable pour qu'il soit lu)
function qrImageBlob() {
  return new Promise((resolve) => {
    const source = $('qr-box').querySelector('canvas');
    if (!source) { resolve(null); return; }
    const margin = 48;
    const out = document.createElement('canvas');
    out.width = source.width + margin * 2;
    out.height = source.height + margin * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, margin, margin);
    out.toBlob(resolve, 'image/png');
  });
}

function qrFileName() {
  const base = ($('qr-caption').textContent || 'qr-code').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `qr-${base || 'code'}.png`;
}

$('qr-download').addEventListener('click', async () => {
  const blob = await qrImageBlob();
  if (!blob) return;
  saveFile(new File([blob], qrFileName(), { type: 'image/png' })); // files.js
  toast('QR code téléchargé.');
});

$('qr-copy').addEventListener('click', async () => {
  const blob = await qrImageBlob();
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copiée : colle-la dans un message ou un document.');
  } catch (error) {
    toast('Copie d’image impossible dans ce navigateur : utilise « Télécharger ».');
  }
});

$('qr-share').addEventListener('click', async () => {
  const blob = await qrImageBlob();
  const file = new File([blob], qrFileName(), { type: 'image/png' });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    toast('Partage impossible ici : utilise « Télécharger ».');
    return;
  }
  try {
    await navigator.share({ files: [file], title: $('qr-caption').textContent });
  } catch (error) { /* partage annulé */ }
});

$('qr-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-qrtab]');
  if (!button) return;
  qrTab = button.dataset.qrtab;
  renderQrPage();
});

$('qr-kind').addEventListener('click', (event) => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  qrKind = button.dataset.kind;
  renderQrPage();
  const input = { link: 'qr-link', text: 'qr-text', note: 'qr-note' }[qrKind];
  $(input).focus();
});

$('qr-note').addEventListener('change', (event) => { qrNoteId = event.target.value; buildQrPreview(); });
// Aperçu immédiat pendant la frappe (avec un petit délai pour ne pas redessiner à chaque lettre)
['qr-link', 'qr-text'].forEach((id) => $(id).addEventListener('input', () => {
  clearTimeout(qrTimer);
  qrTimer = setTimeout(buildQrPreview, 250);
}));

// Ouvre la page sur une note (bouton QR de la note, menu « … »)
function openQrForNote(id) {
  qrKind = 'note';
  qrNoteId = id;
  qrTab = 'create';
  setView('qr');
}
$('qr-btn').addEventListener('click', () => { if (noteId) openQrForNote(noteId); });

// ----- Recevoir une note -----

// Ajoute la note reçue dans le dossier « Reçues »
async function importNote(data) {
  const title = String(data.t || 'Note reçue').slice(0, 200);
  if (!(await askConfirm(`Ajouter la note « ${title} » reçue par QR code ?`, 'Ajouter'))) return;
  const html = String(data.x || '').split('\n').map((line) => `<p>${esc(line) || '<br>'}</p>`).join('');
  createNoteWithContent(title, html, placeNamed('Reçues', 'QR codes'));
  toast(`Note « ${title} » ajoutée dans Reçues.`);
}

// Ouverture de Carnet par un QR code « note » : …/carnet/#note=…
async function importFromHash(packed) {
  try {
    await importNote(await unpackNote(packed));
  } catch (error) {
    toast(error.message === 'old-browser'
      ? 'Ce navigateur est trop ancien pour lire cette note. Mets-le à jour, ou ouvre le lien dans Chrome ou Safari.'
      : 'Ce QR code ne contient pas une note lisible.');
  }
}

// Lit le texte d'un QR code : lien « #note= », ou ancien format « carnet: »
async function importFromText(text) {
  const value = String(text || '').trim();
  const hash = value.indexOf('#note=');
  if (hash >= 0) {
    closeModals();
    await importFromHash(value.slice(hash + 6));
    return true;
  }
  const index = value.indexOf(QR_PREFIX);
  if (index < 0) {
    if (/^https?:\/\//.test(value)) toast(`Ce QR code contient un lien : ${value.slice(0, 80)}`);
    else toast('Ce QR code ne vient pas d’une note Carnet.');
    return false;
  }
  try {
    const bytes = Uint8Array.from(atob(value.slice(index + QR_PREFIX.length).trim()), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    closeModals();
    await importNote(data);
    return true;
  } catch (error) {
    toast('Ce texte ne contient pas une note lisible.');
    return false;
  }
}

// Décode un QR code à partir d'une photo (jsQR lit l'image, rien ne part en ligne)
function decodeQrPhoto(file) {
  if (typeof jsQR === 'undefined') {
    toast('Lecteur de QR code non chargé : vérifie ta connexion.');
    return;
  }
  const img = new Image();
  img.onload = async () => {
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(img.src);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(pixels.data, pixels.width, pixels.height);
    if (code) await importFromText(code.data);
    else toast('Aucun QR code trouvé sur cette photo. Reprends-la plus droite et plus près.');
  };
  img.onerror = () => toast('Cette image ne peut pas être lue.');
  img.src = URL.createObjectURL(file);
}

$('qr-photo-btn').addEventListener('click', () => $('qr-photo-input').click());
$('qr-photo-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) decodeQrPhoto(file);
  event.target.value = '';
});

$('qr-paste-btn').addEventListener('click', () => {
  importFromText($('qr-paste').value);
});
