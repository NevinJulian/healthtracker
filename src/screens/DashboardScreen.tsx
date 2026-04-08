import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {
  getDay,
  getTodayDayNumber,
  upsertLog,
  importScheduleFromJSON,
  DayWithLog,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Checkbox Component ───────────────────────────────────────────────────────

function Checkbox({
  checked,
  label,
  onToggle,
  disabled,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.checkboxRow, disabled && styles.checkboxDisabled]}
      onPress={onToggle}
      disabled={disabled}
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

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  icon,
  title,
  description,
  accentColor,
}: {
  icon: string;
  title: string;
  description: string;
  accentColor?: string;
}) {
  const borderColor = accentColor || Colors.border;
  return (
    <View style={[styles.taskCard, { borderLeftColor: borderColor }]}>
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
  const [dayNumber, setDayNumber] = useState<number>(1);
  const [dayData, setDayData] = useState<DayWithLog | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDay = useCallback(async () => {
    setLoading(true);
    try {
      const dn = await getTodayDayNumber();
      setDayNumber(dn);
      const data = await getDay(dn);
      setDayData(data);
    } catch (err) {
      console.error('DashboardScreen: loadDay error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  const handleToggle = async (
    field: 'walk_completed' | 'workout_completed' | 'fasting_completed'
  ) => {
    if (!dayData) return;
    const current = dayData.log?.[field] ?? false;
    const newValue = !current;

    // Optimistic update
    setDayData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        log: {
          id: prev.log?.id ?? 0,
          day_number: dayNumber,
          walk_completed: field === 'walk_completed' ? newValue : (prev.log?.walk_completed ?? false),
          workout_completed: field === 'workout_completed' ? newValue : (prev.log?.workout_completed ?? false),
          fasting_completed: field === 'fasting_completed' ? newValue : (prev.log?.fasting_completed ?? false),
          logged_date: prev.log?.logged_date ?? null,
        },
      };
    });

    try {
      await upsertLog(dayNumber, { [field]: newValue });
    } catch (err) {
      console.error('upsertLog error', err);
      loadDay(); // Revert on error
    }
  };

  const handleImportJSON = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const uri = result.assets[0].uri;
      const jsonString = await FileSystem.readAsStringAsync(uri);
      await importScheduleFromJSON(jsonString);
      Alert.alert('✅ Import Successful', 'Schedule updated. Reloading…');
      loadDay();
    } catch (err: any) {
      Alert.alert('❌ Import Failed', err.message ?? 'Unknown error');
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const formatDate = () => {
    return new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  const completionProgress = () => {
    if (!dayData) return 0;
    const log = dayData.log;
    const totalTasks = dayData.is_rest_day ? 1 : 3;
    const completed =
      (log?.walk_completed ? 1 : 0) +
      (!dayData.is_rest_day && log?.workout_completed ? 1 : 0) +
      (log?.fasting_completed ? 1 : 0);
    return completed / totalTasks;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Loading your day…</Text>
      </View>
    );
  }

  if (!dayData) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>No schedule data found.</Text>
      </View>
    );
  }

  const progress = completionProgress();
  const isAllDone = progress === 1;

  return (
    <View style={styles.container}>
      {/* Header — top padding accounts for status bar / notch inset */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={styles.headerDate}>{formatDate()}</Text>
          <Text style={styles.headerDay}>
            Day <Text style={styles.headerDayNumber}>{dayNumber}</Text>
            <Text style={styles.headerDayTotal}> / 90</Text>
          </Text>
        </View>
        <TouchableOpacity style={styles.importBtn} onPress={handleImportJSON}>
          <Text style={styles.importBtnText}>📥</Text>
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress * 100}%` as any,
                backgroundColor: isAllDone ? Colors.accent : Colors.secondary,
              },
            ]}
          />
        </View>
        <Text style={styles.progressLabel}>
          {isAllDone ? '🎉 All done!' : `${Math.round(progress * 100)}% complete`}
        </Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Meal Prep Banner */}
        {dayData.is_meal_prep_day && (
          <View style={styles.mealPrepBanner}>
            <Text style={styles.mealPrepBannerText}>
              🥗 Meal Prep Saturday — check the Meal Prep tab!
            </Text>
          </View>
        )}

        {/* Rest Day Banner */}
        {dayData.is_rest_day && (
          <View style={styles.restBanner}>
            <Text style={styles.restBannerText}>
              💤 Rest Day — recovery is part of the programme
            </Text>
          </View>
        )}

        {/* Walking Task */}
        <View style={styles.section}>
          <TaskCard
            icon="🚶"
            title="Walking Pad"
            description={dayData.walking_task}
            accentColor={Colors.accent}
          />
          <Checkbox
            checked={dayData.log?.walk_completed ?? false}
            label="Walk completed"
            onToggle={() => handleToggle('walk_completed')}
            disabled={dayData.is_rest_day}
          />
        </View>

        {/* Workout Task */}
        {!dayData.is_rest_day && (
          <View style={styles.section}>
            <TaskCard
              icon="🏋️"
              title="Training"
              description={dayData.workout_description}
              accentColor={Colors.secondary}
            />
            {dayData.target_weight != null && (
              <View style={styles.targetWeightBadge}>
                <Text style={styles.targetWeightText}>
                  🎯 Target: {dayData.target_weight} kg
                </Text>
              </View>
            )}
            <Checkbox
              checked={dayData.log?.workout_completed ?? false}
              label="Workout completed"
              onToggle={() => handleToggle('workout_completed')}
            />
          </View>
        )}

        {/* Intermittent Fasting */}
        <View style={styles.section}>
          <TaskCard
            icon="⏱️"
            title="Intermittent Fasting"
            description="16:8 protocol — eating window: 12 pm → 8 pm"
            accentColor={Colors.warning}
          />
          <Checkbox
            checked={dayData.log?.fasting_completed ?? false}
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
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.md,
  },

  // Header — paddingTop set dynamically via insets.top in the component
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
  headerDay: {
    fontSize: Typography.sizes.xxl,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  headerDayNumber: {
    color: Colors.accent,
    fontWeight: Typography.weights.black,
  },
  headerDayTotal: {
    color: Colors.textMuted,
    fontSize: Typography.sizes.lg,
  },
  importBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  importBtnText: {
    fontSize: 18,
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

  // Scroll
  scrollView: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  // Banners
  mealPrepBanner: {
    backgroundColor: 'rgba(0, 229, 160, 0.08)',
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  mealPrepBannerText: {
    color: Colors.accent,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  restBanner: {
    backgroundColor: 'rgba(74, 85, 104, 0.2)',
    borderWidth: 1,
    borderColor: Colors.rest,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  restBannerText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
  },

  // Section
  section: {
    gap: Spacing.sm,
  },

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
  taskIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  taskCardContent: {
    flex: 1,
    gap: 4,
  },
  taskTitle: {
    fontSize: Typography.sizes.sm,
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

  // Target weight badge
  targetWeightBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.secondaryGlow,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.secondary,
  },
  targetWeightText: {
    color: Colors.secondary,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
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
  checkboxDisabled: {
    opacity: 0.4,
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
