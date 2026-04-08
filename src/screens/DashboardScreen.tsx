import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DailyLogEntry,
  getLogByDate,
  upsertLogField,
  syncRollingSchedule,
  toISODate,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Sub-components ───────────────────────────────────────────────────────────

function Checkbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <Text style={[styles.checkboxLabel, checked && styles.checkboxLabelChecked]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TaskCard({
  icon,
  title,
  description,
  accentColor,
}: {
  icon: string;
  title: string;
  description: string;
  accentColor: string;
}) {
  return (
    <View style={[styles.taskCard, { borderLeftColor: accentColor }]}>
      <Text style={styles.taskIcon}>{icon}</Text>
      <View style={styles.taskCardContent}>
        <Text style={styles.taskTitle}>{title}</Text>
        <Text style={styles.taskDescription}>{description}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<DailyLogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const today = toISODate();

  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      // Re-sync in case days were missed (e.g., device clock advanced)
      await syncRollingSchedule();
      const data = await getLogByDate(today);
      setEntry(data);
    } catch (err) {
      console.error('DashboardScreen: loadToday error', err);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  const handleToggle = async (
    field: 'walk_completed' | 'hammer_completed' | 'fasting_completed'
  ) => {
    if (!entry) return;
    const newValue = !entry[field];

    // Optimistic UI update
    setEntry((prev) => prev ? { ...prev, [field]: newValue } : prev);

    try {
      await upsertLogField(today, field, newValue);
    } catch (err) {
      console.error('upsertLogField error', err);
      loadToday(); // Revert on error
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const formatDate = () =>
    new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  const completionCount = () => {
    if (!entry) return 0;
    return (
      (entry.walk_completed ? 1 : 0) +
      (entry.hammer_completed ? 1 : 0) +
      (entry.fasting_completed ? 1 : 0)
    );
  };

  const completionProgress = () => (entry ? completionCount() / 3 : 0);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Syncing schedule…</Text>
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.centred}>
        <Text style={styles.loadingText}>No entry for today — try reopening the app.</Text>
      </View>
    );
  }

  const progress = completionProgress();
  const isAllDone = progress === 1;

  return (
    <View style={styles.container}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={styles.headerDate}>{formatDate()}</Text>
          <Text style={styles.headerTitle}>
            {isAllDone ? '🎉 All done today!' : "Today's Training"}
          </Text>
        </View>
        {entry.is_meal_prep_day && (
          <View style={styles.mealPrepPill}>
            <Text style={styles.mealPrepPillText}>🥗 Meal Prep</Text>
          </View>
        )}
      </View>

      {/* ── Progress bar ──────────────────────────────────────────────────── */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(progress * 100)}%` as any,
                backgroundColor: isAllDone ? Colors.accent : Colors.secondary,
              },
            ]}
          />
        </View>
        <Text style={styles.progressLabel}>
          {completionCount()} / 3 tasks complete
        </Text>
      </View>

      {/* ── Rest day banner ───────────────────────────────────────────────── */}
      {entry.is_rest_day && (
        <View style={styles.restBanner}>
          <Text style={styles.restBannerText}>
            💤 Rest / Recovery Day — lighter weights, focus on form
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Walking task ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <TaskCard
            icon="🚶"
            title="Walking"
            description={entry.walking_task}
            accentColor={Colors.accent}
          />
          <Checkbox
            checked={entry.walk_completed}
            label="Walk completed"
            onToggle={() => handleToggle('walk_completed')}
          />
        </View>

        {/* ── Hammer / Gym task ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <TaskCard
            icon="🏋️"
            title="Hammer Multi-Gym"
            description={entry.hammer_task}
            accentColor={Colors.secondary}
          />
          <Checkbox
            checked={entry.hammer_completed}
            label="Gym session completed"
            onToggle={() => handleToggle('hammer_completed')}
          />
        </View>

        {/* ── Intermittent fasting ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <TaskCard
            icon="⏱️"
            title="Intermittent Fasting"
            description="16:8 protocol — eating window: 12 pm → 8 pm"
            accentColor={Colors.warning ?? '#F6AD55'}
          />
          <Checkbox
            checked={entry.fasting_completed}
            label="Fasting window completed"
            onToggle={() => handleToggle('fasting_completed')}
          />
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centred: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.md,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerDate: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  mealPrepPill: {
    backgroundColor: Colors.accent + '20',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  mealPrepPillText: {
    color: Colors.accent,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
  },

  // Progress
  progressContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    gap: 6,
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  progressLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.medium,
  },

  // Rest banner
  restBanner: {
    backgroundColor: 'rgba(74, 85, 104, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  restBannerText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  // Section
  section: { gap: Spacing.sm },

  // Task Card
  taskCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    borderLeftWidth: 3,
  },
  taskIcon: { fontSize: 22, marginTop: 2 },
  taskCardContent: { flex: 1, gap: 4 },
  taskTitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  taskDescription: {
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.medium,
    lineHeight: 22,
  },

  // Checkbox
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  checkmark: {
    color: Colors.background,
    fontSize: 14,
    fontWeight: Typography.weights.bold,
  },
  checkboxLabel: {
    fontSize: Typography.sizes.md,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
  },
  checkboxLabelChecked: {
    color: Colors.accent,
    textDecorationLine: 'line-through',
  },
});
