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
  getTodaysMealsWithRecipe,
  MealPlanWithRecipe,
  toggleMealConsumed,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { accentBarStrength, accentBarCardio, ambientShadow } from '../theme/shadows';
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
  const [entry, setEntry] = useState<DailyLogEntry | null>(null);
  const [todaysMeals, setTodaysMeals] = useState<MealPlanWithRecipe[]>([]);
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
      const meals = await getTodaysMealsWithRecipe(today);
      
      setEntry(data);
      setTodaysMeals(meals);
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

  const handleToggleMeal = async (planId: number, currentVal: boolean) => {
    try {
      await toggleMealConsumed(planId, !currentVal);
      loadToday();
    } catch (err) {
      console.error('toggleMeal error', err);
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
        <ActivityIndicator size="large" color={Colors.primary} />
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
      {/* ── Date / title banner (within scroll — no duplicate inset padding) */}
      <View style={styles.header}>
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
                backgroundColor: isAllDone ? Colors.primary : Colors.secondary,
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
            accentColor={Colors.primary}
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
            accentColor={Colors.tertiary ?? '#F6AD55'}
          />
          <Checkbox
            checked={entry.fasting_completed}
            label="Fasting window completed"
            onToggle={() => handleToggle('fasting_completed')}
          />
        </View>

        {/* ── Today's Meals ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <TaskCard
            icon="🍽️"
            title="Today's Meal Plan"
            description="Your configured meals for today"
            accentColor={Colors.primary}
          />
          {todaysMeals.length > 0 ? (
            todaysMeals.map(meal => (
              <View key={meal.id} style={{ marginBottom: 4 }}>
                <Checkbox
                  checked={meal.is_consumed}
                  label={meal.recipe?.title ? `${meal.meal_type}: ${meal.recipe.title}` : `${meal.meal_type}: Unknown`}
                  onToggle={() => handleToggleMeal(meal.id, meal.is_consumed)}
                />
                {meal.recipe ? (
                  <Text style={{ marginLeft: 44, marginTop: -4, color: Colors.outline, fontSize: Typography.sizes.label }}>
                    {meal.recipe.calories} kcal • {meal.recipe.protein}g protein
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={{ marginLeft: 44, color: Colors.outline, fontSize: Typography.sizes.bodyS }}>
              No meals planned for today.
            </Text>
          )}
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
                placeholderTextColor={Colors.outline}
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
                <Text style={{ marginLeft: 44, marginTop: -4, color: Colors.outline, fontSize: Typography.sizes.label }}>
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
    color: Colors.onSurfaceVariant,
    fontSize: Typography.sizes.body,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },

  // Header — deep slate background, no border
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surfaceLow,
  },
  headerDate: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    fontWeight: Typography.weights.medium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: Typography.sizes.headline,
    color: Colors.onSurface,
    fontWeight: Typography.weights.bold,
  },
  mealPrepPill: {
    backgroundColor: `${Colors.primary}1a`,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  mealPrepPillText: {
    color: Colors.primary,
    fontSize: Typography.sizes.label,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Progress
  progressContainer: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceLow,
    gap: 6,
  },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.surfaceHighest,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  progressLabel: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    fontWeight: Typography.weights.medium,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Rest banner
  restBanner: {
    backgroundColor: `${Colors.secondary}1a`,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  restBannerText: {
    color: Colors.secondary,
    fontSize: Typography.sizes.bodyS,
    fontWeight: Typography.weights.medium,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.hero,
    gap: Spacing.xl,
  },

  // Section
  section: { gap: Spacing.sm },

  // Task Card — Kinetic Atelier tonal card
  taskCard: {
    backgroundColor: Colors.surfaceLow,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    borderLeftWidth: 4,
  },
  taskIcon: { fontSize: 20, marginTop: 2 },
  taskCardContent: { flex: 1, gap: 4 },
  taskTitle: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    fontWeight: Typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  taskDescription: {
    fontSize: Typography.sizes.bodyL,
    color: Colors.onSurface,
    fontWeight: Typography.weights.medium,
    lineHeight: 24,
  },

  // Checkbox — tonal surface, no border line
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: Colors.tertiaryContainer,
    borderColor: Colors.tertiaryContainer,
  },
  checkmark: {
    color: Colors.onTertiaryContainer,
    fontSize: 13,
    fontWeight: Typography.weights.bold,
  },
  checkboxLabel: {
    fontSize: Typography.sizes.body,
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.medium,
  },
  checkboxLabelChecked: {
    color: Colors.outline,
    textDecorationLine: 'line-through',
  },

  // Hammer / Bio Force section header — strength = blue accent bar
  hammerHeader: {
    backgroundColor: Colors.surfaceLow,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    paddingLeft: Spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
    borderLeftColor: Colors.secondary,
    gap: Spacing.sm,
  },
  hammerHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    flex: 1,
  },
  hammerSubtitle: {
    fontSize: Typography.sizes.bodyS,
    color: Colors.onSurfaceVariant,
    lineHeight: 18,
    marginTop: 2,
    flexShrink: 1,
  },
  exProgressPill: {
    backgroundColor: Colors.surfaceHighest,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
  },
  exProgressPillDone: { backgroundColor: `${Colors.primary}30` },
  exProgressText: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    fontWeight: Typography.weights.bold,
  },
  exProgressTextDone: { color: Colors.primary },

  // Exercise list container
  exerciseList: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },

  // Exercise row — 3 states handled in component
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    backgroundColor: Colors.surface,
  },
  exerciseRowDone: { opacity: 0.6 },
  exCheckbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  exCheckboxDone: {
    backgroundColor: Colors.surfaceHighest,
    borderColor: Colors.outlineVariant,
  },
  exCheckmark: {
    color: Colors.tertiaryContainer,
    fontSize: 12,
    fontWeight: Typography.weights.bold,
  },
  exInfo: { flex: 1, gap: 2 },
  exName: {
    fontSize: Typography.sizes.body,
    color: Colors.onSurface,
    fontWeight: Typography.weights.semibold,
  },
  exNameDone: {
    color: Colors.onSurfaceVariant,
    textDecorationLine: 'line-through',
  },
  exMeta: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // Watch button — primary tint, no border
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  watchBtnIcon: {
    color: Colors.primary,
    fontSize: 10,
  },
  watchBtnLabel: {
    fontSize: Typography.sizes.label,
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  watchBtnPlaceholder: { width: 50 },

  // No exercises hint
  noExercisesHint: {
    fontSize: Typography.sizes.bodyS,
    color: Colors.outline,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },

  // Weight Logging — glassmorphic pill input
  weightCard: {
    backgroundColor: Colors.surfaceHighest,
    borderRadius: Radius.full,
    paddingLeft: Spacing.xl,
    paddingRight: 6,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: `${Colors.outlineVariant}26`,
  },
  weightInput: {
    color: Colors.onSurface,
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.medium,
    flex: 1,
    padding: 0,
  },
  weightSaveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.full,
  },
  weightSaveBtnText: {
    color: Colors.onPrimary,
    fontWeight: Typography.weights.bold,
    fontSize: Typography.sizes.label,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // Extra workouts
  extraWorkoutsHeader: {
    paddingHorizontal: 4,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  extraWorkoutsTitle: {
    fontSize: Typography.sizes.label,
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  addExtraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${Colors.outlineVariant}4d`,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  addExtraBtnIcon: { fontSize: 16 },
  addExtraBtnText: {
    fontSize: Typography.sizes.body,
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.medium,
  },
});
