/**
 * Kinetic Atelier — Typography Scale
 *
 * Implements the hierarchical voice from the Stitch design spec.
 * Uses system fonts (SF Pro on iOS, Roboto on Android) with the exact
 * size, weight, and tracking values from the design export.
 *
 * Issue #189
 */

import { TextStyle } from 'react-native';
import { Typography } from './tokens';

// ---------------------------------------------------------------------------
// Preset TextStyle objects — drop into StyleSheet.create() directly
// ---------------------------------------------------------------------------

/** Display: Day numbers, hero milestones. 56px, extrabold, tight tracking. */
export const displayHero: TextStyle = {
  fontSize: Typography.sizes.displayHero,
  fontWeight: Typography.weights.extrabold,
  letterSpacing: Typography.tracking.tight,
  lineHeight: 56,
};

/** Display: Screen-level titles like "PREP PROTOCOL". 32px, extrabold. */
export const display: TextStyle = {
  fontSize: Typography.sizes.display,
  fontWeight: Typography.weights.extrabold,
  letterSpacing: Typography.tracking.tight,
};

/** Headline L: Large section headers — "ANALYTICS", "ATELIER NUTRITION". */
export const headlineLarge: TextStyle = {
  fontSize: Typography.sizes.headlineL,
  fontWeight: Typography.weights.bold,
  letterSpacing: Typography.tracking.tight,
};

/** Headline: Screen titles, card headings. */
export const headline: TextStyle = {
  fontSize: Typography.sizes.headline,
  fontWeight: Typography.weights.bold,
  letterSpacing: -0.5,
};

/** Title L: Workout names, modal headings. */
export const titleLarge: TextStyle = {
  fontSize: Typography.sizes.titleL,
  fontWeight: Typography.weights.medium,
  letterSpacing: Typography.tracking.normal,
};

/** Title: Card titles, nav drawer items. */
export const title: TextStyle = {
  fontSize: Typography.sizes.title,
  fontWeight: Typography.weights.medium,
  letterSpacing: Typography.tracking.normal,
};

/** Body L: Descriptions, planner content. */
export const bodyLarge: TextStyle = {
  fontSize: Typography.sizes.bodyL,
  fontWeight: Typography.weights.regular,
  letterSpacing: Typography.tracking.normal,
};

/** Body: Instructions, metadata values. */
export const body: TextStyle = {
  fontSize: Typography.sizes.body,
  fontWeight: Typography.weights.regular,
  letterSpacing: Typography.tracking.normal,
};

/** Body S: Supporting text, sub-labels. */
export const bodySmall: TextStyle = {
  fontSize: Typography.sizes.bodyS,
  fontWeight: Typography.weights.regular,
  letterSpacing: Typography.tracking.normal,
};

/** Label: ALL-CAPS metadata chips. 11px, tracking widest. */
export const label: TextStyle = {
  fontSize: Typography.sizes.label,
  fontWeight: Typography.weights.regular,
  letterSpacing: Typography.tracking.widest,
  textTransform: 'uppercase',
};

/** Label Bold: Active chip labels, category tags. */
export const labelBold: TextStyle = {
  ...label,
  fontWeight: Typography.weights.bold,
};
