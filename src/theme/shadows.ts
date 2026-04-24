/**
 * Kinetic Atelier — Shadow, Gradient & Glassmorphism Helpers
 *
 * Implements the "Ambient Shadow", "Soul Gradient", and "Glass & Gradient"
 * rules from the Stitch DESIGN.md specification.
 *
 * Issue #190
 */

import { StyleSheet, Platform } from 'react-native';
import { Colors } from './tokens';

// ---------------------------------------------------------------------------
// Soul Gradient — Primary CTA buttons
// ---------------------------------------------------------------------------
/**
 * Colors array for LinearGradient: "Soul Gradient" from coral to warm red.
 * Use with expo-linear-gradient or any gradient component.
 *
 * @example
 * <LinearGradient colors={soulGradientColors} start={{x:0,y:0}} end={{x:1,y:1}}>
 */
export const soulGradientColors: [string, string] = [
  Colors.primary,         // #ffb4a8 — coral start
  Colors.primaryContainer, // #e67e6e — warm red end
];

// ---------------------------------------------------------------------------
// Ambient Shadow — Floating elements
// ---------------------------------------------------------------------------
/**
 * Soft ambient glow shadow. Use on floating cards, FABs, and CTAs.
 * NOT a harsh drop shadow — feels like a soft elevation halo.
 */
export const ambientShadow = StyleSheet.create({
  primary: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 6, // Android
  },
  surface: {
    shadowColor: Colors.onSurface,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 32,
    elevation: 4,
  },
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
});

// ---------------------------------------------------------------------------
// Glassmorphism — Floating panels and FABs
// ---------------------------------------------------------------------------
/**
 * Glass panel style.
 * Note: React Native doesn't support backdrop-filter natively on Android.
 * We approximate with a semi-transparent surface-highest background.
 */
export const glassPanel = {
  backgroundColor: `${Colors.surfaceHighest}99`, // 60% opacity
  // iOS backdrop blur via blurRadius on ImageBackground if needed
  borderColor: `${Colors.outlineVariant}26`, // 15% opacity ghost border
  borderWidth: StyleSheet.hairlineWidth,
};

// ---------------------------------------------------------------------------
// Accent Bars — Workout category indicators
// ---------------------------------------------------------------------------
/**
 * 4px left accent bar for STRENGTH (calm blue) workout cards.
 * Apply to the card container view.
 */
export const accentBarStrength = {
  borderLeftWidth: 4,
  borderLeftColor: Colors.secondary, // #a9cdd2
};

/**
 * 4px left accent bar for CARDIO / LISS (muted green) workout cards.
 * Apply to the card container view.
 */
export const accentBarCardio = {
  borderLeftWidth: 4,
  borderLeftColor: Colors.tertiary, // #b0cfad
};

// ---------------------------------------------------------------------------
// Ghost Border — Rarely used; only for complex data tables
// ---------------------------------------------------------------------------
/**
 * "Ghost Border" per the No-Line rule: outline-variant at 15% opacity.
 * Use only when a visual boundary is absolutely required.
 */
export const ghostBorder = {
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: `${Colors.outlineVariant}26`, // 15% opacity
};
