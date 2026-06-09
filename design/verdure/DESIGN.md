# Design System: Verdure — Calm Wellness

## 1. North star
HealthTracker treats a 90-day program as a calm, sustainable wellness practice rather than a hardcore grind. The mood is a quiet morning kitchen: warm linen, soft botanical greens, natural light. Soft serif headlines and a rounded sans body give it a gentle, premium feel. Restraint over intensity — generous whitespace, no harsh lines, no neon.

## 2. Color tokens
Warm, muted, low-saturation. Sage is the lead/brand accent; clay warms anything food-related; sky is for rest/recovery; gold marks streaks and highlights. The canvas is a warm linen, never pure white or black.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F3EFE7` | App background (warm linen) |
| `canvas2` | `#ECE6DA` | Recessed tracks, "missed" states |
| `surface` | `#FBF9F4` | Cards, rows, nav bar |
| `ink` | `#2C352E` | Primary text (deep pine, not black) |
| `ink2` | `#5E665E` | Secondary text |
| `mute` | `#98A096` | Labels, hints, qty |
| `sage` | `#7C9A85` | Primary accent / fills |
| `sage-d` (pine) | `#4E6B58` | Text on light, hero fills, emphasis |
| `sage-t` | `#E6ECE2` | Sage tint (chips, tracks, icon chips) |
| `clay` | `#C98A6B` | Food / meals / calories accent |
| `clay-d` | `#9A5E42` | Text on clay tint |
| `clay-t` | `#F3E6DB` | Clay tint |
| `sky` | `#8FAABF` | Rest / recovery / fasting accent |
| `sky-d` | `#516675` | Text on sky tint |
| `sky-t` | `#E4EBF0` | Sky tint |
| `gold` | `#C9A86A` | Streaks, partial states |
| `gold-d` | `#8A7434` | Text on gold tint |
| `gold-t` | `#F1E8D4` | Gold tint |
| `line` | `rgba(44,53,46,.08)` | Hairline borders |
| `line2` | `rgba(44,53,46,.15)` | Stronger borders, empty checkbox |

Rule: text on a colored tint always uses the deep shade of that same family (e.g. clay text on clay-t), never gray or black.

## 3. Typography
Two families. **Fraunces** (soft serif) for display — screen titles, big numbers (day count, weight, timers), recipe titles. **Plus Jakarta Sans** for everything else — body, rows, labels, nav.

- Display: Fraunces 600, tight tracking (-1 to -2%). Big numbers carry the personality.
- Title: Jakarta 600, 13–15px.
- Body: Jakarta 500, 12–13px, line-height ~1.45.
- Micro-label: Jakarta 700, 10px, uppercase, +0.12em tracking, `mute` color.

## 4. Shape, depth & spacing
- Radii: cards 20–24px, rows/inputs 14–18px, icon chips 12–13px, pills 999px. Soft and rounded throughout.
- Depth via tone, not hard shadows. Cards = `surface` on `canvas`. Floating device/CTA shadows are soft and low-opacity only.
- No 1px dividers between list items where avoidable — use spacing or a hairline `line`.
- Min 16px screen padding.

## 5. Components
- **Icon chip + row**: rounded tinted square icon (accent family) + title/subtitle + trailing state (check, count pill, or chevron). The core list primitive across Today, Cooking, Plan.
- **Checkbox**: 24px circle; empty = `line2` ring; done = solid `sage` with white check; completed labels go `mute` + strikethrough.
- **Hero block**: deep `sage-d` panel, white text, used for the day-count card and the active cooking timer. The one place with a strong fill.
- **Progress ring / bar**: sage fill on `canvas2`/tint track; rounded caps.
- **Buttons**: primary = solid `sage`, white text, radius 13; ghost = `surface` + `line2` border, `sage-d` text.
- **Bottom tab bar**: 5 tabs (Today, Recipes, Plan, Shop, Stats) on `surface`; active tab `sage-d`. Outline icons only.
- **Charts**: flat. Weight = sage line + soft sage-t area fill, last point a `sage-d` dot. Consistency = rounded dot grid (sage / gold / canvas2). Macros = flat donut (sage / clay / sky).

## 6. Iconography
Outline icons only (Tabler set in the mockups; map to a React Native icon set such as `@expo/vector-icons` Tabler/Feather on build). Light 1.5–2px stroke to match the type weight. No emoji in the UI.

## 7. Screens covered
Today (dashboard), Recipes, Recipe detail, Meal plan, Cooking tasks, Shopping list, Analytics. See `code.html` in this folder for the full visual board.

## 8. Mapping to code
These tokens are intended to replace `src/theme/tokens.ts`. Swap the dark palette for the values in §2, add a `fontFamily` for Fraunces + Plus Jakarta Sans (via `expo-font`), and widen the `Radius` scale (cards 20–24). Components above map 1:1 onto the existing screen structure, so the overhaul is mostly a token + component-styling pass rather than a re-architecture.
