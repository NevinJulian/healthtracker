# src/screens — Application Screens

This directory contains the main views and full-page components of the HealthTracker application.

## Overview

Each file typically corresponds to a specific route in the React Navigation setup (found in `src/navigation/AppNavigator.tsx`).

### Key Screens

- `OnboardingScreen.tsx` - First-launch profile setup (height, age, sex, activity level, goal type). Rendered directly from `App.tsx`, not a drawer route.
- `DashboardScreen.tsx` (Today) - The primary entry point showing today's tasks, the weight log, and bonus workouts.
- `OverviewScreen.tsx` (Schedule) - Displays the 7-day rolling window schedule with completion states.
- `AnalyticsDashboardScreen.tsx` (Analytics) - Provides 7-day and 30-day view charts, analyzing completion rates and weight trends.
- `MealPrepScreen.tsx` (Meal Prep) - Weekly meal planner and inventory view.
- `RecipesScreen.tsx`, `RecipeDetailScreen.tsx` & `RecipeEditorScreen.tsx` (Recipes) - The recipe library browsing, detail-viewing and create/edit interface.
- `DiscoverScreen.tsx` & `DiscoverDetailScreen.tsx` (Discover) - Search and view recipes from the external, keyless TheMealDB source.
- `ShoppingListScreen.tsx` (Shopping) - An auto-generated list of ingredients derived from selected recipes.
- `CookingTasksScreen.tsx` (Cooking Tasks) - A step-by-step queue to track active meal preparations before they enter inventory.
- `TemplateEditorScreen.tsx` (Template) - Allows fine-tuning the base weekly workout template.
- `SettingsScreen.tsx` (Settings) - Reminders, nutrition goals, profile, and JSON backup/restore.

## Convention
- Use React Native's standard `StyleSheet` alongside the app's centralized `tokens.ts`.
- Avoid adding excess top padding directly; top margins are handled by React Navigation's header setup.
