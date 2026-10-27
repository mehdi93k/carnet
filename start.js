// ===== Démarrage : une fois tous les fichiers chargés =====

// Liens d'ouverture : raccourcis de l'application (?view=agenda, ?action=new-note)
// et QR code d'une note (#note=…)
function handleLaunch() {
  const params = new URLSearchParams(location.search);
  if (VIEW_NAMES[params.get('view')]) view = params.get('view');
  const action = params.get('action');
  const packed = location.hash.startsWith('#note=') ? location.hash.slice(6) : null;

  // On nettoie l'adresse, pour qu'un rechargement ne refasse pas l'action
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);

  if (action === 'new-note') setTimeout(newNote, 50);
  if (packed) setTimeout(() => importFromHash(packed), 300); // qr.js
}

applySettings();
handleLaunch();
renderAll();
renderOnline();
renderNotifyButton();
showSaveState('saved');
checkReminders();
