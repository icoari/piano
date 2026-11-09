// Icônes au trait (24 x 24), couleur héritée du texte.
const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  wave: svg('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>'),
  play: svg('<path d="M7.5 5v14l11-7z"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>'),
  keys: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14M7.5 5v7h3V5M13.5 5v7h3V5"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9.5 14.5 12 12l2.5 2.5"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  score: svg('<path d="M3 7h18M3 10.5h18M3 14h18M3 17.5h18"/><ellipse cx="9" cy="16" rx="2.3" ry="1.7"/><path d="M11.3 16V6.5"/>'),
  star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>'),
};
export const icon = (name) => ICONS[name] || '';
