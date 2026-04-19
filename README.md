# 🏋️ HealthTracker — Fitness & Meal Prep App

A comprehensive personal health tracking application built with **Expo** and **React Native**. The app combines a perpetual 7-day rolling fitness schedule, a recipe library with macro tracking, meal preparation workflow, and a shopping/cooking pipeline — all backed by a local **SQLite** database.

---

## 📱 Purpose

HealthTracker replaces static 90-day fitness plans with a **dynamic, perpetual rolling schedule** that:

- Generates today's workout, walking task, and fasting plan automatically
- Tracks completion for every day in the rolling 7-day window
- Manages meal prep: recipes → shopping list → cooking queue → inventory → weekly meal plan
- Provides analytics and weight trend charts

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Expo SDK 54](https://expo.dev) (React Native 0.81) |
| Language | TypeScript 5.9 |
| Database | [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) (local SQLite on-device) |
| Navigation | [@react-navigation/drawer](https://reactnavigation.org/docs/drawer-navigator) + [@react-navigation/stack](https://reactnavigation.org/docs/stack-navigator) |
| Styling | Vanilla React Native `StyleSheet` with a centralized design token system (`src/theme/tokens.ts`) |
| Gestures | react-native-gesture-handler + react-native-reanimated |
| Safe Area | react-native-safe-area-context |
| Build & Distribution | [EAS (Expo Application Services)](https://docs.expo.dev/eas/) |

---

## 🗄 Database Architecture — 7-Day Rolling Window

The core architectural pattern is a **perpetual rolling schedule** backed by two tables:

### `weekly_template`
Defines the base task for each day of the week (Monday–Sunday):
- `day_of_week` (0=Sun, 1=Mon, …, 6=Sat)
- `walking_task` — description of the daily walk
- `hammer_task` — base gym task label (weight suffix is appended automatically)
- `exercises` — JSON array of exercises for the Hammer Multi-Gym
- `is_rest_day`, `is_meal_prep_day` flags

### `daily_logs`
Generated daily records for the rolling window (past 3 days + today + future 3 days):
- `date` (ISO YYYY-MM-DD, primary key)
- `walking_task`, `hammer_task` — resolved task descriptions including auto-calculated weight suffix
- `walk_completed`, `hammer_completed`, `fasting_completed` — boolean completion flags
- `additional_workouts` — JSON array of bonus workouts logged that day

### Rolling Sync Logic
On every app launch and screen focus:
1. `syncRollingSchedule()` is called — it generates or updates daily_logs for the rolling 7-day window
2. Weight progression uses a 21-day cycle: every 3 weeks the base weight increases automatically
3. Old logs outside the window are retained for analytics but not updated

---

## 📂 Folder Structure

```
healthtracker/
├── src/
│   ├── components/       # Reusable modals (BioForceModal)
│   ├── data/             # Static seed data (recipes, meal prep reference)
│   ├── db/               # SQLite database layer (schema, migrations, queries)
│   ├── navigation/       # AppNavigator (Drawer + Stack setup)
│   ├── screens/          # All screen components
│   └── theme/            # Design token system (colors, spacing, typography)
├── assets/               # App icons, splash screen images
├── App.tsx               # Root component — wraps NavigationContainer + SafeAreaProvider
├── index.ts              # Expo entry point
├── eas.json              # EAS Build profiles (preview APK, production bundle)
├── app.json              # Expo app configuration (name, slug, version, permissions)
└── package.json          # NPM scripts, dependencies
```

---

## 🚀 Running Locally

### Prerequisites
- Node.js 18+
- Expo Go app on your Android/iOS device **OR** an Android emulator

### Steps

```bash
# Install dependencies
npm install

# Start the Expo dev server (clears cache)
npx expo start -c

# Then scan the QR code with Expo Go, or press:
# a — open Android emulator
# w — open web browser
```

---

## 📦 Building an APK (Physical Android Device)

Use **EAS Build** to compile a real `.apk` file in the cloud, then install it directly on any Android device — no Expo Go required.

### One-time setup
```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to your Expo account
eas login
```

### Trigger the APK build

```bash
# Via npm script (defined in package.json)
npm run build:apk

# Or directly
eas build -p android --profile preview
```

After ~5-10 minutes, EAS outputs a **download URL and QR code** in the terminal. Install the `.apk` by scanning the QR or opening the URL on your device.

> **Note:** The `preview` profile in `eas.json` is configured with `"distribution": "internal"` and `"buildType": "apk"`. This means no Play Store submission is needed — install it directly.

---

## 🔧 Available Scripts

| Script | Command | Description |
|---|---|---|
| `start` | `expo start` | Start Expo dev server |
| `android` | `expo start --android` | Open Android emulator |
| `ios` | `expo start --ios` | Open iOS simulator |
| `web` | `expo start --web` | Open in browser |
| `build:apk` | `eas build -p android --profile preview` | Build downloadable APK via EAS |
| `build:android-bundle` | `eas build -p android --profile production` | Build Play Store AAB via EAS |
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |

---

## 📋 Screens Overview

| Screen | Route Name | Description |
|---|---|---|
| Today (Dashboard) | `Today` | Main dashboard: today's tasks, weight log, bonus workouts |
| Schedule | `Schedule` | 7-day rolling window with completion badges |
| Analytics | `Analytics` | 7/30-day completion rates & weight trend chart |
| Meal Prep (Planner) | `Meal Prep` | Weekly meal plan + cooked meal inventory |
| Recipes | `Recipes` | Browse 100+ macro-friendly recipes by category |
| Shopping | `Shopping` | Auto-generated shopping list from recipe ingredients |
| Cooking Tasks | `Cooking Tasks` | Step-by-step cooking queue → auto-updates inventory |
| Template Editor | `Template` | Edit the base weekly workout template |

---

## 🤝 Contributing Workflow

This project uses **atomic commits** referencing GitHub issue numbers (e.g. `fix: resolve drawer overlap (#105)`).

1. Create a GitHub issue for your change
2. Branch from `main`: `git checkout -b feature/your-feature`
3. Commit atomically with issue references
4. Push and open a PR via GitHub
5. Squash merge into `main` and close issues
