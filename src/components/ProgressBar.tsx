import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing } from '../theme/tokens';

export interface ProgressBarProps {
  /** Fill ratio from 0 to 1 */
  progress: number;
  /** Track height in points. Defaults to 8. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * Accessible description of this progress bar, e.g. "Hydration: 1500 of 2000 ml".
   * When provided the container is announced by screen readers as a progress bar.
   */
  accessibilityLabel?: string;
}

/**
 * Verdure ProgressBar — sage fill on canvasSunken track, rounded caps.
 * Pass a `progress` value between 0 and 1.
 *
 * Accessibility: when `accessibilityLabel` is supplied the track View is
 * exposed as a 'progressbar' role so VoiceOver/TalkBack can announce it.
 * Without a label the bar remains a presentational element.
 */
export default function ProgressBar({ progress, height = 8, style, accessibilityLabel }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));

  const a11yProps = accessibilityLabel
    ? {
        accessible: true,
        accessibilityRole: 'progressbar' as const,
        accessibilityLabel,
        accessibilityValue: { min: 0, max: 100, now: Math.round(clamped * 100) },
      }
    : {
        accessible: false,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }, style]}
      {...a11yProps}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${clamped * 100}%`,
            height,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: Colors.canvasSunken,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    backgroundColor: Colors.sage,
  },
});
