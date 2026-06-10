import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from '../screens/DashboardScreen';
import OverviewScreen from '../screens/OverviewScreen';
import AnalyticsDashboardScreen from '../screens/AnalyticsDashboardScreen';
import MealPrepScreen from '../screens/MealPrepScreen';
import TemplateEditorScreen from '../screens/TemplateEditorScreen';
import RecipesScreen from '../screens/RecipesScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import CookingTasksScreen from '../screens/CookingTasksScreen';
import { Colors, Typography, Spacing, Radius } from '../theme/tokens';
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

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const DRAWER_ICONS: Record<string, IoniconsName> = {
  Today: 'barbell-outline',
  Schedule: 'calendar-outline',
  Analytics: 'stats-chart-outline',
  'Meal Prep': 'nutrition-outline',
  Template: 'create-outline',
  Recipes: 'restaurant-outline',
  Shopping: 'cart-outline',
  'Cooking Tasks': 'flame-outline',
};

function DrawerIcon({ label, focused }: { label: string; focused?: boolean }) {
  const iconName: IoniconsName = DRAWER_ICONS[label] ?? 'ellipse-outline';
  const color = focused ? Colors.sageDeep : Colors.textSecondary;
  return (
    <View style={styles.iconContainer}>
      <Ionicons name={iconName} size={20} color={color} />
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
          // Hairline bottom border — depth via tone, not hard lines
          borderBottomWidth: 1,
          borderBottomColor: Colors.line,
        } as any,
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: {
          fontFamily: Typography.display,
          fontSize: Typography.sizes.xl,
        },
        // Move burger to the RIGHT, suppress default left icon
        headerLeft: () => null,
        headerRight: () => <HeaderRightMenu />,
        // ── Drawer ──────────────────────────────────────────────
        drawerPosition: 'right',
        drawerStyle: {
          backgroundColor: Colors.background,
          width: 280,
        },
        // Active item: sage-deep text on sage tint background
        drawerActiveTintColor: Colors.sageDeep,
        drawerInactiveTintColor: Colors.textSecondary,
        drawerActiveBackgroundColor: Colors.sageTint,
        // Label: Plus Jakarta Sans 600, medium size
        drawerLabelStyle: styles.drawerLabel,
        // Rounded active item background per Verdure shape language
        drawerItemStyle: styles.drawerItem,
        drawerIcon: ({ focused }: { focused: boolean }) => (
          <DrawerIcon label={route.name} focused={focused} />
        ),
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
  // Drawer label — Plus Jakarta Sans 600 SemiBold, breathing room after emoji icon
  drawerLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    marginLeft: Spacing.sm,
  },
  // Rounded item background — Verdure shape language (cards/rows are soft + rounded)
  drawerItem: {
    borderRadius: Radius.md,
    marginHorizontal: Spacing.sm,
    marginVertical: 2,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },

  // Right-side hamburger — token color, no raw hex
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
    borderRadius: Radius.sm / 5,
    backgroundColor: Colors.textPrimary,
  },
});
