// Design tokens for the HealthTracker app.
// Verdure — calm-wellness aesthetic (warm linen, sage, clay, sky, gold).
// See design/verdure/DESIGN.md for the full system.

export const Colors = {
  // Base surfaces
  background: '#F3EFE7',      // warm linen canvas
  surface: '#FBF9F4',         // cards / nav surface
  surfaceElevated: '#FFFFFF', // raised cards
  border: '#E4DFD4',          // hairline (also used as Colors.border + alpha hex)

  // Brand / accent — sage
  accent: '#7C9A85',
  accentDark: '#4E6B58',
  accentGlow: 'rgba(124, 154, 133, 0.15)',

  // Secondary accent — clay (food / warmth)
  secondary: '#C98A6B',
  secondaryGlow: 'rgba(201, 138, 107, 0.15)',

  // Semantic
  success: '#7C9A85',
  warning: '#C9A86A',         // muted gold
  danger: '#C2705A',          // soft clay-red
  rest: '#8FAABF',            // calm sky

  // Text
  textPrimary: '#2C352E',     // deep pine
  textSecondary: '#5E665E',
  textMuted: '#98A096',

  // Completion badges
  badgeComplete: '#7C9A85',
  badgePartial: '#C9A86A',
  badgeNone: '#E4DFD4',
  badgeRest: '#8FAABF',

  // Verdure extended palette (new)
  sage: '#7C9A85',
  sageDeep: '#4E6B58',
  sageTint: '#E6ECE2',
  clay: '#C98A6B',
  clayDeep: '#9A5E42',
  clayTint: '#F3E6DB',
  sky: '#8FAABF',
  skyDeep: '#516675',
  skyTint: '#E4EBF0',
  gold: '#C9A86A',
  goldDeep: '#8A7434',
  goldTint: '#F1E8D4',
  canvas: '#F3EFE7',
  canvasSunken: '#ECE6DA',
};

export const Typography = {
  fontFamily: undefined as string | undefined, // system default until the fonts unit lands
  display: undefined as string | undefined,     // -> Fraunces (set in fonts unit)
  body: undefined as string | undefined,         // -> Plus Jakarta Sans (set in fonts unit)
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 26,
    hero: 34,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    black: '900' as const,
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const Radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 26,
  full: 999,
};
