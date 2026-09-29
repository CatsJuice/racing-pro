/** Hand-drawn 24×24 line icon set (stroke = currentColor) used across the UI instead of emoji. */

const P: Record<string, string> = {
  flag: '<path d="M5 21V4"/><path d="M5 4h13l-2.5 4.5L18 13H5"/><path d="M9 4v9M13 4v9M5 8.5h11.2" opacity=".45"/>',
  road: '<path d="M8.5 3 4 21M15.5 3 20 21"/><path d="M12 4v3M12 10.5v3M12 17v3"/>',
  wrench: '<path d="M14.6 6.4a4.2 4.2 0 0 0-5.3 5.3L3.8 17.2a1.9 1.9 0 0 0 2.7 2.7l5.5-5.5a4.2 4.2 0 0 0 5.3-5.3l-2.6 2.6-2.6-.5-.5-2.6z"/>',
  trophy: '<path d="M8 21h8M12 16.5V21"/><path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M17 5.5h2.5V7A3.5 3.5 0 0 1 16.4 10.5M7 5.5H4.5V7a3.5 3.5 0 0 0 3.1 3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v13.5H5z"/><path d="M8 3.5v5h7v-5M8 20.5v-6.5h8v6.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4h5v3M6 7l1 13.5h10L18 7M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2.5"/><path d="M15 9V5.5A2 2 0 0 0 13 3.5H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2H9"/>',
  camera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3L9 4.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="12" cy="13" r="3.5"/>',
  ghost: '<path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.4-1.8-2.3 1.8-2.3-1.8-2.3 1.8-2.3-1.8z"/><circle cx="9.5" cy="11" r="1" fill="currentColor"/><circle cx="14.5" cy="11" r="1" fill="currentColor"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/>',
  rewind: '<path d="M11 6.5v11L3.5 12zM20.5 6.5v11L13 12z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  gauge: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="m12 14 4.5-5"/><circle cx="12" cy="14.5" r="1.3" fill="currentColor"/>',
  shuffle: '<path d="M3 7h3.5l9 10H21M18 14l3 3-3 3M3 17h3.5l2.7-3M14.8 10 16.5 7H21M18 4l3 3-3 3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  node: '<circle cx="12" cy="12" r="3.2"/><path d="M3 12h5.8M15.2 12H21"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M12 14.2V21M9.9 11.4 3.5 10M14.1 11.4l6.4-1.4"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  compare: '<path d="M12 3v18"/><rect x="3" y="7" width="6" height="10" rx="1.5"/><rect x="15" y="4" width="6" height="16" rx="1.5"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  chart: '<path d="M3 20.5h18M6 17v-5M11 17V6M16 17v-8"/>',
  lang: '<path d="M4 5h9M8.5 3v2M11 5c-.8 4.5-3.7 8-7 9.5M6 9c1.2 2.6 3.2 4.3 5.5 5"/><path d="m12.5 21 4-10 4 10M14 17.5h5"/>',
  car: '<path d="M4 16.5v-3.2L6.2 8.4A2 2 0 0 1 8 7.2h8a2 2 0 0 1 1.8 1.2l2.2 4.9v3.2"/><path d="M3 13.5h18v3.5H3z"/><circle cx="7.5" cy="17.5" r="1.7"/><circle cx="16.5" cy="17.5" r="1.7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 10 6 3.5h4L12 8M15.5 10 18 3.5h-4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1.2-1.8-1.2-3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1.2" fill="currentColor"/>',
  engine: '<path d="M4 10v6M4 13h2.5M6.5 9h3l1.5-2h4v2h2.5l2 2.5V15l-2 2h-2.5l-1.5 2h-5l-2-2.5z"/><path d="M11 4h4M13 4v3"/>',
  gearbox: '<circle cx="6" cy="5.5" r="1.8"/><circle cx="12" cy="5.5" r="1.8"/><circle cx="18" cy="5.5" r="1.8"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/><path d="M6 7.3v9.4M12 7.3v9.4M18 7.3V12H6"/>',
  drive: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M8.5 18h7M12 6v12"/>',
  spring: '<path d="M12 2.5v2.5M12 19v2.5M7 5h10L7 8.5h10L7 12h10L7 15.5h10L7 19h10"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  tire: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M5.6 18.4l3.2-3.2M15.2 8.8l3.2-3.2" opacity=".55"/>',
  chassis: '<rect x="5" y="3.5" width="14" height="17" rx="3"/><path d="M5 8h14M5 16h14M9 3.5v17M15 3.5v17" opacity=".6"/>',
  brake: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M4 7.5A9.5 9.5 0 0 0 4 16.5M20 7.5a9.5 9.5 0 0 1 0 9"/>',
};

export type IconName = keyof typeof P;

export function iconSvg(name: IconName, size = 18) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

export function icon(name: IconName, size = 18): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, size);
  return t.content.firstChild as SVGSVGElement;
}

/**
 * Translations carry emoji / arrow glyphs for plain-text contexts; strip them where the UI
 * shows a proper icon instead.
 */
const LEAD = /^[+＋\p{Extended_Pictographic}←-⇿⌀-⏿①-⓿■-◿⤀-⥿☀-➿⬀-⯿️‍\s]+/u;
const TRAIL = /[\s←-⇿■-◿⬀-⯿️]+$/u;
export function plain(s: string) {
  return s.replace(LEAD, '').replace(TRAIL, '');
}
