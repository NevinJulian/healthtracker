# src/components — Reusable UI Components

This folder houses the reusable, stateless, or purely presentational UI elements used across multiple screens in HealthTracker.

## Overview

Instead of duplicating styling logic, these components standardize the appearance of common elements.

### Key Components

- `BioForceModal.tsx` - A sophisticated, searchable modal for finding and selecting Bio Force exercises.
- Other generic items (Buttons, Cards, Forms) reside here to be re-used across different views.

## Guidelines
- Components should be modular and disconnected from global state if possible.
- Ensure that you use variables from `src/theme/tokens.ts` to enforce uniform padding and colors.
