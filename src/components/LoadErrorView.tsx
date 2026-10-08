import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '../theme/tokens';
import Button from './Button';

export interface LoadErrorViewProps {
  variant: 'screen' | 'banner';
  onRetry: () => void;
  title?: string;
}

export default function LoadErrorView({ variant, onRetry, title }: LoadErrorViewProps) {
  if (variant === 'banner') {
    return (
      <View style={styles.refreshBanner}>
        <Text style={styles.refreshBannerText}>
          Couldn't refresh. Showing the last loaded data.
        </Text>
        <Button
          title="Retry"
          accessibilityLabel="Retry"
          variant="ghost"
          onPress={onRetry}
          style={styles.refreshBannerRetry}
        />
      </View>
    );
  }

  return (
    <View style={styles.errorState}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorSub}>Your data is safe. Try again.</Text>
      <Button
        title="Retry"
        accessibilityLabel="Retry"
        onPress={onRetry}
        style={styles.errorRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  errorTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  errorSub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  errorRetry: {
    marginTop: Spacing.md,
  },
  refreshBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.md,
  },
  refreshBannerText: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.clayDeep,
  },
  refreshBannerRetry: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
});
