# src/navigation — Navigation Layer

This folder contains the single file that defines the entire navigation structure of the app.

---

## Files

### `AppNavigator.tsx`

The root navigator component. It wires together a **Drawer Navigator** (right-side menu) with a **Stack Navigator** nested inside both the Recipes and Discover routes.

---

## Architecture

```
AppNavigator (Drawer.Navigator)
├── Today          → DashboardScreen
├── Schedule       → OverviewScreen
├── Analytics      → AnalyticsDashboardScreen
├── Meal Prep      → MealPrepScreen
├── Recipes        → RecipesStackScreen
│     ├── RecipesMain   → RecipesScreen
│     ├── RecipeDetail  → RecipeDetailScreen
│     └── RecipeEditor  → RecipeEditorScreen
├── Discover       → DiscoverStackScreen
│     ├── DiscoverMain   → DiscoverScreen
│     └── DiscoverDetail → DiscoverDetailScreen
├── Shopping       → ShoppingListScreen
├── Cooking Tasks  → CookingTasksScreen
├── Template       → TemplateEditorScreen
└── Settings       → SettingsScreen
```

---

## Key Design Decisions

### Hamburger on the Right
The default React Navigation drawer puts the hamburger icon on the **left** (where the drawer also opens from). We've overridden this so:
- `headerLeft: () => null` — suppresses the default left icon
- `headerRight: () => <HeaderRightMenu />` — renders our custom 3-line button on the right
- `drawerPosition: 'right'` — the drawer slides in from the **right**, matching the button position

### Custom Drawer Icons
Each route has an `@expo/vector-icons` Ionicons name defined in `DRAWER_ICONS`:

```typescript
const DRAWER_ICONS: Record<string, IoniconsName> = {
  Today: 'barbell-outline',
  Schedule: 'calendar-outline',
  Analytics: 'stats-chart-outline',
  'Meal Prep': 'nutrition-outline',
  Template: 'create-outline',
  Recipes: 'restaurant-outline',
  Discover: 'compass-outline',
  Shopping: 'cart-outline',
  'Cooking Tasks': 'flame-outline',
  Settings: 'settings-outline',
};
```

The `DrawerIcon` component renders the `Ionicons` glyph in a fixed-width `View` (28px) to ensure consistent alignment. The `drawerLabelStyle` adds `marginLeft: Spacing.sm` to prevent the text from touching the icon.

### RecipesStackScreen and DiscoverStackScreen
Because the Recipe Detail / Recipe Editor and Discover Detail views require push navigation (not drawer navigation), the Recipes and Discover routes each wrap their screens in their own Stack Navigator:
- `RecipesStackScreen`: `RecipesMain` (category browse list) → `RecipeDetail` (single recipe view) → `RecipeEditor` (create/edit a recipe)
- `DiscoverStackScreen`: `DiscoverMain` (external recipe search) → `DiscoverDetail` (single discovered recipe view)

All of these have `headerShown: false` since the outer Drawer Navigator already provides the header.

---

## Theming

All navigation chrome uses the centralized `Colors`, `Typography`, and `Spacing` tokens from `src/theme/tokens.ts`:

| Property | Token |
|---|---|
| `headerStyle.backgroundColor` | `Colors.surface` |
| `headerTintColor` | `Colors.textPrimary` |
| `drawerStyle.backgroundColor` | `Colors.background` |
| `drawerActiveTintColor` | `Colors.sageDeep` |
| `drawerActiveBackgroundColor` | `Colors.sageTint` |

---

## Safe Area Behaviour

All screens are rendered **below** the Drawer Navigator's native header, which handles the top safe area automatically. Individual screens should **not** apply `paddingTop: insets.top` in their own headers — this causes double spacing. Screens use a fixed `paddingTop: 8` for their internal sub-headers only.

The `InstructionsModal` in `CookingTasksScreen` is an exception — it is a full-screen modal that overrides the navigation stack, so it manages its own `insets.top` via `useSafeAreaInsets`.
