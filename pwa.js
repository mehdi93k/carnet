// ===== Installer Carnet comme une application (PWA) =====
//
// Chrome, Edge et Android proposent un vrai bouton « Installer » (événement beforeinstallprompt).
// Safari (iPhone, iPad, Mac) et Firefox n'en ont pas : on affiche les étapes à suivre.
// Le service worker (sw.js) garde une copie des fichiers du site pour qu'il s'ouvre hors ligne.
// Les notes, elles, ne sont jamais dans ce cache : elles restent dans le stockage du navigateur.

let installPrompt = null;

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const platform = (() => {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return /Firefox/i.test(ua) ? 'android-firefox' : 'android';
  if (/Firefox/i.test(ua)) return 'firefox';
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return 'mac-safari';
  return 'desktop';
})();

// Le bouton du menu n'apparaît que si l'installation est possible ici
function renderInstallButtons() {
  const installed = isStandalone();
  $('install-btn').hidden = installed || !(installPrompt || platform === 'ios' || platform === 'mac-safari');
  $('settings-install').hidden = installed;
}

function renderInstallHelp() {
  $('install-help').textContent = isStandalone()
    ? 'Carnet est installé sur cet appareil. Il s’ouvre même sans Internet ; l’assistant IA, la dictée et les nouvelles polices en ont besoin.'
    : 'Installe Carnet pour l’ouvrir depuis ton écran d’accueil, comme une application, même sans Internet. Tes notes restent les mêmes.';
  renderInstallButtons();
  renderNotifyButton(); // agenda.js
}

const INSTALL_STEPS = {
  ios: ['Ouvre Carnet dans <strong>Safari</strong> (ou Chrome).', 'Touche le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut).', 'Choisis <strong>Sur l’écran d’accueil</strong>, puis <strong>Ajouter</strong>.'],
  'mac-safari': ['Dans la barre des menus, ouvre <strong>Fichier</strong>.', 'Choisis <strong>Ajouter au Dock</strong>, puis <strong>Ajouter</strong>.'],
  android: ['Ouvre le menu <strong>⋮</strong> de Chrome, en haut à droite.', 'Choisis <strong>Installer l’application</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>).'],
  'android-firefox': ['Ouvre le menu <strong>⋮</strong> de Firefox.', 'Choisis <strong>Installer</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>).'],
  firefox: ['Firefox sur ordinateur ne sait pas installer un site comme une application.', 'Ouvre Carnet dans <strong>Chrome</strong> ou <strong>Edge</strong>, puis clique sur l’icône d’installation dans la barre d’adresse.', 'Sinon, ajoute simplement Carnet à tes favoris.'],
  desktop: ['Clique sur l’icône d’installation à droite de la barre d’adresse (un écran avec une flèche).', 'Ou ouvre le menu <strong>⋮</strong> du navigateur et cherche <strong>Installer Carnet</strong>.', 'Si rien n’apparaît, Carnet est peut-être déjà installé : cherche-le dans tes applications.'],
};

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    renderInstallButtons();
    if (outcome === 'accepted') toast('Carnet s’installe…');
    return;
  }
  $('install-steps').innerHTML = `
    <ol class="install-steps">${INSTALL_STEPS[platform].map((step) => `<li>${step}</li>`).join('')}</ol>
    <p class="muted">L’application s’ouvre même sans Internet. L’assistant IA et la dictée ont besoin d’une connexion.</p>`;
  closeModals();
  openModal('install-modal');
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // on garde la proposition pour notre propre bouton
  installPrompt = event;
  renderInstallButtons();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  renderInstallButtons();
  toast('Carnet est installé.');
  // Une application installée garde ses données plus sûrement : on le demande au navigateur
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
});

$('install-btn').addEventListener('click', installApp);
$('settings-install').addEventListener('click', installApp);

// Le service worker ne fonctionne qu'en https (ou en local)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker non installé :', error));
  });
}
