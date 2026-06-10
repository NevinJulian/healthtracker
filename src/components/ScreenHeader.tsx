import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Spacing, Typography } from '../theme/tokens';

export interface ScreenHeaderProps {
  /** Primary display title — rendered in Fraunces (display weight) */
  title: string;
  /** Optional subtitle beneath the title — rendered in body weight */
  subtitle?: string;
  /** Optional trailing action slot (e.g. a Button or icon) */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Verdure ScreenHeader — in-content display-style title block.
 * Uses Fraunces for the headline per DESIGN.md §3.
 * NOT a navigation bar replacement — screens must not add top padding;
 * the nav header owns that space. This sits below the nav bar.
 */
export default function ScreenHeader({
  title,
  subtitle,
  trailing,
  style,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.textBlock}>
        <Text style={styles.title}>{title}</Text>
        {subtitle != null && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
      </View>
      {trailing != null && (
        <View style={styles.trailingSlot}>{trailing}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xxl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    lineHeight: Typography.sizes.xxl * 1.15,
  },
  subtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  trailingSlot: {
    marginLeft: Spacing.md,
    alignSelf: 'center',
  },
});
