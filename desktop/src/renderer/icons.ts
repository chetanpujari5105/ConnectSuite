/**
 * The icon set. Hand-authored SVG on a 24px grid, 1.5–1.7 stroke, Lucide-compatible.
 *
 * ### Why this file exists
 *
 * It exists because the build shipped without one, and the gap was visible on screen: the Mirror
 * tool rail's Capture and Refresh drew a `.tool-glyph` span with a border and no contents, so both
 * rendered as empty rings. Nothing failed, nothing logged, and the pane looked finished from every
 * angle except a screenshot. That is the same shape as a failure count with no success count — an
 * absence with nothing to give it scale — so the fix carries an enforcement point rather than a
 * sentence in a doc: [ICON_NAMES] is enumerated, `icons.test.ts` asserts over the whole enumeration,
 * and `navModel.test.ts` asserts that every icon the shell asks for is in it. An icon referenced but
 * never authored is a red test, not an empty ring.
 *
 * ### Where the geometry comes from
 *
 * The eleven nav icons, the four toolbar icons, the brand glyph and the phone glyph are the
 * handoff's own paths, transcribed from `ConnectSuite.dc.html`. That is deliberate and not
 * laziness: the handoff is "high-fidelity … recreate pixel-for-pixel", so an icon redrawn from
 * memory here would be a departure nobody chose. Everything else — the six global actions, capture,
 * refresh, and the small utility marks — has no counterpart in the mockups and is authored on the
 * same grid to the same stroke.
 *
 * ### Two rules about the markup
 *
 * `stroke="currentColor"` everywhere, so an icon takes the colour of the row it sits in and there
 * is no second place a hover or selected state has to be kept in step. `fill="none"` everywhere
 * except [dots], which is a filled mark by design.
 *
 * Plain script, not a module: index.html loads it with its own <script> tag and the CSP-locked
 * page has no module loader. Same shape as chips.ts and notifyLabels.ts.
 */

/**
 * The inner markup of each icon, on a 0 0 24 24 viewBox.
 *
 * Only the geometry lives here. Size, stroke width and colour are applied by [iconSvg], so a
 * caller cannot half-apply the grid — which is how a 16px icon ends up drawn on a 20px path.
 */
const ICON_GEOMETRY: Record<string, string> = {
  // ---- Navigation. The handoff's own paths. ------------------------------------------------
  overview:
    '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/>' +
    '<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/>' +
    '<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/>' +
    '<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  mirror:
    '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5H13"/>' +
    '<path d="M3 11a6 6 0 0 1 6 6"/>' +
    '<path d="M3 15.5a2.5 2.5 0 0 1 2.5 2.5"/>' +
    '<path d="M3.2 20h.01"/>',
  files:
    '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.6h7.8A2.5 2.5 0 0 1 21 10.1v7.4A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  photos:
    '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/>' +
    '<circle cx="8.6" cy="9.8" r="1.6"/>' +
    '<path d="M3.6 17.4l5-4.6 4.2 3.8 3-2.6 4.6 3.6"/>',
  messages:
    '<path d="M20.5 11.6c0 4.2-3.8 7.6-8.5 7.6-1 0-2-.16-2.9-.45L4.2 20.4l1.3-3.6A7.3 7.3 0 0 1 3.5 11.6C3.5 7.4 7.3 4 12 4s8.5 3.4 8.5 7.6z"/>',
  notifications:
    '<path d="M6.2 10.4a5.8 5.8 0 0 1 11.6 0v3.4l1.6 3H4.6l1.6-3z"/>' +
    '<path d="M9.8 19.6a2.4 2.4 0 0 0 4.4 0"/>',
  clipboard:
    '<rect x="5" y="4.5" width="14" height="16" rx="2.4"/>' +
    '<path d="M9 4.5V3.4A1.4 1.4 0 0 1 10.4 2h3.2A1.4 1.4 0 0 1 15 3.4v1.1z"/>' +
    '<path d="M8.8 11.5h6.4M8.8 15h4.2"/>',
  calls:
    '<path d="M4.2 5.6A1.9 1.9 0 0 1 6.1 3.7h2.2c.9 0 1.7.63 1.86 1.52l.4 2.2a1.9 1.9 0 0 1-.9 1.98l-1.1.64a10.4 10.4 0 0 0 5.4 5.4l.64-1.1a1.9 1.9 0 0 1 1.98-.9l2.2.4c.9.16 1.52.94 1.52 1.86v2.2a1.9 1.9 0 0 1-1.9 1.9C10.9 19.8 4.2 13.1 4.2 5.6z"/>',
  camera:
    '<path d="M3 8.6A2.4 2.4 0 0 1 5.4 6.2h2l1.3-2h6.6l1.3 2h2A2.4 2.4 0 0 1 21 8.6v8.6a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 17.2z"/>' +
    '<circle cx="12" cy="12.6" r="3.3"/>',
  /*
   * Apps — a 3x3 of dots, which is what an app drawer looks like on every platform anybody has
   * used. Deliberately not a 2x2 of rounded rects: `overview` is already that, and two nav rows
   * with the same glyph is the empty-ring defect's cousin — an icon that draws fine and identifies
   * nothing. Filled rather than stroked, like `dots`, because a 1.5px ring at r=1.35 is mush.
   */
  apps:
    '<circle cx="6" cy="6" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="6" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="18" cy="6" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="6" cy="12" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="18" cy="12" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="6" cy="18" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="18" r="1.35" fill="currentColor" stroke="none"/>' +
    '<circle cx="18" cy="18" r="1.35" fill="currentColor" stroke="none"/>',
  activity: '<path d="M3 12.4h3.6l2.2-6 3.2 12 2.4-7.4 1.5 3.4H21"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M12 3v2.4M12 18.6V21M4.6 7.8l2.1 1.2M17.3 15l2.1 1.2M4.6 16.2l2.1-1.2M17.3 9l2.1-1.2"/>',

  // ---- Toolbar and chrome. The handoff's own paths. ----------------------------------------
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8L21 21"/>',
  'device-settings':
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M12 4v2M12 18v2M5.5 8l1.7 1M16.8 15l1.7 1M5.5 16l1.7-1M16.8 9l1.7-1"/>',
  detach:
    '<path d="M13.5 4.5H19.5V10.5"/>' +
    '<path d="M19.5 4.5L12 12"/>' +
    '<path d="M18 14.5v3.9A2.1 2.1 0 0 1 15.9 20.5H5.6A2.1 2.1 0 0 1 3.5 18.4V8.1A2.1 2.1 0 0 1 5.6 6h3.9"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',

  /**
   * The overflow mark. The one filled icon in the set, which is why [iconSvg] reads
   * [FILLED_ICONS] rather than stroking everything — a stroked dot at 1.5 is a ring.
   */
  dots: '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>',

  // ---- The Mirror tool rail. Authored here; the handoff draws five tools and we send two. ---
  /**
   * Capture. A shutter, not a camera body: the Mac is saving a still of frames it already has,
   * and a camera glyph would read as "take a photo with the phone", which is a different feature
   * living on a different pane.
   */
  capture:
    '<path d="M4 8.4A2.4 2.4 0 0 1 6.4 6h11.2A2.4 2.4 0 0 1 20 8.4v8.2A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z"/>' +
    '<circle cx="12" cy="12.5" r="3.4"/>' +
    '<path d="M8.6 6l1-2h4.8l1 2"/>',
  /** Refresh — `mirror.keyframe`. A cycle, open at the top-right where the arrowhead sits. */
  refresh:
    '<path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.4"/>' +
    '<path d="M19.8 4.4v4.4h-4.4"/>',

  // ---- The six global actions. Authored here; performGlobalAction has no icons anywhere. ---
  /** Back — the chevron the float window's dock already uses. */
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  /** Home — the float dock's house. */
  home: '<path d="M4 11l8-6.5 8 6.5v8.5H4z"/>',
  /** Recents — the float dock's square. Android's own recents affordance, not a stack of cards. */
  recents: '<rect x="5" y="5" width="14" height="14" rx="2.4"/>',
  /** Alerts — the shade pulled down. A bell would collide with the Notifications nav row. */
  alerts:
    '<rect x="3.5" y="4" width="17" height="9.5" rx="2.4"/>' +
    '<path d="M7.5 8h9"/>' +
    '<path d="M12 16.5v3.6M9.6 17.9L12 20.4l2.4-2.5"/>',
  /** Quick settings — two sliders. Distinct from the gear, which means our settings, not the phone's. */
  'quick-settings':
    '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/>' +
    '<circle cx="15" cy="8" r="2.1"/><circle cx="9" cy="16" r="2.1"/>',
  /** Lock screen. A closed shackle: this locks, it never unlocks. */
  lock:
    '<rect x="4.5" y="10.4" width="15" height="9.6" rx="2.4"/>' +
    '<path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/>',
  // The handoff's assurance mark: a shield with a tick. Drawn on Settings' third column and on the
  // Overview strip, both of which state the same fact about the link. It is in the enumeration
  // below, which is what stops it becoming another empty ring.
  shield:
    '<path d="M12 3l7.5 3v5.4c0 4.4-3 8.2-7.5 9.6-4.5-1.4-7.5-5.2-7.5-9.6V6z"/>' +
    '<path d="M9 12.2l2.2 2.2 4-4.4"/>',

  // ---- Utility marks -----------------------------------------------------------------------
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.6l4.6 4.4L19 6.6"/>',
  chevron: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  /** The one state mark that is not a colour: a filled dot is drawn by CSS, this is its outline. */
  link: '<path d="M10.2 13.8a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.2 1.2"/>' +
    '<path d="M13.8 10.2a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.2-1.2"/>',

  // ---- Media transport and audio output. -----------------------------------------------------
  // No counterpart in the mockups — `ConnectSuite.dc.html` draws no media pane at all — so these
  // are authored on the same 24px grid as the six global actions, which are the other marks with
  // no design of their own.
  //
  // **The transport four are FILLED and everything else here is stroked**, which is a deliberate
  // split rather than an inconsistency. A transport glyph is a *shape* — a triangle, two bars —
  // and every system that draws one draws it solid, SF Symbols included; a stroked triangle reads
  // as an outline of a button rather than as the button. The device and volume marks are *icons*
  // in the ordinary sense and take the set's 1.5 stroke like everything else.
  play: '<path d="M8.2 5.1v13.8L19.2 12z"/>',
  pause:
    '<rect x="8.4" y="5.3" width="2.9" height="13.4" rx="1.45"/>' +
    '<rect x="12.7" y="5.3" width="2.9" height="13.4" rx="1.45"/>',
  'skip-back':
    '<path d="M18.6 6.1v11.8L10.2 12z"/>' +
    '<rect x="5.4" y="5.8" width="2.5" height="12.4" rx="1.25"/>',
  'skip-forward':
    '<path d="M5.4 6.1v11.8L13.8 12z"/>' +
    '<rect x="16.1" y="5.8" width="2.5" height="12.4" rx="1.25"/>',
  /** The art slot's fallback, for a session with neither artwork nor a launcher icon. */
  music: '<path d="M9 17.4V6.2l9.5-1.9v11.2"/><circle cx="6.5" cy="17.6" r="2.6"/>' +
    '<circle cx="15.9" cy="15.5" r="2.6"/>',

  // The volume slider's two end caps, and `volume-high` doubles as the speaker output's icon —
  // one mark, one meaning, drawn wherever that meaning appears.
  'volume-low': '<path d="M11.2 5.6L7 9.3H3.7v5.4H7l4.2 3.7z"/>',
  'volume-high':
    '<path d="M11.2 5.6L7 9.3H3.7v5.4H7l4.2 3.7z"/>' +
    '<path d="M14.9 9.6a3.4 3.4 0 0 1 0 4.8"/><path d="M17.6 7.1a7 7 0 0 1 0 9.8"/>',
  /** `output.kind === 'bluetooth'` — two buds, the shape the reference draws. */
  airpods:
    '<path d="M8.6 3.8a3.1 3.1 0 0 1 3.1 3.1v5.4a2 2 0 0 1-2 2H9a3.1 3.1 0 0 1-3.1-3.1V6.9A3.1 3.1 0 0 1 8.6 3.8z"/>' +
    '<path d="M9.7 14.3v4.1a1.8 1.8 0 0 1-3.6 0"/>' +
    '<path d="M16.4 3.8a3.1 3.1 0 0 1 3.1 3.1v4.3a3.1 3.1 0 0 1-3.1 3.1h-.7a2 2 0 0 1-2-2V6.9a3.1 3.1 0 0 1 3.1-3.1z"/>' +
    '<path d="M15.3 14.3v4.1a1.8 1.8 0 0 0 3.6 0"/>',
  /** A failed event in Recent activity. An exclamation in a ring — the platform's own shape. */
  'alert-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.7v5"/><path d="M12 15.9h.01"/>',

  // ---- The Overview hero's detail metrics. Stroked on the same grid as everything else here;
  // the hero's six rows are one visual family and a borrowed filled mark in the middle of them
  // reads as a different icon set. -------------------------------------------------------------
  wifi:
    '<path d="M2.7 9.1a14.4 14.4 0 0 1 18.6 0"/>' +
    '<path d="M6 12.6a9.5 9.5 0 0 1 12 0"/>' +
    '<path d="M9.3 16.1a4.6 4.6 0 0 1 5.4 0"/>' +
    '<path d="M12 19.5h.01"/>',
  battery:
    '<rect x="2.6" y="7.6" width="16" height="8.8" rx="2.4"/>' +
    '<path d="M21.2 10.7v2.6"/>' +
    '<rect x="5.1" y="10.1" width="5.6" height="3.8" rx="1.1"/>',
  /** Stacked platters — the shape a storage figure gets everywhere, and not a folder. */
  storage:
    '<rect x="3" y="4.6" width="18" height="6" rx="2"/>' +
    '<rect x="3" y="13.4" width="18" height="6" rx="2"/>' +
    '<path d="M6.9 7.6h.01"/><path d="M6.9 16.4h.01"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.1v5.1"/><path d="M12 8h.01"/>',
  /** The address row: three nodes on a bus, which is what an IP on a LAN is a name for. */
  network:
    '<rect x="9.4" y="2.9" width="5.2" height="5.2" rx="1.6"/>' +
    '<rect x="2.6" y="15.9" width="5.2" height="5.2" rx="1.6"/>' +
    '<rect x="16.2" y="15.9" width="5.2" height="5.2" rx="1.6"/>' +
    '<path d="M12 8.1v3.6"/><path d="M5.2 15.9v-2.4h13.6v2.4"/>',
  /** `output.kind === 'headphones'` — a band and two cups. */
  headphones:
    '<path d="M4.2 15.4v-3.2a7.8 7.8 0 0 1 15.6 0v3.2"/>' +
    '<rect x="2.6" y="14.2" width="4.2" height="6.2" rx="2.1"/>' +
    '<rect x="17.2" y="14.2" width="4.2" height="6.2" rx="2.1"/>',
};

/**
 * The one filled icon. Everything else is a stroke on a 24px grid.
 *
 * A set rather than a flag on each entry so [ICON_GEOMETRY] stays pure geometry — the moment an
 * entry carries presentation, two of them will disagree about what a 1.5 stroke means.
 */
const FILLED_ICONS = new Set(['dots', 'play', 'pause', 'skip-back', 'skip-forward']);

/** Every icon that exists, as an array, so a test can assert over all of them. */
const ICON_NAMES: string[] = Object.keys(ICON_GEOMETRY);

/**
 * The stroke weight for a given rendered size.
 *
 * The handoff's range is 1.5–1.7 and the two ends are not interchangeable: a 1.5 stroke on a 14px
 * icon reads as a smudge, and a 1.7 stroke on a 20px nav icon reads as heavier than the 13.5px
 * label beside it. So the weight follows the size rather than being passed in by each caller and
 * getting it slightly wrong in eleven places.
 */
function strokeForSize(size: number): number {
  return size >= 18 ? 1.5 : size >= 16 ? 1.6 : 1.7;
}

/**
 * One icon, as an `<svg>` element ready to append.
 *
 * Throws on an unknown name rather than returning an empty `<svg>`. That is the whole point of the
 * file: an empty ring is exactly what shipped, and a silent fallback would let it ship again. The
 * throw is reachable only from a typo in our own source — [ICON_NAMES] is a closed set and no user
 * data reaches it — so it is a build-time-shaped failure that happens to be thrown at runtime, and
 * `icons.test.ts` plus `navModel.test.ts` catch it before that.
 */
function iconSvg(name: string, size = 20): SVGSVGElement {
  const geometry = ICON_GEOMETRY[name];
  if (geometry === undefined) {
    throw new Error(`No icon named "${name}". Add it to ICON_GEOMETRY in icons.ts.`);
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (FILLED_ICONS.has(name)) {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeForSize(size)));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  // The only innerHTML in the renderer, and it is fed exclusively from the constant table above.
  // No caller can reach it with a string of their own: `name` is looked up, never interpolated.
  svg.innerHTML = geometry;
  return svg;
}

/**
 * The brand glyph — a monoline phone-to-Mac link, violet→cyan gradient stroke.
 *
 * Separate from [iconSvg] because it is the one mark that is not `currentColor`: it carries its own
 * `linearGradient`, and a gradient needs a document-unique id. The id is suffixed per instance so
 * the 24px sidebar glyph and the 64px About glyph can coexist without the second one silently
 * inheriting the first one's gradient — which is a real bug in SVG and looks like a rendering
 * glitch rather than a duplicate id.
 */
let brandInstances = 0;
function brandGlyph(size = 24): SVGSVGElement {
  const id = `csbrand-${(brandInstances += 1)}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML =
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="24" y2="24">` +
    '<stop stop-color="var(--accent)"/><stop offset="1" stop-color="var(--secondary)"/></linearGradient></defs>' +
    `<rect x="2.2" y="6.2" width="12.4" height="9.2" rx="1.6" stroke="url(#${id})" stroke-width="1.7"/>` +
    `<path d="M4.4 18.6h10" stroke="url(#${id})" stroke-width="1.7" stroke-linecap="round"/>` +
    `<rect x="15.4" y="2.6" width="6.2" height="12.2" rx="2" stroke="url(#${id})" stroke-width="1.7"/>` +
    `<path d="M18.5 12.1v.01" stroke="url(#${id})" stroke-width="1.9" stroke-linecap="round"/>`;
  return svg;
}

// Same reason as `navModel.ts`'s block: a view test mounts a pane that calls `iconSvg`, and under
// `node --test` this file's declarations are module-scoped.
{
  const g = globalThis as Record<string, unknown>;
  g.iconSvg = iconSvg;
  g.brandGlyph = brandGlyph;
}

// Reachable from the page (plain scripts, one global scope) and from `node --test` (the shim).
if (typeof module !== 'undefined') {
  module.exports = { ICON_GEOMETRY, ICON_NAMES, FILLED_ICONS, strokeForSize, iconSvg, brandGlyph };
}
