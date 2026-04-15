import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/DashboardScreen';
import OverviewScreen from '../screens/OverviewScreen';
import AnalyticsDashboardScreen from '../screens/AnalyticsDashboardScreen';
import MealPrepScreen from '../screens/MealPrepScreen';
import TemplateEditorScreen from '../screens/TemplateEditorScreen';
import RecipesScreen from '../screens/RecipesScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import { Colors, Typography } from '../theme/tokens';
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
};

function DrawerIcon({ label }: { label: string }) {
  return (
    <View style={styles.iconContainer}>
      <Text style={styles.iconEmoji}>{DRAWER_ICONS[label]}</Text>
    </View>
  );
}

export default function AppNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Drawer.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        headerStyle: {
          backgroundColor: Colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: Colors.border,
        },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: {
          fontWeight: Typography.weights.bold,
          fontSize: Typography.sizes.lg,
        },
        drawerStyle: {
          backgroundColor: Colors.background,
          width: 280,
        },
        drawerActiveTintColor: Colors.accent,
        drawerInactiveTintColor: Colors.textSecondary,
        drawerActiveBackgroundColor: Colors.surface,
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
      <Drawer.Screen name="Template" component={TemplateEditorScreen} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawerLabel: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.medium,
    marginLeft: -16,
  },
  iconContainer: { 
    alignItems: 'center',
    width: 24,
  },
  iconEmoji: { fontSize: 20 },
});
