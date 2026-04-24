/**
 * Kinetic Atelier Design Tokens
 *
 * Extracted from the Stitch design export in /design.
 * Creative North Star: "The Kinetic Atelier" — deep slate, editorial typography,
 * no harsh borders, tonal layering only.
 *
 * Covers issues #188, #191
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
export const Colors = {
  // ── Surfaces (Tonal Layering Stack) ────────────────────────────────────────
  /** Foundational canvas. Never use pure black. */
  background: '#121416',
  /** Deepest inset surface — modals, overlays */
  surfaceLowest: '#0c0e10',
  /** Card background — primary content surface */
  surfaceLow: '#1a1c1e',
  /** Nested row background */
  surface: '#1e2022',
  /** Elevated / pressed state */
  surfaceHigh: '#282a2c',
  /** Floating element, chips, highest contrast surface */
  surfaceHighest: '#333537',
  /** Same alias — surface-variant / surface-bright */
  surfaceVariant: '#333537',
  surfaceBright: '#37393b',

  // ── Primary — Coral ────────────────────────────────────────────────────────
  /** Milestones, progress, primary CTAs */
  primary: '#ffb4a8',
  /** Gradient end for soul gradient CTAs */
  primaryContainer: '#e67e6e',
  primaryFixed: '#ffdad4',
  primaryFixedDim: '#ffb4a8',
  onPrimary: '#5e170e',
  onPrimaryContainer: '#611911',
  onPrimaryFixed: '#400201',
  onPrimaryFixedVariant: '#7c2d22',
  inversePrimary: '#9a4337',

  // ── Secondary — Calm Blue (Strength / Recovery) ───────────────────────────
  secondary: '#a9cdd2',
  secondaryContainer: '#294c51',
  secondaryFixed: '#c4e9ee',
  secondaryFixedDim: '#a9cdd2',
  onSecondary: '#10353a',
  onSecondaryContainer: '#97bbc1',
  onSecondaryFixed: '#001f23',
  onSecondaryFixedVariant: '#294c51',

  // ── Tertiary — Muted Green (Cardio / Vitality) ────────────────────────────
  tertiary: '#b0cfad',
  tertiaryContainer: '#86a383',
  tertiaryFixed: '#ccebc7',
  tertiaryFixedDim: '#b0cfad',
  onTertiary: '#1d361e',
  onTertiaryContainer: '#203921',
  onTertiaryFixed: '#07200b',
  onTertiaryFixedVariant: '#334d33',

  // ── Text / On-Surface ─────────────────────────────────────────────────────
  onBackground: '#e2e2e5',
  onSurface: '#e2e2e5',
  /** Muted body text — subtitles, secondary info */
  onSurfaceVariant: '#dbc1bc',
  inverseSurface: '#e2e2e5',
  inverseOnSurface: '#2f3133',

  // ── Outline / Border ─────────────────────────────────────────────────────
  /** Visible labels, muted metadata */
  outline: '#a38b88',
  /** Ghost borders — use at 15% opacity only */
  outlineVariant: '#55423f',

  // ── Surface Tint ──────────────────────────────────────────────────────────
  surfaceTint: '#ffb4a8',

  // ── Error ─────────────────────────────────────────────────────────────────
  error: '#ffb4ab',
  errorContainer: '#93000a',
  onError: '#690005',
  onErrorContainer: '#ffdad6',
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------
export const Typography = {
  /**
   * System fonts only — no custom install required.
   * On iOS: SF Pro; on Android: Roboto.
   * Apply size + weight hierarchy from the Kinetic Atelier spec.
   */
  fontFamily: undefined as string | undefined,

  sizes: {
    /** ALL-CAPS micro metadata, chips */
    label: 11,
    /** Body copy, instructions */
    bodyS: 13,
    body: 14,
    bodyL: 16,
    /** Card titles, nav labels */
    title: 18,
    titleL: 20,
    /** Section headlines */
    headline: 24,
    headlineL: 30,
    /** Screen-level display title */
    display: 32,
    /** Hero milestone numbers — Day 45, 90% etc. */
    displayHero: 56,
  },

  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
    black: '900' as const,
  },

  /** Tracking (letterSpacing) values */
  tracking: {
    tight: -1.5,
    normal: 0,
    wide: 1,
    /** ALL-CAPS label tracking */
    widest: 2,
  },
};

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------
export const Spacing = {
  /** 4px */
  xs: 4,
  /** 8px */
  sm: 8,
  /** 12px */
  md: 12,
  /** 16px */
  lg: 16,
  /** 20px — minimum horizontal screen padding per design spec */
  xl: 20,
  /** 24px */
  xxl: 24,
  /** 32px */
  xxxl: 32,
  /** 48px — section separation */
  hero: 48,
};

// ---------------------------------------------------------------------------
// Border Radius
// ---------------------------------------------------------------------------
export const Radius = {
  /** 2px — micro chips, sub-items */
  xs: 2,
  /** 6px — internal nested rows */
  sm: 6,
  /** 10px — standard cards */
  md: 10,
  /** 14px — large card containers */
  lg: 14,
  /** 18px — modals, drawers */
  xl: 18,
  /** 999px — pill buttons, progress rings, avatar circles */
  full: 999,
};
