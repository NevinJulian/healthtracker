import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/DashboardScreen';
import OverviewScreen from '../screens/OverviewScreen';
import MealPrepScreen from '../screens/MealPrepScreen';
import { Colors, Typography } from '../theme/tokens';

const Tab = createBottomTabNavigator();

// ─── Tab icon ─────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, string> = {
  Today: '🏋️',
  '90 Days': '📅',
  'Meal Prep': '🥗',
};

function TabIcon({ label }: { label: string }) {
  return (
    <View style={styles.iconContainer}>
      <Text style={styles.iconEmoji}>{TAB_ICONS[label]}</Text>
    </View>
  );
}

// ─── Navigator ────────────────────────────────────────────────────────────────

export default function AppNavigator() {
  // Safe area insets give us the bottom padding required to clear the system
  // navigation bar on Android (gesture nav bar / 3-button nav / notch devices).
  const insets = useSafeAreaInsets();

  // Tab bar total height = visible content (62px) + system bottom inset.
  const tabBarHeight = 62 + insets.bottom;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          ...styles.tabBarBase,
          height: tabBarHeight,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => (
          <TabIcon label={route.name} />
        ),
      })}
    >
      <Tab.Screen name="Today" component={DashboardScreen} />
      <Tab.Screen name="90 Days" component={OverviewScreen} />
      <Tab.Screen name="Meal Prep" component={MealPrepScreen} />
    </Tab.Navigator>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Base tab bar properties — height & paddingBottom are applied dynamically above.
  tabBarBase: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    marginTop: 2,
  },
  iconContainer: {
    alignItems: 'center',
  },
  iconEmoji: {
    fontSize: 20,
  },
});
