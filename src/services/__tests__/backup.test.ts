/**
 * Unit tests for the backup service.
 *
 * Only pure, stateless helpers are tested here — DB-transactional paths
 * (restoreFromPayload, exportBackup) require a real SQLite connection and
 * are not unit-testable in Jest's node environment (expo-sqlite is mocked).
 *
 * Coverage:
 *   - buildInsertColumns: pure column/placeholder/values builder
 *   - validatePayload: format check, schema version compatibility gate
 *   - exportBackup / importBackup smoke: confirm the service exports the
 *     expected functions (consistent with the repo's existing test style)
 */

import { buildInsertColumns, validatePayload, exportBackup, importBackup } from '../backup';

// ─── buildInsertColumns ───────────────────────────────────────────────────────

describe('buildInsertColumns', () => {
  it('builds columns, placeholders, and values for a single-key row', () => {
    const result = buildInsertColumns({ name: 'Alice' });
    expect(result.columns).toBe('name');
    expect(result.placeholders).toBe('?');
    expect(result.values).toEqual(['Alice']);
  });

  it('builds columns, placeholders, and values for a multi-key row', () => {
    const row = { id: 1, date: '2024-01-01', value: 42.5 };
    const result = buildInsertColumns(row);
    expect(result.columns).toBe('id, date, value');
    expect(result.placeholders).toBe('?, ?, ?');
    expect(result.values).toEqual([1, '2024-01-01', 42.5]);
  });

  it('handles null values', () => {
    const row = { id: 1, weight: null };
    const result = buildInsertColumns(row);
    expect(result.columns).toBe('id, weight');
    expect(result.placeholders).toBe('?, ?');
    expect(result.values).toEqual([1, null]);
  });

  it('returns the same number of columns, placeholders, and values', () => {
    const row = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const result = buildInsertColumns(row);
    const colCount = result.columns.split(',').length;
    const phCount = result.placeholders.split(',').length;
    expect(colCount).toBe(5);
    expect(phCount).toBe(5);
    expect(result.values).toHaveLength(5);
  });
});

// ─── validatePayload ─────────────────────────────────────────────────────────

describe('validatePayload', () => {
  const currentSchemaVersion = 30;

  function makePayload(overrides: Record<string, unknown> = {}) {
    return {
      format: 'healthtracker-backup',
      version: 1,
      appVersion: '1.0.0',
      schemaVersion: 20,
      createdAt: new Date().toISOString(),
      tables: { daily_log: [] },
      ...overrides,
    };
  }

  it('accepts a valid payload', () => {
    const payload = makePayload();
    const result = validatePayload(payload, currentSchemaVersion);
    expect(result.format).toBe('healthtracker-backup');
    expect(result.tables).toEqual({ daily_log: [] });
  });

  it('accepts a payload whose schemaVersion equals currentSchemaVersion', () => {
    const payload = makePayload({ schemaVersion: currentSchemaVersion });
    expect(() => validatePayload(payload, currentSchemaVersion)).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validatePayload(null, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects an array', () => {
    expect(() => validatePayload([], currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a wrong format string', () => {
    const payload = makePayload({ format: 'other-app-backup' });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'not created by HealthTracker'
    );
  });

  it('rejects when tables is missing', () => {
    const payload = makePayload({ tables: undefined });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'missing tables data'
    );
  });

  it('rejects when schemaVersion is not a number', () => {
    const payload = makePayload({ schemaVersion: 'NaN' });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'missing schema version'
    );
  });

  it('rejects a backup made by a newer app version', () => {
    const payload = makePayload({ schemaVersion: currentSchemaVersion + 1 });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'newer version of the app'
    );
  });

  it('round-trips: stringify → parse → validate returns same structure', () => {
    const original = makePayload({ schemaVersion: 10 });
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const result = validatePayload(parsed, currentSchemaVersion);
    expect(result.format).toBe('healthtracker-backup');
    expect(result.schemaVersion).toBe(10);
    expect(result.tables).toEqual({ daily_log: [] });
  });
});

// ─── Service exports smoke test ───────────────────────────────────────────────

describe('backup service', () => {
  it('exports exportBackup as a function', () => {
    expect(typeof exportBackup).toBe('function');
  });

  it('exports importBackup as a function', () => {
    expect(typeof importBackup).toBe('function');
  });
});
