import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';
import { AccentFamily } from './IconChip';

export interface PillProps {
  /** Text label or numeric count to display */
  label: string | number;
  /** Accent colour family for tint bg + deep-shade text */
  accent?: AccentFamily;
  style?: StyleProp<ViewStyle>;
}

const PILL_BG: Record<AccentFamily, string> = {
  sage: Colors.sageTint,
  clay: Colors.clayTint,
  sky: Colors.skyTint,
  gold: Colors.goldTint,
};

const PILL_TEXT: Record<AccentFamily, string> = {
  sage: Colors.sageDeep,
  clay: Colors.clayDeep,
  sky: Colors.skyDeep,
  gold: Colors.goldDeep,
};

/**
 * Verdure Pill — 999-radius small label or count badge.
 * Tint background + deep-shade text per accent family (DESIGN.md §2).
 */
export default function Pill({ label, accent = 'sage', style }: PillProps) {
  return (
    <View style={[styles.pill, { backgroundColor: PILL_BG[accent] }, style]}>
      <Text style={[styles.text, { color: PILL_TEXT[accent] }]}>
        {String(label)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs - 1,
    alignSelf: 'flex-start',
    minWidth: 24,
    alignItems: 'center',
  },
  text: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
});
