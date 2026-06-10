import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'ghost';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Verdure Button.
 *
 * primary — solid sage fill, white text, radius 13.
 * ghost   — surface bg, line2-equivalent border, sageDeep text.
 */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: ButtonProps) {
  const containerStyle: StyleProp<ViewStyle> = [
    styles.base,
    variant === 'primary' ? styles.primary : styles.ghost,
    disabled && styles.disabled,
    style,
  ];

  const textStyle: StyleProp<TextStyle> = [
    styles.text,
    variant === 'primary' ? styles.primaryText : styles.ghostText,
    disabled && styles.disabledText,
  ];

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <Text style={textStyle}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 13,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primary: {
    backgroundColor: Colors.sage,
  },
  ghost: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  primaryText: {
    color: Colors.surface,
  },
  ghostText: {
    color: Colors.sageDeep,
  },
  disabledText: {
    // Opacity on the container already handles visual muting
  },
});
