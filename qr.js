// ===== QR code : envoyer une note vers un autre appareil =====
//
// Le QR code contient le texte de la note, précédé de « carnet: » et encodé.
// Sur l'autre appareil, on prend le QR code en photo : le téléphone affiche le
// texte, on le copie, puis on le colle dans « Recevoir une note ».
// Limite : seul le texte passe (ni fichiers, ni schéma), et la note doit être courte.
// Pas de lien ni de caméra en direct : une page publiée ne peut pas les utiliser
// de façon fiable, donc on passe par des photos.

const QR_PREFIX = 'carnet:';
const QR_MAX_LENGTH = 2300; // au-delà, le QR code devient trop dense pour être lu

// Encode du texte (accents compris) en base64 : que des caractères simples
function encodePayload(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodePayload(payload) {
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ----- Créer le QR code d'une note -----

function openQr() {
  const note = currentNote();
  if (!note) return;
  $('qr-modal').hidden = false;
  buildQr(note);
}

function buildQr(note) {
  const box = $('qr-box');
  box.innerHTML = '';

  const text = `${QR_PREFIX}${encodePayload(JSON.stringify({ t: note.title || 'Sans titre', x: plainText(note.html) }))}`;
  const tooLong = text.length > QR_MAX_LENGTH;
  $('qr-warning').hidden = !tooLong;
  $('qr-warning').textContent = tooLong
    ? `Note trop longue pour un QR code (${text.length} caractères, ${QR_MAX_LENGTH} au maximum). Raccourcis-la.`
    : '';
  if (tooLong) return;

  new QRCode(box, { text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.L });
}

$('qr-btn').addEventListener('click', openQr);

// ----- Recevoir une note -----

// Ajoute la note reçue dans la sous-catégorie ouverte (ou la première disponible)
async function importNote(data) {
  const title = data.t || 'Note reçue';
  if (!(await askConfirm(`Ajouter la note « ${title} » ?`, 'Ajouter'))) return;

  let place = currentSub() ? { cat: findCat(selection.cat), sub: currentSub() } : null;
  if (!place) {
    let cat = state.categories.find((c) => c.subs.length);
    if (!cat) {
      cat = { id: uid(), name: 'Reçues', color: CATEGORY_COLORS[0], open: true, subs: [] };
      state.categories.push(cat);
    }
    if (!cat.subs.length) cat.subs.push({ id: uid(), name: 'Importées', notes: [] });
    place = { cat, sub: cat.subs[0] };
  }

  const html = `<p>${esc(data.x || '').replace(/\n/g, '<br>')}</p>`;
  const note = makeNote(title, html);
  place.sub.notes.push(note);
  save();
  toast(`Note « ${title} » ajoutée.`);
  openNoteAnywhere(note.id);
}

// Lit le texte d'un QR code (ou un texte collé) et importe la note
async function importFromText(text) {
  const index = text.indexOf(QR_PREFIX);
  if (index < 0) {
    toast('Ce texte ne vient pas d’une note Carnet.');
    return false;
  }
  try {
    const data = JSON.parse(decodePayload(text.slice(index + QR_PREFIX.length).trim()));
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
    toast('Lecteur de QR code non chargé : vérifie ta connexion, ou colle le texte.');
    return;
  }
  const img = new Image();
  img.onload = async () => {
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(img.src);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(pixels.data, pixels.width, pixels.height);
    if (code) {
      await importFromText(code.data);
    } else {
      toast('Aucun QR code trouvé sur cette photo. Essaie de la reprendre plus droit.');
    }
  };
  img.src = URL.createObjectURL(file);
}

$('qr-scan').addEventListener('click', () => {
  $('qr-modal').hidden = true;
  $('qr-scan-modal').hidden = false;
});

$('qr-photo-btn').addEventListener('click', () => $('qr-photo-input').click());
$('qr-photo-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) decodeQrPhoto(file);
  event.target.value = '';
});

$('qr-paste-btn').addEventListener('click', () => {
  importFromText($('qr-paste').value);
});
