// ===== Dictée vocale =====
//
// Utilise la reconnaissance vocale intégrée au navigateur (Chrome ou Edge).
// Rien à installer : le navigateur écoute le micro et écrit à la place du clavier.
// Quelques mots dictés deviennent de la ponctuation ou un retour à la ligne.

const Voice = (() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const NEWLINE = '\u0001'; // marqueur interne pour « retour à la ligne »

  // Mots dictés -> ce qu'on écrit à la place
  const WORDS = {
    'nouveau paragraphe': NEWLINE,
    'nouvelle ligne': NEWLINE,
    'à la ligne': NEWLINE,
    "point d'interrogation": '?',
    "point d'exclamation": '!',
    'deux points': ':',
    'point virgule': ';',
    'virgule': ',',
    'point': '.',
  };

  let recognizer = null;
  let listening = false;

  // Transforme la phrase dictée en morceaux : du texte, ou un retour à la ligne
  function toParts(raw) {
    let text = `${raw.trim()} `;
    // On traite d'abord les expressions les plus longues (« point d'interrogation » avant « point »)
    Object.keys(WORDS).sort((a, b) => b.length - a.length).forEach((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Le mot doit être entier (les lettres accentuées comptent comme des lettres)
      const pattern = new RegExp(`\\s*(?<!\\p{L})${escaped}(?!\\p{L})\\s*`, 'giu');
      const value = WORDS[word];
      // Une ponctuation se colle au mot précédent et laisse un espace après
      text = text.replace(pattern, value === NEWLINE ? NEWLINE : `${value} `);
    });
    return text.split(NEWLINE).map((part) => part.trimStart()).filter((part, i, all) => part || i < all.length - 1);
  }

  // Écrit le texte dicté dans la note ouverte, à l'endroit du curseur
  function insert(raw) {
    if (!currentNote()) {
      toast('Ouvre une note avant de dicter.');
      return;
    }
    restoreSelection(); // app.js : remet le curseur là où on écrivait
    toParts(raw).forEach((part, i, all) => {
      if (i > 0) document.execCommand('insertParagraph', false, null);
      if (part) document.execCommand('insertText', false, part);
    });
    noteChanged(); // app.js : sauvegarde la note
  }

  function showState(on) {
    $('dictate-btn').classList.toggle('recording', on);
    $('dictate-btn').setAttribute('aria-pressed', String(on));
    $('dictation-status').hidden = !on;
  }

  function start() {
    if (!Recognition) {
      toast("La dictée ne marche pas dans ce navigateur. Essaie Chrome ou Edge.");
      return;
    }
    if (!currentNote()) {
      toast('Ouvre ou crée une note avant de dicter.');
      return;
    }

    recognizer = new Recognition();
    recognizer.lang = 'fr-FR';
    recognizer.continuous = true;      // on dicte sans s'arrêter à chaque phrase
    recognizer.interimResults = true;  // on voit les mots pendant qu'ils arrivent

    recognizer.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) insert(result[0].transcript);
        else interim += result[0].transcript;
      }
      $('dictation-status').textContent = interim ? `… ${interim}` : 'Je t’écoute';
    };

    recognizer.onerror = (event) => {
      // « no-speech » = silence : pas grave, on continue
      if (event.error === 'no-speech') return;
      toast(`Micro : ${event.error}`);
      stop();
    };

    // Le navigateur coupe parfois l'écoute : on la relance tant que l'utilisateur dicte
    recognizer.onend = () => {
      if (listening) recognizer.start();
    };

    listening = true;
    showState(true);
    recognizer.start();
  }

  function stop() {
    listening = false;
    showState(false);
    if (recognizer) recognizer.stop();
  }

  function toggle() {
    if (listening) stop();
    else start();
  }

  $('dictate-btn').addEventListener('click', toggle);

  return { toggle, stop, toParts };
})();
