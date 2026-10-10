import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Button from './Button';
import { listAutoBackups, shareFile } from '../services/backup';
import { exportRawDatabase, hasRescueWal } from '../services/rescueExport';
import { Colors, Spacing, Typography } from '../theme/tokens';

const TWO_FILES_NOTICE = 'Saving shares two files. Keep both.';
const LATEST_BACKUP_NOTICE =
  'Share latest backup shares your newest automatic backup. It is the file that Restore from backup in Settings reads after a reinstall.';
const NO_RESET_NOTICE =
  "Clearing the app's storage in Android settings deletes all your data, so there is no reset button here.";

const STACK_LINES = 8;

export function formatErrorDetail(err: unknown): string {
  const { message, stack } = (err ?? {}) as { message?: unknown; stack?: unknown };
  const stackLines =
    typeof stack === 'string' ? stack.split('\n').slice(0, STACK_LINES).join('\n') : undefined;
  return [typeof message === 'string' ? message : undefined, stackLines]
    .filter(Boolean)
    .join('\n\n');
}

export interface RecoveryScreenProps {
  title: string;
  detail: string;
  onRetry?: () => void;
  /** Resolves when it is safe to export, e.g. after a pending init settles. */
  beforeSave?: () => Promise<unknown>;
}

export default function RecoveryScreen({ title, detail, onRetry, beforeSave }: RecoveryScreenProps) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasWal, setHasWal] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);

  useEffect(() => {
    let active = true;
    hasRescueWal().then(
      (found) => active && setHasWal(found),
      () => active && setHasWal(false),
    );
    listAutoBackups().then(
      (backups) => active && setHasBackup(backups.length > 0),
      () => active && setHasBackup(false),
    );
    return () => {
      active = false;
    };
  }, []);

  const saveData = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await beforeSave?.();
      await exportRawDatabase();
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save your data.');
    } finally {
      setSaving(false);
    }
  };

  const shareLatestBackup = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const [latest] = await listAutoBackups();
      if (!latest) throw new Error('No automatic backup was found on this device.');
      const shared = await shareFile(latest.uri, 'Save your HealthTracker backup');
      if (!shared) throw new Error('Sharing is not available on this device.');
    } catch (err) {
      setSaveError((err instanceof Error && err.message) || 'Could not share the backup.');
    } finally {
      setSaving(false);
    }
  };

  const retry = onRetry
    ? () => {
        setSaveError(null);
        onRetry();
      }
    : undefined;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.errorText}>{title}</Text>
      <Text style={styles.errorDetail} selectable>{detail}</Text>
      {retry && <Button title="Retry" onPress={retry} style={styles.button} />}
      <Button
        title="Save data"
        variant="ghost"
        onPress={saveData}
        disabled={saving}
        style={styles.button}
      />
      {hasBackup && (
        <Button
          title="Share latest backup"
          variant="ghost"
          onPress={shareLatestBackup}
          disabled={saving}
          style={styles.button}
        />
      )}
      {saveError && <Text style={styles.errorText}>{saveError}</Text>}
      {hasWal && <Text style={styles.errorDetail}>{TWO_FILES_NOTICE}</Text>}
      {hasBackup && <Text style={styles.errorDetail}>{LATEST_BACKUP_NOTICE}</Text>}
      <Text style={styles.errorDetail}>{NO_RESET_NOTICE}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing.xxl,
  },
  errorText: {
    color: Colors.danger,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
  },
  errorDetail: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  button: {
    alignSelf: 'stretch',
    marginHorizontal: Spacing.xxl,
  },
});
