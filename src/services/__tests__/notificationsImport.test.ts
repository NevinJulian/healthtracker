/**
 * expoNotifications.ts is the only module allowed to load expo-notifications.
 * It keeps the package away from Expo Go on Android, where importing it
 * crashes the app before the first render.
 *
 * Fails if any other file under src/, App.tsx or index.ts imports or requires
 * expo-notifications directly. Type-only imports are fine, they are erased
 * at compile time. Tests are exempt, they assert against the jest mock.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const ALLOWED = path.join(ROOT, 'src', 'services', 'expoNotifications.ts');

const VALUE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+['"]expo-notifications['"]/m;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"]expo-notifications['"]/m;
const REQUIRE_OR_DYNAMIC_IMPORT = /(?:require|import)\(\s*['"]expo-notifications['"]\s*\)/;

function loadsExpoNotifications(source: string): boolean {
  return (
    VALUE_IMPORT.test(source) ||
    SIDE_EFFECT_IMPORT.test(source) ||
    REQUIRE_OR_DYNAMIC_IMPORT.test(source)
  );
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === '__mocks__' ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('expo-notifications import rule', () => {
  it('only expoNotifications.ts loads expo-notifications', () => {
    const files = [
      ...sourceFiles(path.join(ROOT, 'src')),
      path.join(ROOT, 'App.tsx'),
      path.join(ROOT, 'index.ts'),
    ];
    expect(files).toContain(ALLOWED);

    const offenders = files
      .filter((file) => file !== ALLOWED)
      .filter((file) => loadsExpoNotifications(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('recognises the forms of loading it, and ignores type-only imports', () => {
    expect(loadsExpoNotifications("import * as Notifications from 'expo-notifications';")).toBe(true);
    expect(loadsExpoNotifications("import {\n  scheduleNotificationAsync,\n} from 'expo-notifications';")).toBe(true);
    expect(loadsExpoNotifications("import 'expo-notifications';")).toBe(true);
    expect(loadsExpoNotifications("const N = require('expo-notifications');")).toBe(true);
    expect(loadsExpoNotifications("const N = await import('expo-notifications');")).toBe(true);
    expect(loadsExpoNotifications("import type * as N from 'expo-notifications';")).toBe(false);
  });
});
