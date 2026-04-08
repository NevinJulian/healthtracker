// Design tokens for the 90-Day Health Tracker app.
// Dark, premium fitness aesthetic.

export const Colors = {
  // Base surfaces
  background: '#0D0F14',
  surface: '#161A23',
  surfaceElevated: '#1E2330',
  border: '#2A3145',

  // Brand / accent
  accent: '#00E5A0',        // Electric teal-green
  accentDark: '#00B880',
  accentGlow: 'rgba(0, 229, 160, 0.15)',

  // Secondary accent
  secondary: '#7C6FF7',     // Violet
  secondaryGlow: 'rgba(124, 111, 247, 0.15)',

  // Semantic
  success: '#00E5A0',
  warning: '#FFB547',
  danger: '#FF5C5C',
  rest: '#4A5568',

  // Text
  textPrimary: '#F0F4FF',
  textSecondary: '#8892A4',
  textMuted: '#4A5568',

  // Completion badges
  badgeComplete: '#00E5A0',
  badgePartial: '#FFB547',
  badgeNone: '#2A3145',
  badgeRest: '#4A5568',
};

export const Typography = {
  fontFamily: undefined as string | undefined, // Uses system font; extend with expo-font if needed
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};
