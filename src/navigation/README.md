# src/navigation — Navigation Layer

This folder contains the single file that defines the entire navigation structure of the app.

---

## Files

### `AppNavigator.tsx`

The root navigator component. It wires together a **Drawer Navigator** (right-side menu) with a **Stack Navigator** nested inside the Recipes route.

---

## Architecture

```
AppNavigator (Drawer.Navigator)
├── Today          → DashboardScreen
├── Schedule       → OverviewScreen
├── Analytics      → AnalyticsDashboardScreen
├── Meal Prep      → MealPrepScreen
├── Recipes        → RecipesStackScreen
│     ├── RecipesMain → RecipesScreen
│     └── RecipeDetail → RecipeDetailScreen
├── Shopping       → ShoppingListScreen
├── Cooking Tasks  → CookingTasksScreen
└── Template       → TemplateEditorScreen
```

---

## Key Design Decisions

### Hamburger on the Right
The default React Navigation drawer puts the hamburger icon on the **left** (where the drawer also opens from). We've overridden this so:
- `headerLeft: () => null` — suppresses the default left icon
- `headerRight: () => <HeaderRightMenu />` — renders our custom 3-line button on the right
- `drawerPosition: 'right'` — the drawer slides in from the **right**, matching the button position

### Custom Drawer Icons
Each route has an emoji icon defined in `DRAWER_ICONS`:

```typescript
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
```

The `DrawerIcon` component renders the emoji in a fixed-width `View` (28px) to ensure consistent alignment. The `drawerLabelStyle` adds `marginLeft: 12` to prevent the text from touching the icon.

### RecipesStackScreen
Because the Recipe Detail view requires a push navigation (not a drawer navigation), the Recipes route wraps two screens in a Stack Navigator:
- `RecipesMain` — the category browse list
- `RecipeDetail` — the single recipe detail view

Both have `headerShown: false` since the outer Drawer Navigator already provides the header.

---

## Theming

All navigation chrome uses the centralized `Colors`, `Typography`, and `Spacing` tokens from `src/theme/tokens.ts`:

| Property | Token |
|---|---|
| `headerStyle.backgroundColor` | `Colors.surface` |
| `headerTintColor` | `Colors.textPrimary` |
| `drawerStyle.backgroundColor` | `Colors.background` |
| `drawerActiveTintColor` | `Colors.accent` |
| `drawerActiveBackgroundColor` | `Colors.surface` |

---

## Safe Area Behaviour

All screens are rendered **below** the Drawer Navigator's native header, which handles the top safe area automatically. Individual screens should **not** apply `paddingTop: insets.top` in their own headers — this causes double spacing. Screens use a fixed `paddingTop: 8` for their internal sub-headers only.

The `InstructionsModal` in `CookingTasksScreen` is an exception — it is a full-screen modal that overrides the navigation stack, so it manages its own `insets.top` via `useSafeAreaInsets`.
