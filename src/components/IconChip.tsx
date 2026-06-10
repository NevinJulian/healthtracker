import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing } from '../theme/tokens';

export type AccentFamily = 'sage' | 'clay' | 'sky' | 'gold';

export interface IconChipProps {
  /** Icon content — any ReactNode (Text character, SVG, image, etc.) */
  icon: React.ReactNode;
  /** Accent colour family for tint background + icon tinting */
  accent?: AccentFamily;
  /** Override the chip size (width = height). Defaults to 40. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const ACCENT_BACKGROUNDS: Record<AccentFamily, string> = {
  sage: Colors.sageTint,
  clay: Colors.clayTint,
  sky: Colors.skyTint,
  gold: Colors.goldTint,
};

/**
 * Returns the deep shade for the given accent family, used for icon colouring
 * when callers render a text-based icon or need the value to pass to a vector icon.
 */
export function iconChipIconColor(accent: AccentFamily = 'sage'): string {
  const map: Record<AccentFamily, string> = {
    sage: Colors.sageDeep,
    clay: Colors.clayDeep,
    sky: Colors.skyDeep,
    gold: Colors.goldDeep,
  };
  return map[accent];
}

/**
 * Verdure IconChip — rounded tinted square for holding an icon.
 * Radius 12–13, tint bg + deep-shade icon colour per accent family (DESIGN.md §2).
 * Pass any ReactNode as `icon`; wrap vector icons with the deep shade colour via
 * the exported `iconChipIconColor(accent)` helper.
 */
export default function IconChip({
  icon,
  accent = 'sage',
  size = 40,
  style,
}: IconChipProps) {
  const chipStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size <= 32 ? Radius.sm - 2 : 13, // ~12–13 as spec
    backgroundColor: ACCENT_BACKGROUNDS[accent],
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <View style={[chipStyle, styles.base, style]}>
      {icon}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    // flex children centred — layout declared inline to keep size dynamic
    overflow: 'hidden',
  },
});
