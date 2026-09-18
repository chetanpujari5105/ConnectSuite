/**
 * The icon set: the Sidekick family from the approved Figma file, plus the marks it does not draw.
 *
 * ### Where the geometry comes from
 *
 * **Forty-five glyphs are the Figma file's own vectors** — Design System → 13 · Iconography
 * (`36:18762`), each read from its 20px master through the Plugin API (`vectorPaths` plus each
 * vector's offset in its frame) and written here verbatim, rounded to hundredths. They are original
 * drawings in the SF Symbols *style*, made in this project's file; nothing is traced from Apple's
 * symbol set, which cannot be embedded or redistributed. The handoff's mapping table (§5b) names the
 * symbol each one stands for, and seven of those are approximations it lists by name.
 *
 * **The rest are this file's earlier hand-drawn marks, kept only where Figma draws nothing**: the
 * media transport (filled shapes), the Android global actions (home, recents, alerts, quick
 * settings), the device-metric glyphs and the capture shutter. They sit on a 24-unit grid; the Figma
 * glyphs sit on a 20-unit grid, and [ICON_VIEWBOX] says which is which.
 *
 * ### Why this file exists
 *
 * The build once shipped without one: the Mirror tool rail drew two empty rings and nothing
 * noticed. So [ICON_NAMES] is enumerated, `icons.test.ts` asserts over all of it, and
 * `navModel.test.ts` asserts that every icon the shell asks for resolves.
 *
 * ### Two rules about the markup
 *
 * `currentColor` everywhere, so an icon takes its row's colour. And **one stroke on screen**: Figma
 * draws every glyph at a 1.4px stroke whatever its size, so [iconSvg] converts that screen weight
 * into each glyph's own viewBox units — a 20-grid and a 24-grid glyph side by side draw the same line.
 *
 * Plain script, not a module: index.html loads it with its own <script> tag.
 */

/**
 * The inner markup of each icon. Only geometry lives here; size, stroke and colour are applied by
 * [iconSvg], so a caller cannot half-apply the grid.
 */
const ICON_GEOMETRY: Record<string, string> = {
  // ---- The Sidekick family — Figma `36:18762`, 20-unit grid. --------------------------------
  overview: '<path transform="translate(2.75 2.75)" d="M1.62 0L4.75 0C5.65 0 6.38 0.73 6.38 1.62L6.38 4.75C6.38 5.65 5.65 6.38 4.75 6.38L1.62 6.38C0.73 6.38 0 5.65 0 4.75L0 1.62C0 0.73 0.73 0 1.62 0Z"/><path transform="translate(10.88 2.75)" d="M1.63 0L4.75 0C5.65 0 6.38 0.73 6.38 1.62L6.38 4.75C6.38 5.65 5.65 6.38 4.75 6.38L1.63 6.38C0.73 6.38 0 5.65 0 4.75L0 1.62C0 0.73 0.73 0 1.63 0Z"/><path transform="translate(2.75 10.88)" d="M1.62 0L4.75 0C5.65 0 6.38 0.73 6.38 1.63L6.38 4.75C6.38 5.65 5.65 6.38 4.75 6.38L1.62 6.38C0.73 6.38 0 5.65 0 4.75L0 1.63C0 0.73 0.73 0 1.62 0Z"/><path transform="translate(10.88 10.88)" d="M1.63 0L4.75 0C5.65 0 6.38 0.73 6.38 1.63L6.38 4.75C6.38 5.65 5.65 6.38 4.75 6.38L1.63 6.38C0.73 6.38 0 5.65 0 4.75L0 1.63C0 0.73 0.73 0 1.63 0Z"/>',
  mirror: '<path transform="translate(2.25 4.5)" d="M2 0L9.25 0C10.35 0 11.25 0.9 11.25 2L11.25 6.75C11.25 7.85 10.35 8.75 9.25 8.75L2 8.75C0.9 8.75 0 7.85 0 6.75L0 2C0 0.9 0.9 0 2 0Z"/><path transform="translate(6.5 6.75)" d="M0 8.75L9.25 8.75C9.78 8.75 10.29 8.54 10.66 8.16C11.04 7.79 11.25 7.28 11.25 6.75L11.25 0"/>',
  files: '<path transform="translate(2.38 3.75)" d="M0 1.75C0 1.29 0.18 0.84 0.51 0.51C0.84 0.18 1.29 0 1.75 0L4.88 0C5.07 0 5.26 0.05 5.43 0.13C5.61 0.22 5.76 0.34 5.87 0.5L7.12 2.12L13.5 2.12C13.96 2.12 14.41 2.31 14.74 2.64C15.07 2.97 15.25 3.41 15.25 3.87L15.25 10.75C15.25 11.21 15.07 11.66 14.74 11.99C14.41 12.32 13.96 12.5 13.5 12.5L1.75 12.5C1.29 12.5 0.84 12.32 0.51 11.99C0.18 11.66 0 11.21 0 10.75L0 1.75Z"/>',
  photos: '<path transform="translate(2.38 4)" d="M2.25 0L13 0C14.24 0 15.25 1.01 15.25 2.25L15.25 9.75C15.25 10.99 14.24 12 13 12L2.25 12C1.01 12 0 10.99 0 9.75L0 2.25C0 1.01 1.01 0 2.25 0Z"/><path transform="translate(5.63 6.75)" d="M2.75 1.37C2.75 2.13 2.13 2.75 1.37 2.75C0.62 2.75 0 2.13 0 1.37C0 0.62 0.62 0 1.37 0C2.13 0 2.75 0.62 2.75 1.37Z"/><path transform="translate(3 10.52)" d="M0 3.98L3.75 0.36C3.98 0.13 4.3 0 4.62 0C4.95 0 5.27 0.13 5.5 0.36L8 2.86L9.88 1.11C10.11 0.88 10.42 0.75 10.75 0.75C11.08 0.75 11.39 0.88 11.62 1.11L14 3.36"/>',
  messages: '<path transform="translate(2.5 4)" d="M15 6.13C15 9.5 11.62 12.25 7.5 12.25C6.78 12.25 6.07 12.16 5.38 12L1.25 13.5L2.5 10.25C0.88 9.12 0 7.75 0 6.13C0 2.63 3.38 0 7.5 0C11.62 0 15 2.63 15 6.13Z"/>',
  notifications: '<path transform="translate(3.75 4.38)" d="M1.63 4.62C1.63 4.02 1.74 3.42 1.98 2.86C2.21 2.29 2.55 1.78 2.98 1.35C3.41 0.93 3.92 0.58 4.48 0.35C5.04 0.12 5.64 0 6.25 0C6.86 0 7.46 0.12 8.02 0.35C8.58 0.58 9.09 0.93 9.52 1.35C9.95 1.78 10.29 2.29 10.52 2.86C10.76 3.42 10.87 4.02 10.87 4.62C10.87 7.75 11.88 9 12.5 9.75L0 9.75C0.63 9 1.63 7.75 1.63 4.62Z"/><path transform="translate(8.13 16.38)" d="M0 0C0.14 0.38 0.4 0.71 0.73 0.95C1.07 1.18 1.47 1.3 1.88 1.3C2.28 1.3 2.68 1.18 3.02 0.95C3.35 0.71 3.61 0.38 3.75 0"/>',
  clipboard: '<path transform="translate(4 4.13)" d="M3.5 0L1.75 0C1.29 0 0.84 0.18 0.51 0.51C0.18 0.84 0 1.29 0 1.75L0 11.25C0 11.71 0.18 12.16 0.51 12.49C0.84 12.82 1.29 13 1.75 13L10.25 13C10.71 13 11.16 12.82 11.49 12.49C11.82 12.16 12 11.71 12 11.25L12 1.75C12 1.29 11.82 0.84 11.49 0.51C11.16 0.18 10.71 0 10.25 0L8.5 0"/><path transform="translate(7.38 2.38)" d="M1.25 0L4 0C4.69 0 5.25 0.56 5.25 1.25L5.25 2C5.25 2.69 4.69 3.25 4 3.25L1.25 3.25C0.56 3.25 0 2.69 0 2L0 1.25C0 0.56 0.56 0 1.25 0Z"/>',
  calls: '<path transform="translate(3.75 3.38)" d="M0 1.62C0 0.75 0.75 0 1.63 0L3.12 0C3.87 0 4.37 0.5 4.5 1.12L5.12 3.62C5.25 4.25 5 4.75 4.5 5L3.37 5.62C4.25 7.28 5.6 8.63 7.25 9.5L7.88 8.37C8.13 7.87 8.62 7.62 9.25 7.75L11.75 8.37C12.37 8.5 12.88 9 12.88 9.75L12.88 11.25C12.88 12.12 12.12 12.88 11.25 12.88C8.42 12.45 5.8 11.13 3.77 9.1C1.75 7.08 0.42 4.46 0 1.62Z"/>',
  camera: '<path transform="translate(2.5 4.25)" d="M0 3.63C0 3.09 0.21 2.59 0.59 2.21C0.96 1.84 1.47 1.62 2 1.62L3.5 1.62L4.62 0L10.38 0L11.5 1.62L13 1.62C13.53 1.62 14.04 1.84 14.41 2.21C14.79 2.59 15 3.09 15 3.63L15 9.88C15 10.41 14.79 10.91 14.41 11.29C14.04 11.66 13.53 11.88 13 11.88L2 11.88C1.47 11.88 0.96 11.66 0.59 11.29C0.21 10.91 0 10.41 0 9.88L0 3.63Z"/><path transform="translate(7 7.75)" d="M6 3C6 4.66 4.66 6 3 6C1.34 6 0 4.66 0 3C0 1.34 1.34 0 3 0C4.66 0 6 1.34 6 3Z"/>',
  apps: '<path transform="translate(2.81 2.81)" d="M3.37 1.69C3.37 2.62 2.62 3.37 1.69 3.37C0.76 3.37 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.37 0.76 3.37 1.69Z"/><path transform="translate(8.31 2.81)" d="M3.38 1.69C3.38 2.62 2.62 3.37 1.69 3.37C0.76 3.37 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.38 0.76 3.38 1.69Z"/><path transform="translate(13.81 2.81)" d="M3.37 1.69C3.37 2.62 2.62 3.37 1.69 3.37C0.76 3.37 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.37 0.76 3.37 1.69Z"/><path transform="translate(2.81 8.31)" d="M3.37 1.69C3.37 2.62 2.62 3.38 1.69 3.38C0.76 3.38 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.37 0.76 3.37 1.69Z"/><path transform="translate(8.31 8.31)" d="M3.38 1.69C3.38 2.62 2.62 3.38 1.69 3.38C0.76 3.38 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.38 0.76 3.38 1.69Z"/><path transform="translate(13.81 8.31)" d="M3.37 1.69C3.37 2.62 2.62 3.38 1.69 3.38C0.76 3.38 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.37 0.76 3.37 1.69Z"/><path transform="translate(2.81 13.81)" d="M3.37 1.69C3.37 2.62 2.62 3.37 1.69 3.37C0.76 3.37 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.37 0.76 3.37 1.69Z"/><path transform="translate(8.31 13.81)" d="M3.38 1.69C3.38 2.62 2.62 3.37 1.69 3.37C0.76 3.37 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.38 0.76 3.38 1.69Z"/><path transform="translate(13.81 13.81)" d="M3.37 1.69C3.37 2.62 2.62 3.37 1.69 3.37C0.76 3.37 0 2.62 0 1.69C0 0.76 0.76 0 1.69 0C2.62 0 3.37 0.76 3.37 1.69Z"/>',
  activity: '<path transform="translate(2 5.88)" d="M0 4.5L3.13 4.5L4.75 0L7.75 9L9.63 4.5L16 4.5"/>',
  settings: '<path transform="translate(7.31 7.31)" d="M5.37 2.69C5.37 4.17 4.17 5.37 2.69 5.37C1.2 5.37 0 4.17 0 2.69C0 1.2 1.2 0 2.69 0C4.17 0 5.37 1.2 5.37 2.69Z"/><path transform="translate(2 1.5)" d="M13.75 10.5C13.65 10.73 13.62 10.98 13.66 11.23C13.71 11.47 13.83 11.7 14 11.88L14.12 12C14.26 12.14 14.38 12.31 14.45 12.49C14.53 12.67 14.57 12.87 14.57 13.06C14.57 13.26 14.53 13.46 14.45 13.64C14.38 13.82 14.26 13.99 14.12 14.13C13.99 14.26 13.82 14.38 13.64 14.45C13.46 14.53 13.26 14.57 13.06 14.57C12.87 14.57 12.67 14.53 12.49 14.45C12.31 14.38 12.14 14.26 12 14.13L11.88 14C11.7 13.83 11.48 13.71 11.24 13.67C11 13.62 10.75 13.64 10.52 13.74C10.3 13.83 10.1 13.99 9.97 14.19C9.83 14.39 9.75 14.63 9.75 14.88L9.75 15C9.75 15.4 9.59 15.78 9.31 16.06C9.03 16.34 8.65 16.5 8.25 16.5C7.85 16.5 7.47 16.34 7.19 16.06C6.91 15.78 6.75 15.4 6.75 15L6.75 14.88C6.75 14.63 6.67 14.39 6.53 14.19C6.4 13.99 6.2 13.83 5.98 13.74C5.75 13.64 5.5 13.62 5.26 13.67C5.02 13.71 4.8 13.83 4.63 14L4.5 14.13C4.22 14.41 3.84 14.57 3.44 14.57C3.04 14.57 2.66 14.41 2.38 14.13C2.09 13.84 1.93 13.46 1.93 13.06C1.93 12.66 2.09 12.28 2.38 12L2.5 11.88C2.67 11.7 2.79 11.48 2.83 11.24C2.88 11 2.86 10.75 2.76 10.52C2.67 10.3 2.51 10.1 2.31 9.97C2.11 9.83 1.87 9.75 1.63 9.75L1.5 9.75C1.1 9.75 0.72 9.59 0.44 9.31C0.16 9.03 0 8.65 0 8.25C0 7.85 0.16 7.47 0.44 7.19C0.72 6.91 1.1 6.75 1.5 6.75L1.63 6.75C1.87 6.75 2.11 6.67 2.31 6.53C2.51 6.4 2.67 6.2 2.76 5.98C2.86 5.75 2.88 5.5 2.83 5.26C2.79 5.02 2.67 4.8 2.5 4.63L2.38 4.5C2.09 4.22 1.93 3.84 1.93 3.44C1.93 3.04 2.09 2.66 2.38 2.37C2.66 2.09 3.04 1.93 3.44 1.93C3.84 1.93 4.22 2.09 4.5 2.37L4.63 2.5C4.8 2.67 5.02 2.79 5.26 2.83C5.5 2.88 5.75 2.86 5.98 2.76C6.2 2.67 6.4 2.51 6.53 2.31C6.67 2.11 6.75 1.87 6.75 1.62L6.75 1.5C6.75 1.1 6.91 0.72 7.19 0.44C7.47 0.16 7.85 0 8.25 0C8.65 0 9.03 0.16 9.31 0.44C9.59 0.72 9.75 1.1 9.75 1.5L9.75 1.62C9.75 1.87 9.83 2.11 9.97 2.31C10.1 2.51 10.3 2.67 10.52 2.76C10.75 2.86 11 2.88 11.24 2.83C11.48 2.79 11.7 2.67 11.88 2.5L12 2.37C12.28 2.09 12.66 1.93 13.06 1.93C13.26 1.93 13.46 1.97 13.64 2.05C13.82 2.12 13.99 2.24 14.12 2.37C14.26 2.51 14.38 2.68 14.45 2.86C14.53 3.04 14.57 3.24 14.57 3.44C14.57 3.63 14.53 3.83 14.45 4.01C14.38 4.19 14.26 4.36 14.12 4.5L14 4.63C13.83 4.8 13.71 5.02 13.67 5.26C13.62 5.5 13.64 5.75 13.74 5.98C13.83 6.2 13.99 6.4 14.19 6.53C14.39 6.67 14.63 6.75 14.87 6.75L15 6.75C15.4 6.75 15.78 6.91 16.06 7.19C16.34 7.47 16.5 7.85 16.5 8.25C16.5 8.65 16.34 9.03 16.06 9.31C15.78 9.59 15.4 9.75 15 9.75L14.87 9.75C14.64 9.75 14.4 9.83 14.2 9.96C14 10.09 13.85 10.28 13.75 10.5Z"/>',
  search: '<path transform="translate(3.5 3.5)" d="M10.75 5.38C10.75 8.34 8.34 10.75 5.38 10.75C2.41 10.75 0 8.34 0 5.38C0 2.41 2.41 0 5.38 0C8.34 0 10.75 2.41 10.75 5.38Z"/><path transform="translate(13 13)" d="M0 0L3.75 3.75"/>',
  sliders: '<path transform="translate(2.75 5.5)" d="M0 0L14.5 0M0 4.5L14.5 4.5M0 9L14.5 9"/><path transform="translate(5.25 3.75)" d="M3.5 1.75C3.5 2.72 2.72 3.5 1.75 3.5C0.78 3.5 0 2.72 0 1.75C0 0.78 0.78 0 1.75 0C2.72 0 3.5 0.78 3.5 1.75Z"/><path transform="translate(11 8.25)" d="M3.5 1.75C3.5 2.72 2.72 3.5 1.75 3.5C0.78 3.5 0 2.72 0 1.75C0 0.78 0.78 0 1.75 0C2.72 0 3.5 0.78 3.5 1.75Z"/><path transform="translate(6.25 12.75)" d="M3.5 1.75C3.5 2.72 2.72 3.5 1.75 3.5C0.78 3.5 0 2.72 0 1.75C0 0.78 0.78 0 1.75 0C2.72 0 3.5 0.78 3.5 1.75Z"/>',
  'device-settings': '<path transform="translate(2.75 5.5)" d="M0 0L14.5 0M0 4.5L14.5 4.5M0 9L14.5 9"/><path transform="translate(5.25 3.75)" d="M3.5 1.75C3.5 2.72 2.72 3.5 1.75 3.5C0.78 3.5 0 2.72 0 1.75C0 0.78 0.78 0 1.75 0C2.72 0 3.5 0.78 3.5 1.75Z"/><path transform="translate(11 8.25)" d="M3.5 1.75C3.5 2.72 2.72 3.5 1.75 3.5C0.78 3.5 0 2.72 0 1.75C0 0.78 0.78 0 1.75 0C2.72 0 3.5 0.78 3.5 1.75Z"/><path transform="translate(6.25 12.75)" d="M3.5 1.75C3.5 2.72 2.72 3.5 1.75 3.5C0.78 3.5 0 2.72 0 1.75C0 0.78 0.78 0 1.75 0C2.72 0 3.5 0.78 3.5 1.75Z"/>',
  ellipsis: '<path transform="translate(3.06 8.81)" d="M2.37 1.19C2.37 1.84 1.84 2.37 1.19 2.37C0.53 2.37 0 1.84 0 1.19C0 0.53 0.53 0 1.19 0C1.84 0 2.37 0.53 2.37 1.19Z"/><path transform="translate(8.81 8.81)" d="M2.37 1.19C2.37 1.84 1.84 2.37 1.19 2.37C0.53 2.37 0 1.84 0 1.19C0 0.53 0.53 0 1.19 0C1.84 0 2.37 0.53 2.37 1.19Z"/><path transform="translate(14.56 8.81)" d="M2.38 1.19C2.38 1.84 1.84 2.37 1.19 2.37C0.53 2.37 0 1.84 0 1.19C0 0.53 0.53 0 1.19 0C1.84 0 2.38 0.53 2.38 1.19Z"/>',
  info: '<path transform="translate(2.5 2.5)" d="M15 7.5C15 11.64 11.64 15 7.5 15C3.36 15 0 11.64 0 7.5C0 3.36 3.36 0 7.5 0C11.64 0 15 3.36 15 7.5Z"/><path transform="translate(10 9)" d="M0 0L0 4.5"/><path transform="translate(10 6.38)" d="M0 0L0.01 0"/>',
  refresh: '<path transform="translate(3.5 3.57)" d="M13 6.43C13.02 7.94 12.51 9.41 11.56 10.58C10.61 11.76 9.29 12.56 7.81 12.87C6.33 13.17 4.79 12.95 3.46 12.25C2.13 11.54 1.08 10.39 0.5 9C-0.08 7.61 -0.16 6.06 0.28 4.61C0.72 3.17 1.64 1.92 2.9 1.09C4.16 0.25 5.66 -0.12 7.16 0.03C8.66 0.19 10.06 0.86 11.12 1.93"/><path transform="translate(13.13 3.5)" d="M3.88 0L3.88 3.88L0 3.88"/>',
  wrench: '<path transform="translate(5.21 4.5)" d="M6.54 0C6.3 0.63 6.25 1.31 6.4 1.97C6.54 2.62 6.87 3.22 7.34 3.69C7.82 4.17 8.42 4.5 9.07 4.64C9.73 4.78 10.41 4.73 11.04 4.5L3.54 12C3.13 12.36 2.6 12.55 2.06 12.54C1.52 12.52 1.01 12.3 0.62 11.91C0.24 11.53 0.02 11.02 0 10.47C-0.02 9.93 0.18 9.41 0.54 9L6.54 0Z"/><path transform="translate(4.25 4.25)" d="M0 0L2.75 2.75"/>',
  'start-mirroring': '<path transform="translate(2.25 4)" d="M2 0L9.25 0C10.35 0 11.25 0.9 11.25 2L11.25 6.75C11.25 7.85 10.35 8.75 9.25 8.75L2 8.75C0.9 8.75 0 7.85 0 6.75L0 2C0 0.9 0.9 0 2 0Z"/><path transform="translate(6.38 6.88)" d="M0 0L3.5 1.75L0 3.5L0 0Z"/><path transform="translate(6.5 6.75)" d="M0 8.75L9.25 8.75C9.78 8.75 10.29 8.54 10.66 8.16C11.04 7.79 11.25 7.28 11.25 6.75L11.25 0"/>',
  'stop-mirroring': '<path transform="translate(2.5 2.5)" d="M15 7.5C15 11.64 11.64 15 7.5 15C3.36 15 0 11.64 0 7.5C0 3.36 3.36 0 7.5 0C11.64 0 15 3.36 15 7.5Z"/><path transform="translate(7.38 7.38)" d="M1.25 0L4 0C4.69 0 5.25 0.56 5.25 1.25L5.25 4C5.25 4.69 4.69 5.25 4 5.25L1.25 5.25C0.56 5.25 0 4.69 0 4L0 1.25C0 0.56 0.56 0 1.25 0Z"/>',
  fullscreen: '<path transform="translate(3.25 3.25)" d="M4.75 0L0 0L0 4.75M8.75 13.5L13.5 13.5L13.5 8.75"/><path transform="translate(3.5 3.5)" d="M0 0L5 5M13 13L8 8"/>',
  pip: '<path transform="translate(2.38 4)" d="M2.25 0L13 0C14.24 0 15.25 1.01 15.25 2.25L15.25 9.75C15.25 10.99 14.24 12 13 12L2.25 12C1.01 12 0 10.99 0 9.75L0 2.25C0 1.01 1.01 0 2.25 0Z"/><path transform="translate(9.75 9.5)" d="M1.25 0L4.75 0C5.44 0 6 0.56 6 1.25L6 3.25C6 3.94 5.44 4.5 4.75 4.5L1.25 4.5C0.56 4.5 0 3.94 0 3.25L0 1.25C0 0.56 0.56 0 1.25 0Z"/>',
  detach: '<path transform="translate(2.38 4)" d="M2.25 0L13 0C14.24 0 15.25 1.01 15.25 2.25L15.25 9.75C15.25 10.99 14.24 12 13 12L2.25 12C1.01 12 0 10.99 0 9.75L0 2.25C0 1.01 1.01 0 2.25 0Z"/><path transform="translate(9.75 9.5)" d="M1.25 0L4.75 0C5.44 0 6 0.56 6 1.25L6 3.25C6 3.94 5.44 4.5 4.75 4.5L1.25 4.5C0.56 4.5 0 3.94 0 3.25L0 1.25C0 0.56 0.56 0 1.25 0Z"/>',
  'chevron-left': '<path transform="translate(7.25 4.25)" d="M5 0L0 5.75L5 11.5"/>',
  back: '<path transform="translate(7.25 4.25)" d="M5 0L0 5.75L5 11.5"/>',
  'chevron-right': '<path transform="translate(7.75 4.25)" d="M0 0L5 5.75L0 11.5"/>',
  chevron: '<path transform="translate(7.75 4.25)" d="M0 0L5 5.75L0 11.5"/>',
  'check-circle': '<path transform="translate(2.5 2.5)" d="M15 7.5C15 11.64 11.64 15 7.5 15C3.36 15 0 11.64 0 7.5C0 3.36 3.36 0 7.5 0C11.64 0 15 3.36 15 7.5Z"/><path transform="translate(6.75 7.75)" d="M0 2.5L2.38 4.88L6.75 0"/>',
  check: '<path transform="translate(4.25 6)" d="M0 4.5L3.75 8.25L11.5 0"/>',
  alert: '<path transform="translate(2.67 2.87)" d="M5.95 0.76C6.1 0.53 6.3 0.34 6.54 0.2C6.78 0.07 7.05 0 7.33 0C7.6 0 7.87 0.07 8.11 0.2C8.35 0.34 8.56 0.53 8.7 0.76L14.45 11.01C14.59 11.24 14.66 11.51 14.65 11.78C14.65 12.05 14.57 12.31 14.43 12.54C14.29 12.77 14.09 12.96 13.85 13.09C13.62 13.21 13.35 13.27 13.08 13.26L1.58 13.26C1.31 13.27 1.04 13.21 0.8 13.09C0.56 12.96 0.36 12.77 0.22 12.54C0.08 12.31 0 12.05 0 11.78C0 11.51 0.07 11.24 0.2 11.01L5.95 0.76Z"/><path transform="translate(10 7.75)" d="M0 0L0 3.25"/><path transform="translate(10 13.25)" d="M0 0L0.01 0"/>',
  'x-circle': '<path transform="translate(2.5 2.5)" d="M15 7.5C15 11.64 11.64 15 7.5 15C3.36 15 0 11.64 0 7.5C0 3.36 3.36 0 7.5 0C11.64 0 15 3.36 15 7.5Z"/><path transform="translate(7.5 7.5)" d="M0 0L5 5M5 0L0 5"/>',
  x: '<path transform="translate(4.75 4.75)" d="M0 0L10.5 10.5M10.5 0L0 10.5"/>',
  close: '<path transform="translate(4.75 4.75)" d="M0 0L10.5 10.5M10.5 0L0 10.5"/>',
  lock: '<path transform="translate(4.13 8.75)" d="M2.13 0L9.63 0C10.8 0 11.75 0.95 11.75 2.12L11.75 5.75C11.75 6.92 10.8 7.88 9.63 7.88L2.13 7.88C0.95 7.88 0 6.92 0 5.75L0 2.12C0 0.95 0.95 0 2.13 0Z"/><path transform="translate(7 3.38)" d="M0 5.38L0 3C0 2.2 0.32 1.44 0.88 0.88C1.44 0.32 2.2 0 3 0C3.8 0 4.56 0.32 5.12 0.88C5.68 1.44 6 2.2 6 3L6 5.38"/>',
  link: '<path transform="translate(7.4 3.73)" d="M0.98 7.89C0.35 7.26 0 6.41 0 5.52C0 4.63 0.35 3.77 0.98 3.14L3.35 0.77C4 0.23 4.82 -0.04 5.66 0C6.5 0.05 7.29 0.4 7.88 0.99C8.47 1.58 8.82 2.37 8.86 3.21C8.91 4.05 8.63 4.87 8.1 5.52L6.98 6.64"/><path transform="translate(3.73 8.38)" d="M7.89 0C8.52 0.63 8.87 1.49 8.87 2.38C8.87 3.26 8.52 4.12 7.89 4.75L5.52 7.12C4.87 7.66 4.05 7.93 3.21 7.89C2.37 7.85 1.58 7.5 0.99 6.9C0.4 6.31 0.05 5.52 0 4.68C-0.04 3.84 0.23 3.02 0.77 2.38L1.89 1.25"/>',
  'link-minus': '<path transform="translate(8.1 4.42)" d="M0.9 7.58C0.32 6.98 0 6.17 0 5.33C0 4.49 0.32 3.69 0.9 3.08L3.03 0.96C3.64 0.34 4.47 0 5.34 0C6.21 0 7.04 0.34 7.65 0.96C8.27 1.57 8.61 2.4 8.61 3.27C8.61 4.14 8.27 4.97 7.65 5.58L6.9 6.33"/><path transform="translate(3.54 9.25)" d="M7.46 0C8 0.56 8.33 1.3 8.38 2.08C8.42 2.86 8.18 3.63 7.71 4.25L5.58 6.37C5.28 6.68 4.92 6.92 4.52 7.08C4.13 7.25 3.7 7.33 3.27 7.33C2.4 7.33 1.57 6.99 0.96 6.37C0.65 6.07 0.41 5.71 0.25 5.31C0.08 4.92 0 4.49 0 4.06C0 3.2 0.34 2.36 0.96 1.75"/><path transform="translate(13.25 15.5)" d="M0 0L4 0"/>',
  spinner: '<path transform="translate(10 3)" d="M0 0L0 2.87"/><path transform="translate(10 14.13)" d="M0 0L0 2.88"/><path transform="translate(14.13 10)" d="M2.88 0L0 0"/><path transform="translate(3 10)" d="M2.87 0L0 0"/><path transform="translate(12.88 5.13)" d="M2 0L0 2"/><path transform="translate(5.13 12.88)" d="M2 0L0 2"/><path transform="translate(12.88 12.88)" d="M2 2L0 0"/><path transform="translate(5.13 5.13)" d="M2 2L0 0"/>',
  copy: '<path transform="translate(6.75 6.75)" d="M1.87 0L8.12 0C9.16 0 10 0.84 10 1.87L10 8.12C10 9.16 9.16 10 8.12 10L1.87 10C0.84 10 0 9.16 0 8.12L0 1.87C0 0.84 0.84 0 1.87 0Z"/><path transform="translate(3.25 3.25)" d="M10 3.5L10 1.88C10 1.38 9.8 0.9 9.45 0.55C9.1 0.2 8.62 0 8.13 0L1.88 0C1.38 0 0.9 0.2 0.55 0.55C0.2 0.9 0 1.38 0 1.88L0 8.13C0 8.62 0.2 9.1 0.55 9.45C0.9 9.8 1.38 10 1.88 10L3.5 10"/>',
  send: '<path transform="translate(10 4.25)" d="M0 12L0 0"/><path transform="translate(5.25 4.25)" d="M0 4.75L4.75 0L9.5 4.75"/>',
  download: '<path transform="translate(10 3.5)" d="M0 0L0 8.75"/><path transform="translate(5.75 8)" d="M0 0L4.25 4.25L8.5 0"/><path transform="translate(4 16.38)" d="M0 0L12 0"/>',
  upload: '<path transform="translate(4.5 2.25)" d="M0 12.75L0 1.75C0 1.29 0.18 0.84 0.51 0.51C0.84 0.18 1.29 0 1.75 0L5.88 0L9.75 3.88L9.75 12.75C9.75 12.98 9.7 13.21 9.62 13.42C9.53 13.63 9.4 13.82 9.24 13.99C9.07 14.15 8.88 14.28 8.67 14.37C8.46 14.45 8.23 14.5 8 14.5L1.75 14.5C1.29 14.5 0.84 14.32 0.51 13.99C0.18 13.66 0 13.21 0 12.75Z"/><path transform="translate(10 8.25)" d="M0 4.75L0 0"/><path transform="translate(8 8.25)" d="M0 2L2 0L4 2"/>',
  external: '<path transform="translate(3.25 4.25)" d="M12.5 7.5L12.5 10.75C12.5 11.21 12.32 11.66 11.99 11.99C11.66 12.32 11.21 12.5 10.75 12.5L1.75 12.5C1.29 12.5 0.84 12.32 0.51 11.99C0.18 11.66 0 11.21 0 10.75L0 1.75C0 1.29 0.18 0.84 0.51 0.51C0.84 0.18 1.29 0 1.75 0L5 0"/><path transform="translate(12 3.25)" d="M0 0L4.75 0L4.75 4.75"/><path transform="translate(9.25 3.25)" d="M0 7.5L7.5 0"/>',
  doc: '<path transform="translate(5 1.88)" d="M0 1.62C0 1.19 0.17 0.78 0.48 0.48C0.78 0.17 1.19 0 1.63 0L5.75 0L10 4.25L10 13.37C10 13.81 9.83 14.22 9.52 14.52C9.22 14.83 8.81 15 8.37 15L1.63 15C1.19 15 0.78 14.83 0.48 14.52C0.17 14.22 0 13.81 0 13.37L0 1.62Z"/><path transform="translate(10.63 2)" d="M0 0L0 4.13L4.13 4.13"/>',
  trash: '<path transform="translate(3.5 5.5)" d="M0 0L13 0"/><path transform="translate(7 2.63)" d="M0 2.88L0 1.5C0 1.1 0.16 0.72 0.44 0.44C0.72 0.16 1.1 0 1.5 0L4.5 0C4.9 0 5.28 0.16 5.56 0.44C5.84 0.72 6 1.1 6 1.5L6 2.88"/><path transform="translate(5.25 5.5)" d="M0 0L9.5 0L8.75 10.25C8.72 10.66 8.53 11.04 8.23 11.32C7.93 11.6 7.54 11.75 7.12 11.75L2.38 11.75C1.96 11.75 1.57 11.6 1.27 11.32C0.97 11.04 0.78 10.66 0.75 10.25L0 0Z"/>',
  keyboard: '<path transform="translate(2.25 5.25)" d="M2 0L13.5 0C14.6 0 15.5 0.9 15.5 2L15.5 7.5C15.5 8.6 14.6 9.5 13.5 9.5L2 9.5C0.9 9.5 0 8.6 0 7.5L0 2C0 0.9 0.9 0 2 0Z"/><path transform="translate(5.5 8.5)" d="M0 0L0.01 0M3 0L3.01 0M6 0L6.01 0M9 0L9.01 0M1.25 3.25L7.75 3.25"/>',
  'arrow-right': '<path transform="translate(3.5 10)" d="M0 0L13 0"/><path transform="translate(11.5 5)" d="M0 0L5 5L0 10"/>',
  envelope: '<path transform="translate(2.25 4.25)" d="M2.25 0L13.25 0C14.49 0 15.5 1.01 15.5 2.25L15.5 9.25C15.5 10.49 14.49 11.5 13.25 11.5L2.25 11.5C1.01 11.5 0 10.49 0 9.25L0 2.25C0 1.01 1.01 0 2.25 0Z"/><path transform="translate(3 6)" d="M0 0L6.13 4.5C6.38 4.68 6.69 4.78 7 4.78C7.31 4.78 7.62 4.68 7.87 4.5L14 0"/>',
  iphone: '<path transform="translate(5.5 2.25)" d="M2.25 0L6.75 0C7.99 0 9 1.01 9 2.25L9 13.25C9 14.49 7.99 15.5 6.75 15.5L2.25 15.5C1.01 15.5 0 14.49 0 13.25L0 2.25C0 1.01 1.01 0 2.25 0Z"/><path transform="translate(8.63 15.63)" d="M0 0L2.75 0"/>',
  phone: '<path transform="translate(5.5 2.25)" d="M2.25 0L6.75 0C7.99 0 9 1.01 9 2.25L9 13.25C9 14.49 7.99 15.5 6.75 15.5L2.25 15.5C1.01 15.5 0 14.49 0 13.25L0 2.25C0 1.01 1.01 0 2.25 0Z"/><path transform="translate(8.63 15.63)" d="M0 0L2.75 0"/>',
  laptop: '<path transform="translate(3.75 4.25)" d="M1.63 0L10.87 0C11.77 0 12.5 0.73 12.5 1.62L12.5 6.87C12.5 7.77 11.77 8.5 10.87 8.5L1.63 8.5C0.73 8.5 0 7.77 0 6.87L0 1.62C0 0.73 0.73 0 1.63 0Z"/><path transform="translate(2 15.75)" d="M0 0L16 0"/>',

  // ---- Marks Figma does not draw — 24-unit grid. ---------------------------------------------
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
  // ---- The six global actions. Authored here; performGlobalAction has no icons anywhere. ---
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
  // The handoff's assurance mark: a shield with a tick. Drawn on Settings' third column and on the
  // Overview strip, both of which state the same fact about the link. It is in the enumeration
  // below, which is what stops it becoming another empty ring.
  shield:
    '<path d="M12 3l7.5 3v5.4c0 4.4-3 8.2-7.5 9.6-4.5-1.4-7.5-5.2-7.5-9.6V6z"/>' +
    '<path d="M9 12.2l2.2 2.2 4-4.4"/>',
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

/** Glyphs drawn on the Figma file's 20-unit grid. Everything else is on the 24-unit grid. */
const ICON_VIEWBOX_20 = new Set<string>([
  'overview',
  'mirror',
  'files',
  'photos',
  'messages',
  'notifications',
  'clipboard',
  'calls',
  'camera',
  'apps',
  'activity',
  'settings',
  'search',
  'sliders',
  'device-settings',
  'ellipsis',
  'info',
  'refresh',
  'wrench',
  'start-mirroring',
  'stop-mirroring',
  'fullscreen',
  'pip',
  'detach',
  'chevron-left',
  'back',
  'chevron-right',
  'chevron',
  'check-circle',
  'check',
  'alert',
  'x-circle',
  'x',
  'close',
  'lock',
  'link',
  'link-minus',
  'spinner',
  'copy',
  'send',
  'download',
  'upload',
  'external',
  'doc',
  'trash',
  'keyboard',
  'arrow-right',
  'envelope',
  'iphone',
  'phone',
  'laptop',
]);

/** The viewBox edge for one glyph. */
function iconViewBox(name: string): number {
  return ICON_VIEWBOX_20.has(name) ? 20 : 24;
}

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
 * The stroke weight, **in screen pixels**, for a given rendered size.
 *
 * Figma draws every glyph at 1.4px — its Regular weight — at every size, because a Figma stroke does
 * not scale with its frame. The handoff keeps one exception: "Semibold only where clarity is at risk
 * at 12–14px", so the smallest sizes get 1.6. It is a function of size so no caller picks a weight.
 */
function strokeForSize(size: number): number {
  return size <= 14 ? 1.6 : 1.4;
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
  const box = iconViewBox(name);
  svg.setAttribute('viewBox', `0 0 ${box} ${box}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (FILLED_ICONS.has(name)) {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    // Screen pixels → this glyph's viewBox units, so every glyph draws the same line whatever its grid.
    svg.setAttribute('stroke-width', String(+((strokeForSize(size) * box) / size).toFixed(3)));
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
  module.exports = { ICON_GEOMETRY, ICON_NAMES, FILLED_ICONS, strokeForSize, iconViewBox, iconSvg, brandGlyph };
}
