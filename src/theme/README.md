# src/theme — Centralized Design System

This folder guarantees aesthetic uniformity across all screens and components within HealthTracker.

## `tokens.ts`

The definitive source of truth for styles. Always use properties defined here over ad-hoc numeric offsets or hex color codes:

- **Colors**: Standardized palette (`Colors.background`, `Colors.surface`, `Colors.primary`).
- **Typography**: Shared text sizes and font weights.
- **Spacing**: Predictable layout increments (e.g. `Spacing.sm` or `Spacing.xl`).

## Usage
Instead of:
`marginLeft: 10, color: '#333'`

Do:
`marginLeft: Spacing.sm, color: Colors.textPrimary`
