import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import DashboardScreen from '../screens/DashboardScreen';
import OverviewScreen from '../screens/OverviewScreen';
import AnalyticsDashboardScreen from '../screens/AnalyticsDashboardScreen';
import MealPrepScreen from '../screens/MealPrepScreen';
import TemplateEditorScreen from '../screens/TemplateEditorScreen';
import RecipesScreen from '../screens/RecipesScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import CookingTasksScreen from '../screens/CookingTasksScreen';
import { Colors, Typography, Spacing } from '../theme/tokens';
import { createStackNavigator } from '@react-navigation/stack';

const Drawer = createDrawerNavigator();
const RecipeStack = createStackNavigator();

function RecipesStackScreen() {
  return (
    <RecipeStack.Navigator screenOptions={{ headerShown: false }}>
      <RecipeStack.Screen name="RecipesMain" component={RecipesScreen} />
      <RecipeStack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
    </RecipeStack.Navigator>
  );
}

const DRAWER_ICONS: Record<string, string> = {
  Today: '🏋️',
  Schedule: '📅',
  Analytics: '📊',
  'Meal Prep': '🥗',
  Template: '✏️',
  Recipes: '🍽️',
  Shopping: '🛒',
  'Cooking Tasks': '👨‍🍳',
};

function DrawerIcon({ label }: { label: string }) {
  return (
    <View style={styles.iconContainer}>
      <Text style={styles.iconEmoji}>{DRAWER_ICONS[label] ?? '•'}</Text>
    </View>
  );
}

/** Hamburger button rendered on the RIGHT side of every header. */
function HeaderRightMenu() {
  const navigation = useNavigation();
  return (
    <TouchableOpacity
      style={styles.burgerBtn}
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel="Open navigation menu"
      accessibilityRole="button"
    >
      <View style={styles.burgerLine} />
      <View style={styles.burgerLine} />
      <View style={styles.burgerLine} />
    </TouchableOpacity>
  );
}

export default function AppNavigator() {
  return (
    <Drawer.Navigator
      screenOptions={({ route }) => ({
        // ── Header ──────────────────────────────────────────────
        headerShown: true,
        headerStyle: {
          backgroundColor: Colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: Colors.border,
        } as any,
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: {
          fontWeight: Typography.weights.bold,
          fontSize: Typography.sizes.lg,
        },
        // Move burger to the RIGHT, suppress default left icon
        headerLeft: () => null,
        headerRight: () => <HeaderRightMenu />,
        // ── Drawer ──────────────────────────────────────────────
        drawerStyle: {
          backgroundColor: Colors.background,
          width: 280,
        },
        drawerActiveTintColor: Colors.accent,
        drawerInactiveTintColor: Colors.textSecondary,
        drawerActiveBackgroundColor: Colors.surface,
        // Give the label a proper left gap so it doesn't touch the emoji
        drawerLabelStyle: styles.drawerLabel,
        drawerIcon: () => <DrawerIcon label={route.name} />,
      })}
    >
      <Drawer.Screen name="Today" component={DashboardScreen} />
      <Drawer.Screen name="Schedule" component={OverviewScreen} />
      <Drawer.Screen name="Analytics" component={AnalyticsDashboardScreen} />
      <Drawer.Screen name="Meal Prep" component={MealPrepScreen} />
      <Drawer.Screen name="Recipes" component={RecipesStackScreen} />
      <Drawer.Screen name="Shopping" component={ShoppingListScreen} />
      <Drawer.Screen name="Cooking Tasks" component={CookingTasksScreen} />
      <Drawer.Screen name="Template" component={TemplateEditorScreen} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  // Drawer label — positive marginLeft gives breathing room after the icon
  drawerLabel: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.medium,
    marginLeft: 4,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  iconEmoji: { fontSize: 20 },

  // Right-side hamburger
  burgerBtn: {
    marginRight: Spacing.lg,
    gap: 5,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  burgerLine: {
    height: 2,
    width: 22,
    borderRadius: 2,
    backgroundColor: Colors.textPrimary,
  },
});
