import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import DashboardScreen from '../screens/DashboardScreen';
import OverviewScreen from '../screens/OverviewScreen';
import MealPrepScreen from '../screens/MealPrepScreen';
import { Colors, Typography } from '../theme/tokens';

const Tab = createBottomTabNavigator();

// ─── Minimalist icon components ──────────────────────────────────────────────

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Today: '🏋️',
    '90 Days': '📅',
    'Meal Prep': '🥗',
  };
  return (
    <View style={styles.iconContainer}>
      <Text style={styles.iconEmoji}>{icons[label]}</Text>
    </View>
  );
}

// ─── Navigator ────────────────────────────────────────────────────────────────

export default function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => (
          <TabIcon label={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Today" component={DashboardScreen} />
      <Tab.Screen name="90 Days" component={OverviewScreen} />
      <Tab.Screen name="Meal Prep" component={MealPrepScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 62,
    paddingBottom: 8,
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
