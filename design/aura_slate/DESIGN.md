```markdown
# Design System Document: High-End Fitness Editorial

## 1. Overview & Creative North Star: "The Kinetic Atelier"
This design system moves away from the "neon-and-grit" clichés of fitness apps, opting instead for the refined atmosphere of a private, high-end training studio. The Creative North Star is **"The Kinetic Atelier."** 

We treat the 90-day transformation not as a grueling chore, but as a curated architectural project for the self. To achieve this, the system breaks the "standard app" template through:
*   **Intentional Asymmetry:** Using unbalanced white space and offset typography to create a sense of forward motion.
*   **Editorial Scaling:** Drastic contrast between massive `display` type and micro `label` type to mimic high-fashion periodicals.
*   **Tonal Depth:** Replacing harsh lines with sophisticated layering of charcoal and slate.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a deep, nocturnal foundation. It is designed to be easy on the eyes during early morning or late-night workouts, using "Atmospheric Slate" instead of harsh pure black.

### Color Tokens
*   **Background (`#121416`):** The foundational "Deep Slate."
*   **Primary (`#ffb4a8`):** A sophisticated Coral. Used for progress milestones and "Commit" actions.
*   **Secondary (`#a9cdd2`):** Calm Blue. Exclusively for Strength Training and recovery.
*   **Tertiary (`#b0cfad`):** Muted Green. Exclusively for Cardio, steps, and vitality metrics.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts or tonal transitions. Use `surface-container-low` for a section background sitting on a `surface` base. 

### The "Glass & Gradient" Rule
To elevate the UI, floating action buttons and "Today’s Highlight" cards should utilize Glassmorphism:
*   **Material:** `surface-container-highest` at 60% opacity with a `20px` backdrop-blur.
*   **Soul Gradients:** Main CTAs should transition subtly from `primary` (#ffb4a8) to `primary-container` (#e67e6e) at a 135-degree angle to provide a sense of organic dimension.

---

## 3. Typography: The Hierarchical Voice
We use two typefaces: **Manrope** (Display/Headlines) for its geometric, premium character, and **Inter** (Body/Labels) for its unrivaled legibility and native feel.

*   **Display (Manrope, 3.5rem):** Used for "Day 45" or "90" milestones. It should be tight-tracked (-2%) to feel authoritative.
*   **Headline (Manrope, 1.5rem - 2rem):** Used for workout titles and screen headers. 
*   **Title (Inter, 1rem - 1.375rem):** Used for card titles and navigation elements.
*   **Body (Inter, 0.875rem - 1rem):** High readability for workout instructions.
*   **Labels (Inter, 0.6875rem):** All-caps with +5% letter spacing for secondary metadata (e.g., "REST TIME," "BPM").

---

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are too "software-heavy." We achieve depth through the **Layering Principle.**

*   **Tonal Stacking:** 
    1.  Base: `surface-dim` (#121416)
    2.  Section: `surface-container-low` (#1a1c1e)
    3.  Card: `surface-container` (#1e2022)
    4.  Floating Element: `surface-container-highest` (#333537)
*   **Ambient Shadows:** For floating elements, use a `32px` blur, `0px` offset, and `on-surface` color at 4% opacity. It should feel like a soft glow, not a drop shadow.
*   **The "Ghost Border":** If a boundary is required (e.g., in a complex data table), use `outline-variant` at 15% opacity. Never use 100% opacity for lines.

---

## 5. Components

### Elevated Workout Cards
*   **Styling:** No borders. Use `surface-container-low`.
*   **Corner Radius:** `xl` (0.75rem) for the outer container; `md` (0.375rem) for internal chips.
*   **Hierarchy:** Use a `tertiary` (green) accent bar (4px wide) on the left edge for cardio cards and `secondary` (blue) for strength.

### Buttons (The "Action Core")
*   **Primary:** Gradient of `primary` to `primary-container`. Text: `on-primary` (Deep Cocoa). Roundedness: `full`.
*   **Secondary:** `surface-container-highest` background with `on-surface` text. No border.
*   **Tertiary:** Transparent background with `primary` text. Use for "Cancel" or "Skip."

### Global Navigation: The Right-Side Drawer
*   **Mechanism:** Triggered by a "Ghost Border" hamburger icon in the top right.
*   **Visual:** The drawer should be a full-height `surface-container-lowest` overlay with a `40px` backdrop-blur behind it, effectively muting the app's content to focus on the menu.

### Progress Chips
*   **Styling:** Small, `full` radius pills. 
*   **Logic:** Use `tertiary-container` with `on-tertiary-container` text for "Completed" states.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use vertical white space (24px, 32px, 48px) to separate content groups instead of horizontal rules.
*   **Do** use `display-lg` typography for single, impactful numbers (e.g., weight lost, days remaining).
*   **Do** keep icon weights light (1.5px or 2px stroke) to match the Inter typography weight.

### Don't:
*   **Don't** use pure black (#000000). It kills the "Deep Slate" editorial feel.
*   **Don't** use standard Material Design "floating action buttons" with heavy shadows. Use the Glassmorphic approach instead.
*   **Don't** crowd the edges. Maintain a minimum of 20px horizontal padding on all screens to ensure the layout feels premium and "expensive."
*   **Don't** use dividers in lists. Use a `surface-container-low` background on every second item, or simply use 16px of vertical breathing room.

---

## 7. Context-Specific Component: "The 90-Day Horizon"
A custom component for this app is the **Horizon Tracker**. It is a horizontal, scrollable bar of 90 dots.
*   **Current Day:** `primary` (Coral) with a soft glow (Ambient Shadow).
*   **Completed Days:** `on-surface-variant` at 40% opacity.
*   **Future Days:** `outline-variant` at 20% opacity. 
*   **Interaction:** Tapping a dot uses a "Zoom" transition to expand that day's summary into a `surface-container-highest` modal.```