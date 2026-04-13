import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DailyLogEntry,
  Exercise,
  getLogByDate,
  upsertLogField,
  upsertExerciseCompleted,
  upsertBodyWeight,
  upsertAdditionalWorkouts,
  syncRollingSchedule,
  toISODate,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import BioForceModal from '../components/BioForceModal';

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

// ─── Exercise Row ─────────────────────────────────────────────────────────────

function ExerciseRow({
  exercise,
  onToggle,
}: {
  exercise: Exercise;
  onToggle: () => void;
}) {
  const handleWatch = async () => {
    if (!exercise.videoUrl) return;
    const supported = await Linking.canOpenURL(exercise.videoUrl);
    if (supported) {
      await Linking.openURL(exercise.videoUrl);
    } else {
      Alert.alert('Cannot open URL', exercise.videoUrl);
    }
  };

  return (
    <View style={[styles.exerciseRow, exercise.completed && styles.exerciseRowDone]}>
      {/* Checkbox */}
      <TouchableOpacity
        style={[styles.exCheckbox, exercise.completed && styles.exCheckboxDone]}
        onPress={onToggle}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {exercise.completed && <Text style={styles.exCheckmark}>✓</Text>}
      </TouchableOpacity>

      {/* Name + sets/reps */}
      <View style={styles.exInfo}>
        <Text style={[styles.exName, exercise.completed && styles.exNameDone]}>
          {exercise.name}
        </Text>
        <Text style={styles.exMeta}>
          {exercise.sets} sets × {exercise.reps} reps
        </Text>
      </View>

      {/* Watch Tutorial button */}
      {exercise.videoUrl ? (
        <TouchableOpacity
          style={styles.watchBtn}
          onPress={handleWatch}
          activeOpacity={0.75}
        >
          <Text style={styles.watchBtnIcon}>▶</Text>
          <Text style={styles.watchBtnLabel}>Watch</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.watchBtnPlaceholder} />
      )}
    </View>
  );
}

// ─── Hammer Section ───────────────────────────────────────────────────────────

function HammerSection({
  entry,
  onExerciseToggle,
  onSessionToggle,
}: {
  entry: DailyLogEntry;
  onExerciseToggle: (id: string, value: boolean) => void;
  onSessionToggle: () => void;
}) {
  const doneCount = entry.exercises.filter((e) => e.completed).length;
  const total = entry.exercises.length;
  const allDone = total > 0 && doneCount === total;

  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={[styles.hammerHeader, { borderLeftColor: Colors.secondary }]}>
        <View style={styles.hammerHeaderLeft}>
          <Text style={styles.taskIcon}>🏋️</Text>
          <View>
            <Text style={styles.taskTitle}>HAMMER MULTI-GYM</Text>
            <Text style={styles.hammerSubtitle}>{entry.hammer_task}</Text>
          </View>
        </View>
        {total > 0 && (
          <View style={[styles.exProgressPill, allDone && styles.exProgressPillDone]}>
            <Text style={[styles.exProgressText, allDone && styles.exProgressTextDone]}>
              {doneCount}/{total}
            </Text>
          </View>
        )}
      </View>

      {/* Exercise list */}
      {entry.exercises.length > 0 ? (
        <View style={styles.exerciseList}>
          {entry.exercises.map((ex) => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              onToggle={() => onExerciseToggle(ex.id, !ex.completed)}
            />
          ))}
        </View>
      ) : (
        // Fallback for days with no exercise data yet
        <Text style={styles.noExercisesHint}>
          No individual exercises configured — use the Template Editor to add them.
        </Text>
      )}

      {/* Session-level completion checkbox */}
      <Checkbox
        checked={entry.hammer_completed}
        label="Mark full gym session complete"
        onToggle={onSessionToggle}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<DailyLogEntry | null>(null);
  const [loading, setLoading] = useState(true);

  // New features state
  const [weightInput, setWeightInput] = useState('');
  const [isExtraModalVisible, setExtraModalVisible] = useState(false);

  const today = toISODate();

  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      await syncRollingSchedule();
      const data = await getLogByDate(today);
      setEntry(data);
      if (data?.body_weight) {
        setWeightInput(data.body_weight.toString());
      }
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
    setEntry((prev) => prev ? { ...prev, [field]: newValue } : prev);
    try {
      await upsertLogField(today, field, newValue);
    } catch (err) {
      console.error('upsertLogField error', err);
      loadToday();
    }
  };

  const handleExerciseToggle = async (exerciseId: string, value: boolean) => {
    if (!entry) return;
    // Optimistic update
    setEntry((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) =>
          ex.id === exerciseId ? { ...ex, completed: value } : ex
        ),
      };
    });
    try {
      await upsertExerciseCompleted(today, exerciseId, value);
    } catch (err) {
      console.error('upsertExerciseCompleted error', err);
      loadToday();
    }
  };

  const handleSaveWeight = async () => {
    const val = parseFloat(weightInput);
    if (isNaN(val)) {
      Alert.alert('Invalid Weight', 'Please enter a valid number.');
      return;
    }
    try {
      await upsertBodyWeight(today, val);
      setEntry(prev => prev ? { ...prev, body_weight: val } : prev);
    } catch (err) {
      console.error('upsertBodyWeight error', err);
      Alert.alert('Error', 'Failed to save weight.');
    }
  };

  const handleAddExtraWorkout = async (workout: {
    id: string;
    name: string;
    muscle_group: string;
    sets: string;
    reps: string;
    completed: boolean;
  }) => {
    if (!entry) return;
    const updated = [...(entry.additional_workouts || []), workout];
    
    setEntry(prev => prev ? { ...prev, additional_workouts: updated } : prev);
    
    try {
      await upsertAdditionalWorkouts(today, updated);
    } catch (err) {
      console.error('upsertAdditionalWorkouts error', err);
      loadToday();
    }
  };

  const handleToggleExtraWorkout = async (id: string) => {
    if (!entry) return;
    const updated = (entry.additional_workouts || []).map(w => 
      w.id === id ? { ...w, completed: !w.completed } : w
    );
    
    setEntry(prev => prev ? { ...prev, additional_workouts: updated } : prev);
    
    try {
      await upsertAdditionalWorkouts(today, updated);
    } catch (err) {
      console.error('upsertAdditionalWorkouts error', err);
      loadToday();
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
        <HammerSection
          entry={entry}
          onExerciseToggle={handleExerciseToggle}
          onSessionToggle={() => handleToggle('hammer_completed')}
        />

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

        {/* ── Body Weight Logging ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.weightCard}>
            <Text style={styles.taskIcon}>⚖️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskTitle}>BODY WEIGHT</Text>
              <TextInput
                style={styles.weightInput}
                placeholder="0.0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                value={weightInput}
                onChangeText={setWeightInput}
                onBlur={handleSaveWeight}
                returnKeyType="done"
              />
            </View>
            <TouchableOpacity style={styles.weightSaveBtn} onPress={handleSaveWeight}>
              <Text style={styles.weightSaveBtnText}>Log</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Extra Workouts ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.extraWorkoutsHeader}>
            <Text style={styles.extraWorkoutsTitle}>Bonuses / Ad-hoc</Text>
          </View>
          
          {(entry.additional_workouts || []).map(aw => (
            <View key={aw.id} style={{ marginBottom: 4 }}>
              <Checkbox
                checked={aw.completed}
                label={aw.name}
                onToggle={() => handleToggleExtraWorkout(aw.id)}
              />
              {aw.muscle_group ? (
                <Text style={{ marginLeft: 44, marginTop: -4, color: Colors.textMuted, fontSize: Typography.sizes.xs }}>
                  {aw.muscle_group}  •  {aw.sets} sets × {aw.reps} reps
                </Text>
              ) : null}
            </View>
          ))}

          <TouchableOpacity 
            style={styles.addExtraBtn} 
            activeOpacity={0.7}
            onPress={() => setExtraModalVisible(true)}
          >
            <Text style={styles.addExtraBtnIcon}>➕</Text>
            <Text style={styles.addExtraBtnText}>Add Extra Workout</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ── Add Extra Workout Modal ──────────────────────────────────────── */}
      <BioForceModal 
        isVisible={isExtraModalVisible} 
        onClose={() => setExtraModalVisible(false)} 
        onAddWorkout={handleAddExtraWorkout} 
      />
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

  // Hammer section header
  hammerHeader: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 3,
    gap: Spacing.sm,
  },
  hammerHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    flex: 1,
  },
  hammerSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginTop: 2,
    flexShrink: 1,
  },
  exProgressPill: {
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
  },
  exProgressPillDone: { backgroundColor: Colors.accent + '30' },
  exProgressText: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.bold,
  },
  exProgressTextDone: { color: Colors.accent },

  // Exercise list
  exerciseList: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Exercise row
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  exerciseRowDone: { backgroundColor: Colors.accent + '08' },
  exCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  exCheckboxDone: {
    backgroundColor: Colors.secondary,
    borderColor: Colors.secondary,
  },
  exCheckmark: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: Typography.weights.bold,
  },
  exInfo: { flex: 1, gap: 1 },
  exName: {
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  exNameDone: {
    color: Colors.textMuted,
    textDecorationLine: 'line-through',
  },
  exMeta: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },

  // Watch button
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.secondary + '25',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.secondary + '60',
  },
  watchBtnIcon: {
    color: Colors.secondary,
    fontSize: 10,
  },
  watchBtnLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.secondary,
    fontWeight: Typography.weights.semibold,
  },
  watchBtnPlaceholder: { width: 58 }, // same width as watchBtn to keep alignment

  // No exercises hint
  noExercisesHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },

  // Weight Logging
  weightCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
  },
  weightInput: {
    color: Colors.textPrimary,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    marginTop: 4,
    padding: 0,
  },
  weightSaveBtn: {
    backgroundColor: Colors.accent + '25',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.accent + '60',
  },
  weightSaveBtnText: {
    color: Colors.accent,
    fontWeight: Typography.weights.bold,
    fontSize: Typography.sizes.sm,
  },

  // Extra workouts
  extraWorkoutsHeader: {
    paddingHorizontal: 4,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  extraWorkoutsTitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.bold,
    textTransform: 'uppercase',
  },
  addExtraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  addExtraBtnIcon: { fontSize: 16 },
  addExtraBtnText: {
    fontSize: Typography.sizes.md,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
  },
});
