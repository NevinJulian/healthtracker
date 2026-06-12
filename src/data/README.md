# src/data — Static & Seed Data

This folder manages static objects, arrays, and seed data logic intended to populate or reference within the application.

## Contents

- `recipes.ts` - Master list of all base macro-friendly recipes. This static structure is consumed by `seedRecipeLibrary()` in `database.ts` during database initialisation, which inserts records into the `recipe_library` SQLite table.

## Rules
- Avoid importing database mutations directly here.
- The structure should remain static and predictable to ensure seed routines remain stable over version upgrades.
