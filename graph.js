// ===== Graphe : les notes reliées par leurs [[liens]] =====
//
// Chaque note est un point. Un lien [[Titre]] trace une ligne entre deux points.
// La position des points vient d'une petite simulation physique : les notes
// se repoussent, les liens les rapprochent, et le tout reste au centre.

function renderGraph() {
  const canvas = $('graph-canvas');
  const box = canvas.parentElement;
  const width = box.clientWidth;
  const height = box.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  // Taille nette même sur les écrans haute densité
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const entries = allNotes();
  const nodes = entries.map(({ note }, i) => {
    // Départ sur un cercle, pour que la simulation converge vite
    const angle = (i / Math.max(1, entries.length)) * Math.PI * 2;
    return {
      id: note.id,
      title: note.title || 'Sans titre',
      x: width / 2 + Math.cos(angle) * width * 0.3,
      y: height / 2 + Math.sin(angle) * height * 0.3,
      vx: 0, vy: 0, degree: 0,
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byTitle = new Map(nodes.map((n) => [n.title.toLowerCase(), n]));

  // Un lien va de la note qui écrit [[Titre]] vers la note portant ce titre
  const edges = [];
  entries.forEach(({ note }) => {
    linkTitles(note).forEach((title) => {
      const source = byId.get(note.id);
      const target = byTitle.get(title.toLowerCase());
      if (source && target && target !== source) {
        edges.push([source, target]);
        source.degree++;
        target.degree++;
      }
    });
  });

  // Distance idéale entre deux notes reliées : proportionnelle à la taille du graphe,
  // pour que quelques notes ne restent pas tassées au centre d'un grand écran
  const ideal = Math.max(110, Math.min(width, height) * 0.24);
  const repulse = ideal * ideal * 0.6;

  // Simulation : 300 étapes suffisent pour une cinquantaine de notes
  for (let step = 0; step < 300; step++) {
    // Répulsion entre toutes les paires de notes
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const d = Math.sqrt(d2);
        const force = repulse / d2;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
      }
    }
    // Attraction le long des liens
    for (const [a, b] of edges) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = (d - ideal) * 0.02;
      a.vx += (dx / d) * force;
      a.vy += (dy / d) * force;
      b.vx -= (dx / d) * force;
      b.vy -= (dy / d) * force;
    }
    // Rappel vers le centre, puis déplacement
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.0025;
      n.vy += (height / 2 - n.y) * 0.0025;
      n.x = Math.min(width - 24, Math.max(24, n.x + n.vx * 0.5));
      n.y = Math.min(height - 24, Math.max(24, n.y + n.vy * 0.5));
      n.vx *= 0.6;
      n.vy *= 0.6;
    }
  }

  // Couleurs lues dans le thème, pour rester cohérent avec l'accent choisi
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#1b6e66';
  const ink = styles.getPropertyValue('--graph-ink').trim() || '#ecebe6';
  const line = styles.getPropertyValue('--graph-line').trim() || 'rgba(255,255,255,0.2)';

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  edges.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  ctx.font = '500 13px "Geist", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  nodes.forEach((n) => {
    const r = 5 + Math.min(9, n.degree * 2);
    // Un halo autour des notes très reliées
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6 + n.degree * 3;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = ink;
    ctx.fillText(n.title, n.x + r + 6, n.y);
  });

  $('graph-count').textContent = `${nodes.length} note${nodes.length > 1 ? 's' : ''} · ${edges.length} lien${edges.length > 1 ? 's' : ''}`;

  // Clic sur un point : on ouvre la note
  canvas.onclick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = nodes.find((n) => Math.hypot(n.x - x, n.y - y) <= 14);
    if (hit) openNoteAnywhere(hit.id);
  };
}
