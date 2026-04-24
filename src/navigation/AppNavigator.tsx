/**
 * Kinetic Atelier — App Navigator
 *
 * Right-side drawer navigation styled to match the Stitch design spec:
 * - Deep slate (#0c0e10) drawer background
 * - Coral (#ffb4a8) primary accent for active items and hamburger icon
 * - KINETIC wordmark as header title
 * - Transparent gradient header (no bottom border)
 * - No emoji icons — text-based icon labels styled with system font
 *
 * Issues #192, #193, #194, #195
 */

import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
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
import { Colors, Spacing, Typography } from '../theme/tokens';
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

// ---------------------------------------------------------------------------
// Icon labels — clean Unicode symbols, no emoji, styled with design tokens
// ---------------------------------------------------------------------------
const DRAWER_ICON_LABELS: Record<string, string> = {
  Today:           '◈',
  Schedule:        '⊟',
  Analytics:       '▲',
  'Meal Prep':     '◉',
  Template:        '⊞',
  Recipes:         '◎',
  Shopping:        '◧',
  'Cooking Tasks': '◈',
};

function DrawerIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.iconContainer}>
      <Text style={[styles.iconSymbol, focused && styles.iconSymbolActive]}>
        {DRAWER_ICON_LABELS[label] ?? '·'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Header — KINETIC wordmark + coral hamburger
// ---------------------------------------------------------------------------

/** KINETIC coral wordmark rendered as the header title. */
function HeaderTitle() {
  return (
    <Text style={styles.headerWordmark}>KINETIC</Text>
  );
}

/** Coral hamburger button on the RIGHT side of every header. */
function HeaderRightMenu() {
  const navigation = useNavigation();
  return (
    <TouchableOpacity
      style={styles.burgerBtn}
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityLabel="Open navigation menu"
      accessibilityRole="button"
    >
      <View style={styles.burgerLine} />
      <View style={[styles.burgerLine, styles.burgerLineMid]} />
      <View style={styles.burgerLine} />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Navigator
// ---------------------------------------------------------------------------

export default function AppNavigator() {
  return (
    <Drawer.Navigator
      screenOptions={({ route }) => ({
        // ── Header — transparent, gradient from background ───────────────────
        headerShown: true,
        headerTransparent: true,
        headerStyle: {
          backgroundColor: 'transparent',
        } as any,
        // No bottom border line — use gradient fade in each screen instead
        headerShadowVisible: false,
        headerLeft: () => null,
        headerTitle: () => <HeaderTitle />,
        headerRight: () => <HeaderRightMenu />,
        headerTitleAlign: 'center',

        // ── Drawer — deep slate, right-side ──────────────────────────────────
        drawerPosition: 'right',
        drawerStyle: {
          backgroundColor: Colors.surfaceLowest, // #0c0e10
          width: 280,
        },
        // Active item: coral text + subtle coral background tint
        drawerActiveTintColor: Colors.primary,          // #ffb4a8
        drawerInactiveTintColor: `${Colors.onSurface}99`, // 60% opacity
        drawerActiveBackgroundColor: `${Colors.primary}1a`, // ~10% opacity
        // Label style — Inter system font, 11px ALL-CAPS, wide tracking
        drawerLabelStyle: styles.drawerLabel,
        drawerItemStyle: styles.drawerItem,
        drawerIcon: ({ focused }) => <DrawerIcon label={route.name} focused={focused} />,
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Header — KINETIC wordmark
  headerWordmark: {
    fontSize: 22,
    fontWeight: Typography.weights.black,
    letterSpacing: -1,
    color: Colors.primary,          // Coral
    textTransform: 'uppercase',
  },

  // Hamburger (right)
  burgerBtn: {
    marginRight: Spacing.xl,        // 20px from right edge
    gap: 5,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  burgerLine: {
    height: 2,
    width: 22,
    borderRadius: 2,
    backgroundColor: Colors.primary, // Coral lines
  },
  burgerLineMid: {
    width: 16,                        // Slightly shorter middle line for style
  },

  // Drawer items
  drawerLabel: {
    fontSize: Typography.sizes.label, // 11px
    fontWeight: Typography.weights.bold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  drawerItem: {
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 2,
  },

  // Drawer icon symbol
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  iconSymbol: {
    fontSize: 16,
    color: `${Colors.onSurface}99`,
  },
  iconSymbolActive: {
    color: Colors.primary,
  },
});
