import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/DashboardScreen';
import OverviewScreen from '../screens/OverviewScreen';
import AnalyticsDashboardScreen from '../screens/AnalyticsDashboardScreen';
import MealPrepScreen from '../screens/MealPrepScreen';
import TemplateEditorScreen from '../screens/TemplateEditorScreen';
import { Colors, Typography } from '../theme/tokens';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Today: '🏋️',
  Schedule: '📅',
  Analytics: '📊',
  'Meal Prep': '🥗',
  Template: '✏️',
};

function TabIcon({ label }: { label: string }) {
  return (
    <View style={styles.iconContainer}>
      <Text style={styles.iconEmoji}>{TAB_ICONS[label]}</Text>
    </View>
  );
}

export default function AppNavigator() {
  const insets = useSafeAreaInsets();
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
        tabBarIcon: () => <TabIcon label={route.name} />,
      })}
    >
      <Tab.Screen name="Today" component={DashboardScreen} />
      <Tab.Screen name="Schedule" component={OverviewScreen} />
      <Tab.Screen name="Analytics" component={AnalyticsDashboardScreen} />
      <Tab.Screen name="Meal Prep" component={MealPrepScreen} />
      <Tab.Screen name="Template" component={TemplateEditorScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
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
  iconContainer: { alignItems: 'center' },
  iconEmoji: { fontSize: 20 },
});
