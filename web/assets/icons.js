// One line-art glyph per stage, drawn on a 24x24 grid with a 1.6 stroke so the
// whole set reads as one family. No external icon pack, no licensing to track,
// nothing to 404.
export const ICONS = {
  "target-id": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>',
  "structure": '<path d="M7 3c0 4.5 10 6 10 10.5S7 19.5 7 21"/><path d="M17 3c0 4.5-10 6-10 10.5S17 19.5 17 21"/><path d="M8.6 7.5h6.8M8.6 16.5h6.8"/>',
  "protein-design": '<circle cx="5.2" cy="15.4" r="2.4"/><circle cx="12" cy="9.6" r="2.4"/><circle cx="18.8" cy="15.4" r="2.4"/><path d="m7 13.8 3.2-2.7M13.8 11.1l3.2 2.7"/><circle cx="12" cy="9.6" r="1" fill="currentColor" stroke="none"/>',
  "binding-site": '<path d="M4 8.5c3.6-3.6 5.2 2.4 8 2.4s4.4-6 8-2.4v7.8c-3.6 3.6-5.2-2.4-8-2.4s-4.4 6-8 2.4z"/><circle cx="12" cy="12" r="1.4"/>',
  "docking": '<path d="M10.5 4.5H5.2A1.2 1.2 0 0 0 4 5.7v12.6a1.2 1.2 0 0 0 1.2 1.2h5.3"/><path d="M10.5 9.4h2.8a2.6 2.6 0 0 1 0 5.2h-2.8z"/><circle cx="18.2" cy="12" r="2.6"/>',
  "md": '<path d="M2.8 14.5c2.4 0 2.4-6 4.8-6s2.4 9 4.8 9 2.4-9 4.8-9 2.4 6 4.8 6"/>',
  "qm": '<circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="9.4" ry="4.2"/><ellipse cx="12" cy="12" rx="9.4" ry="4.2" transform="rotate(60 12 12)"/>',
  "cheminformatics": '<path d="M12 3.4 19.4 7.7v8.6L12 20.6l-7.4-4.3V7.7z"/><path d="M9 9.4v5.2M15 9.4v5.2M9.9 8.1h4.2M9.9 15.9h4.2"/>',
  "libraries": '<ellipse cx="12" cy="6" rx="7.6" ry="2.8"/><path d="M4.4 6v6c0 1.6 3.4 2.8 7.6 2.8s7.6-1.2 7.6-2.8V6"/><path d="M4.4 12v6c0 1.6 3.4 2.8 7.6 2.8s7.6-1.2 7.6-2.8v-6"/>',
  "generative": '<path d="M8.4 4.9 13 7.6v5.3l-4.6 2.7-4.6-2.7V7.6z"/><path d="m13 10.2 3.3 1.9v3.8"/><circle cx="16.3" cy="19.2" r="2.3"/><path d="M19.6 4.4v3.2M18 6h3.2" stroke-width="1.3" opacity=".6"/>',
  "qsar-ml": '<path d="M3.6 20.4V4M3.6 20.4H21"/><path d="m6.6 16.6 3.8-4.2 3.2 2.4 5.4-6.6"/><circle cx="10.4" cy="12.4" r="1.1"/><circle cx="13.6" cy="14.8" r="1.1"/>',
  "admet": '<path d="M12 2.8c3 1.9 5.2 2.6 7.6 2.6v6.2c0 4.4-3 7.6-7.6 9.6-4.6-2-7.6-5.2-7.6-9.6V5.4c2.4 0 4.6-.7 7.6-2.6z"/><path d="m9.2 12 2 2 3.6-4"/>',
  "synthesis": '<path d="M9.6 3.2v4.9L4.4 17a2.4 2.4 0 0 0 2.1 3.6h11a2.4 2.4 0 0 0 2.1-3.6l-5.2-8.9V3.2"/><path d="M8.4 3.2h7.2M7.4 13.8h9.2"/>',
  "clinical": '<rect x="4.6" y="3.4" width="14.8" height="17.2" rx="2.2"/><path d="M9 3.4V2h6v1.4"/><path d="m7.8 13.2h2.4l1.4-2.8 1.8 5.2 1.2-2.4h1.6"/>',
  "benchmarks": '<path d="M4 20.2V12M9.4 20.2V7.2M14.8 20.2v-5.6M20.2 20.2V4.2"/><path d="M2.4 20.2h19.2"/>',
  "infra": '<rect x="2.6" y="4" width="6.4" height="5.4" rx="1.4"/><rect x="15" y="4" width="6.4" height="5.4" rx="1.4"/><rect x="8.8" y="14.6" width="6.4" height="5.4" rx="1.4"/><path d="M5.8 9.4v2.4h12.4V9.4M12 11.8v2.8"/>',
  "viz": '<path d="M12 4.2 20.4 8v8L12 19.8 3.6 16V8z"/><path d="M3.6 8 12 11.8 20.4 8M12 11.8v8"/>',
  "other": '<circle cx="5.4" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.6" cy="12" r="1.7"/>',
};

export function icon(stage, cls = "") {
  const d = ICONS[stage] || ICONS.other;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
