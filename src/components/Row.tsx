import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';

export interface RowProps {
  /** Optional leading element (e.g. IconChip) */
  leading?: React.ReactNode;
  /** Primary row label — Jakarta 600 */
  title: string;
  /** Optional secondary label — body weight */
  subtitle?: string;
  /** Optional trailing element (e.g. Pill, chevron, checkbox) */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Verdure Row — the core list layout primitive.
 * Optional leading slot | title + subtitle | optional trailing slot.
 * Used across Today, Cooking, Plan and any list surface.
 */
export default function Row({ leading, title, subtitle, trailing, style }: RowProps) {
  return (
    <View style={[styles.row, style]}>
      {leading != null && <View style={styles.leadingSlot}>{leading}</View>}
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle != null && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing != null && <View style={styles.trailingSlot}>{trailing}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 52,
  },
  leadingSlot: {
    marginRight: Spacing.md,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  trailingSlot: {
    marginLeft: Spacing.md,
  },
});
