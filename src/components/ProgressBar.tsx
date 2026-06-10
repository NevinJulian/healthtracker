import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing } from '../theme/tokens';

export interface ProgressBarProps {
  /** Fill ratio from 0 to 1 */
  progress: number;
  /** Track height in points. Defaults to 8. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Verdure ProgressBar — sage fill on canvasSunken track, rounded caps.
 * Pass a `progress` value between 0 and 1.
 */
export default function ProgressBar({ progress, height = 8, style }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }, style]}>
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
