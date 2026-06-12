import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing } from '../theme/tokens';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * When true, the card is exposed as a single accessible element so screen
   * readers announce it as one unit rather than reading every child separately.
   * Combine with `accessibilityLabel` for a meaningful description.
   */
  accessible?: boolean;
  /** Accessibility label used when `accessible={true}`. */
  accessibilityLabel?: string;
}

/**
 * Verdure Card — rounded surface container on canvas.
 * Radius 20, surface background, soft low-opacity shadow.
 * Use as the outer wrapper for any card-shaped content block.
 */
export default function Card({ children, style, accessible, accessibilityLabel }: CardProps) {
  return (
    <View
      style={[styles.card, style]}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    shadowColor: Colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
});
