// ===== Dictée vocale : on parle, on relit, on insère =====
//
// Utilise la reconnaissance vocale intégrée au navigateur (Chrome, Edge, Safari).
// Ce qu'il faut savoir, pour être honnête avec l'utilisateur :
//   - la voix part chez le service du navigateur (Google pour Chrome, Microsoft pour Edge,
//     Apple pour Safari) : il faut Internet, et le son quitte l'appareil ;
//   - Firefox ne la propose pas : on explique alors comment utiliser la dictée du clavier ;
//   - le navigateur coupe l'écoute après un silence : on la relance tant que la personne dicte.
// Le texte dicté arrive d'abord dans une zone modifiable, puis on l'insère au curseur.

const Voice = (() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ACCEPTED_KEY = 'carnet-dictee-ok';
  const NBSP = '\u00a0'; // espace insécable, avant ? ! : ; comme en français

  // Mots dictés -> ce qu'on écrit à la place ("\n" = retour à la ligne)
  const WORDS = {
    'nouveau paragraphe': '\n',
    'nouvelle ligne': '\n',
    'à la ligne': '\n',
    "point d'interrogation": `${NBSP}?`,
    "point d'exclamation": `${NBSP}!`,
    'deux points': `${NBSP}:`,
    'point virgule': `${NBSP};`,
    'ouvrir la parenthèse': '(',
    'fermer la parenthèse': ')',
    'virgule': ',',
    'point': '.',
  };

  let recognizer = null;
  let wanted = false;    // la personne veut écouter (et non « pause »)
  let committed = 0;     // résultats déjà écrits dans la séance d'écoute en cours
  let quickEnds = 0;     // arrêts rapides d'affilée (pour ne pas relancer à l'infini)
  let startedAt = 0;

  const panel = $('dictation');
  const textArea = $('dict-text');

  // ----- Mise en forme du texte dicté -----

  // Remplace les mots de ponctuation et met les majuscules en début de phrase
  function format(raw, before = '') {
    let text = ` ${String(raw).trim()} `;
    // On traite d'abord les expressions les plus longues (« point d'interrogation » avant « point »)
    Object.keys(WORDS).sort((a, b) => b.length - a.length).forEach((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]");
      // Le mot doit être entier (les lettres accentuées comptent comme des lettres)
      const pattern = new RegExp(`\\s*(?<!\\p{L})${escaped}(?!\\p{L})\\s*`, 'giu');
      const value = WORDS[word];
      text = text.replace(pattern, value === '\n' ? '\n' : value === '(' ? ' (' : `${value} `);
    });
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/ {2,}/g, ' ').trim();

    // Majuscule au début d'une phrase
    const startsSentence = !before.trim() || /[.?!]\s*$|\n\s*$/.test(before);
    if (startsSentence) text = text.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
    text = text.replace(/([.?!]\s+|\n)(\p{Ll})/gu, (m, sep, c) => sep + c.toUpperCase());
    return text;
  }

  // Ajoute une phrase dictée à la fin de la zone de texte
  function appendFinal(raw) {
    const before = textArea.value;
    const piece = format(raw, before);
    if (!piece) return;
    const glue = !before || /\s$/.test(before) || /^[,.)?!:;\u00a0]/.test(piece) ? '' : ' ';
    textArea.value = before + glue + piece;
    textArea.scrollTop = textArea.scrollHeight;
  }

  // ----- États et messages -----

  function setState(kind, hint = '') {
    const labels = {
      idle: 'Dictée prête', starting: 'Activation du micro…', listening: 'Je t’écoute',
      paused: 'En pause', error: 'Dictée arrêtée', unsupported: 'Dictée indisponible',
    };
    $('dict-state').textContent = labels[kind];
    $('dict-hint').textContent = hint;
    panel.classList.toggle('listening', kind === 'listening');
    panel.classList.toggle('paused', kind === 'paused');
    const on = kind === 'listening' || kind === 'starting';
    $('dictate-btn').classList.toggle('recording', on);
    $('dictate-btn').setAttribute('aria-pressed', String(!panel.hidden));
    const toggle = $('dict-toggle');
    toggle.hidden = kind === 'unsupported';
    toggle.innerHTML = on
      ? '<i data-lucide="pause"></i><span>Pause</span>'
      : `<i data-lucide="mic"></i><span>${kind === 'paused' ? 'Reprendre' : 'Écouter'}</span>`;
    refreshIcons();
  }

  function showError(message) {
    $('dict-error').hidden = !message;
    $('dict-error').textContent = message || '';
  }

  const ERRORS = {
    'not-allowed': isIOS
      ? 'Micro refusé. Autorise-le dans Réglages › Safari › Micro, puis recharge la page.'
      : 'Micro refusé. Clique sur l’icône à gauche de l’adresse (cadenas ou réglages), autorise le micro, puis réessaie.',
    'service-not-allowed': 'La reconnaissance vocale est bloquée ici (par exemple dans l’application installée sur iPhone). Ouvre Carnet dans le navigateur, ou utilise la dictée de ton clavier.',
    'audio-capture': 'Aucun micro détecté. Vérifie qu’il est branché et autorisé pour ce site.',
    network: 'La dictée a besoin d’Internet : ta voix est transcrite par le service du navigateur. Vérifie ta connexion.',
    'language-not-supported': 'Le français n’est pas disponible pour la dictée dans ce navigateur.',
  };

  // Le navigateur ne sait pas dicter : on propose la dictée du clavier
  function showUnsupported(reason) {
    $('dict-intro').hidden = false;
    $('dict-intro').innerHTML = `
      <p><strong>${reason}</strong></p>
      <p>Tu peux quand même dicter avec la dictée de ton système :</p>
      <ul>
        <li>téléphone : touche <strong>micro</strong> du clavier ;</li>
        <li>Windows : <kbd>Windows</kbd> + <kbd>H</kbd> ;</li>
        <li>Mac : appuie deux fois sur <kbd>Fn</kbd> (ou <kbd>Contrôle</kbd>).</li>
      </ul>
      <p>Clique d’abord dans la zone ci-dessous ou dans la note, puis parle.</p>`;
    setState('unsupported');
  }

  function showIntro() {
    const service = isApple ? 'Apple' : /Edg\//.test(navigator.userAgent) ? 'Microsoft' : 'Google';
    $('dict-intro').hidden = false;
    $('dict-intro').innerHTML = `
      <p>Le navigateur va te demander l’accès au <strong>micro</strong>.</p>
      <p>Ta voix est envoyée au service de reconnaissance de ton navigateur (ici, sans doute ${service}) pour être transformée en texte.
         Carnet n’enregistre pas le son. Il faut une connexion Internet.</p>
      <div class="row-actions"><button class="btn btn-primary" id="dict-allow"><i data-lucide="mic"></i><span>Activer le micro</span></button></div>`;
    $('dict-allow').addEventListener('click', () => {
      try { localStorage.setItem(ACCEPTED_KEY, '1'); } catch (error) { /* pas grave */ }
      $('dict-intro').hidden = true;
      start();
    });
    setState('idle', 'Lis ceci une fois, puis active le micro.');
  }

  // ----- Écoute -----

  function start() {
    showError('');
    if (!Recognition) return;
    wanted = true;
    committed = 0;
    startedAt = Date.now();
    recognizer = new Recognition();
    recognizer.lang = 'fr-FR';
    // Sur Android, le mode continu répète les phrases : on écoute phrase par phrase
    recognizer.continuous = !isAndroid;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = () => setState('listening', 'Dis « virgule », « point », « à la ligne »…');

    recognizer.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          if (i >= committed) {
            appendFinal(result[0].transcript);
            committed = i + 1;
          }
        } else {
          interim += result[0].transcript;
        }
      }
      quickEnds = 0;
      $('dict-interim').textContent = interim ? `… ${interim}` : '';
    };

    recognizer.onerror = (event) => {
      // Silence ou arrêt volontaire : pas une vraie erreur
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      wanted = false;
      showError(ERRORS[event.error] || `La dictée s’est arrêtée (${event.error}). Réessaie.`);
      setState('error');
    };

    // Le navigateur coupe l'écoute après un silence : on relance tant que la personne dicte
    recognizer.onend = () => {
      $('dict-interim').textContent = '';
      if (!wanted) return;
      quickEnds = Date.now() - startedAt < 1500 ? quickEnds + 1 : 0;
      if (quickEnds > 4) {
        wanted = false;
        showError('Le micro se coupe tout seul. Vérifie qu’aucune autre application ne l’utilise, puis réessaie.');
        setState('error');
        return;
      }
      setTimeout(() => { if (wanted && !panel.hidden) start(); }, 250);
    };

    setState('starting');
    try {
      recognizer.start();
    } catch (error) {
      wanted = false;
      showError('Impossible de démarrer la dictée pour l’instant. Réessaie dans un instant.');
      setState('error');
    }
  }

  function pause() {
    wanted = false;
    if (recognizer) recognizer.stop();
    setState('paused', 'Corrige le texte si besoin, puis insère-le.');
  }

  // ----- Panneau -----

  async function open() {
    if (!currentNote()) {
      toast('Ouvre ou crée une note avant de dicter.');
      return;
    }
    panel.hidden = false;
    showError('');
    $('dict-intro').hidden = true;
    $('dictate-btn').setAttribute('aria-pressed', 'true');

    if (!window.isSecureContext) {
      showUnsupported('La dictée demande une adresse sécurisée (https).');
      return;
    }
    if (!Recognition) {
      showUnsupported('Ce navigateur ne propose pas la dictée intégrée (c’est le cas de Firefox).');
      return;
    }
    // Si le micro a déjà été refusé, on le dit tout de suite
    try {
      const status = navigator.permissions && await navigator.permissions.query({ name: 'microphone' });
      if (status && status.state === 'denied') {
        showError(ERRORS['not-allowed']);
        setState('error');
        return;
      }
    } catch (error) { /* certains navigateurs ne savent pas répondre : on continue */ }

    let accepted = false;
    try { accepted = localStorage.getItem(ACCEPTED_KEY) === '1'; } catch (error) { /* pas grave */ }
    if (!accepted) showIntro();
    else start();
  }

  function close() {
    wanted = false;
    if (recognizer) {
      try { recognizer.abort(); } catch (error) { /* déjà arrêté */ }
    }
    panel.hidden = true;
    $('dict-interim').textContent = '';
    $('dictate-btn').classList.remove('recording');
    $('dictate-btn').setAttribute('aria-pressed', 'false');
  }

  // Insère le texte relu dans la note, à l'endroit du curseur
  function insert() {
    const text = textArea.value.trim();
    if (!text) {
      toast('Rien à insérer pour l’instant : parle, ou écris dans la zone.');
      return;
    }
    if (!currentNote()) return;
    const body = $('note-body');

    // Le curseur n'a jamais été placé dans la note : le texte devient de nouveaux paragraphes à la fin
    if (!savedRange || !body.contains(savedRange.startContainer)) {
      body.insertAdjacentHTML('beforeend', text.split('\n').map((line) => `<p>${esc(line) || '<br>'}</p>`).join(''));
      noteChanged();
      textArea.value = '';
      toast('Texte ajouté à la fin de la note.');
      return;
    }

    restoreSelection(); // app.js : remet le curseur là où on écrivait
    const selected = window.getSelection();
    let before = '';
    if (selected.rangeCount) {
      // Tout le texte avant le curseur, pour savoir s'il faut une espace
      const range = selected.getRangeAt(0);
      const head = document.createRange();
      head.selectNodeContents(body);
      head.setEnd(range.startContainer, range.startOffset);
      before = head.toString();
    }
    text.split('\n').forEach((part, i) => {
      if (i > 0) document.execCommand('insertParagraph', false, null);
      const piece = i === 0 && before && !/\s$/.test(before) ? ` ${part}` : part;
      if (piece) document.execCommand('insertText', false, piece);
    });
    noteChanged(); // app.js : sauvegarde la note
    textArea.value = '';
    toast('Texte inséré dans la note.');
  }

  $('dictate-btn').addEventListener('click', () => (panel.hidden ? open() : close()));
  $('dict-close').addEventListener('click', close);
  $('dict-toggle').addEventListener('click', () => {
    if (wanted) pause();
    else start();
  });
  $('dict-clear').addEventListener('click', () => {
    textArea.value = '';
    textArea.focus();
  });
  $('dict-insert').addEventListener('click', insert);
  textArea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      insert();
    }
  });
  // Les boutons du panneau ne doivent pas faire perdre la position du curseur dans la note
  panel.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });

  return { open, close, format };
})();
