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
import {
  Card,
  Row,
  IconChip,
  Pill,
  ProgressBar,
  Button,
  BioForceModal,
} from '../components';

// ─── Verdure circle checkbox ──────────────────────────────────────────────────
// Replaces old square Checkbox: 24px circle, empty = line2 ring, done = sage fill

function CircleCheck({
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
      <View style={[styles.circleCheck, checked && styles.circleCheckDone]}>
        {checked && <Text style={styles.circleCheckMark}>✓</Text>}
      </View>
      <Text style={[styles.checkboxLabel, checked && styles.checkboxLabelChecked]}>
        {label}
      </Text>
    </TouchableOpacity>
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

  const watchTrailing = exercise.videoUrl ? (
    <TouchableOpacity
      style={styles.watchBtn}
      onPress={handleWatch}
      activeOpacity={0.75}
    >
      <Text style={styles.watchBtnLabel}>Watch</Text>
    </TouchableOpacity>
  ) : null;

  return (
    <Row
      leading={
        <View style={[styles.exCheckbox, exercise.completed && styles.exCheckboxDone]}>
          <TouchableOpacity
            onPress={onToggle}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
          >
            {exercise.completed && <Text style={styles.exCheckmark}>✓</Text>}
          </TouchableOpacity>
        </View>
      }
      title={exercise.name}
      subtitle={`${exercise.sets} sets × ${exercise.reps} reps`}
      trailing={watchTrailing}
      style={[
        styles.exerciseRowInCard,
        exercise.completed && styles.exerciseRowDone,
      ]}
    />
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
      {/* Section header card */}
      <Card style={styles.sectionHeaderCard}>
        <View style={styles.sectionHeaderRow}>
          <IconChip
            icon={<Text style={styles.chipIcon}>🏋️</Text>}
            accent="sage"
          />
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionLabel}>HAMMER MULTI-GYM</Text>
            <Text style={styles.sectionSub}>{entry.hammer_task}</Text>
          </View>
          {total > 0 && (
            <Pill
              label={`${doneCount}/${total}`}
              accent={allDone ? 'sage' : 'gold'}
            />
          )}
        </View>
      </Card>

      {/* Exercise list */}
      {entry.exercises.length > 0 ? (
        <Card style={styles.exerciseListCard}>
          {entry.exercises.map((ex, idx) => (
            <React.Fragment key={ex.id}>
              <ExerciseRow
                exercise={ex}
                onToggle={() => onExerciseToggle(ex.id, !ex.completed)}
              />
              {idx < entry.exercises.length - 1 && (
                <View style={styles.exerciseDivider} />
              )}
            </React.Fragment>
          ))}
        </Card>
      ) : (
        <Text style={styles.noExercisesHint}>
          No individual exercises configured — use the Template Editor to add them.
        </Text>
      )}

      {/* Session-level completion */}
      <CircleCheck
        checked={entry.hammer_completed}
        label="Mark full gym session complete"
        onToggle={onSessionToggle}
      />
    </View>
  );
}

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
    setEntry((prev) => (prev ? { ...prev, [field]: newValue } : prev));
    try {
      await upsertLogField(today, field, newValue);
    } catch (err) {
      console.error('upsertLogField error', err);
      loadToday();
    }
  };

  const handleExerciseToggle = async (exerciseId: string, value: boolean) => {
    if (!entry) return;
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
      setEntry((prev) => (prev ? { ...prev, body_weight: val } : prev));
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
    setEntry((prev) => (prev ? { ...prev, additional_workouts: updated } : prev));
    try {
      await upsertAdditionalWorkouts(today, updated);
    } catch (err) {
      console.error('upsertAdditionalWorkouts error', err);
      loadToday();
    }
  };

  const handleToggleExtraWorkout = async (id: string) => {
    if (!entry) return;
    const updated = (entry.additional_workouts || []).map((w) =>
      w.id === id ? { ...w, completed: !w.completed } : w
    );
    setEntry((prev) => (prev ? { ...prev, additional_workouts: updated } : prev));
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
        <ActivityIndicator size="large" color={Colors.sage} />
        <Text style={styles.loadingText}>Syncing schedule…</Text>
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.centred}>
        <Text style={styles.loadingText}>
          No entry for today — try reopening the app.
        </Text>
      </View>
    );
  }

  const progress = completionProgress();
  const count = completionCount();
  const isAllDone = progress === 1;

  return (
    <View style={styles.container}>
      {/* ── Hero day card ────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.heroLeft}>
          <Text style={styles.headerDate}>{formatDate()}</Text>
          <Text style={styles.headerTitle}>
            {isAllDone ? 'All done today!' : "Today's Training"}
          </Text>
          {entry.is_meal_prep_day && (
            <View style={styles.mealPrepPill}>
              <Text style={styles.mealPrepPillText}>Meal Prep Day</Text>
            </View>
          )}
        </View>
        <View style={styles.heroRight}>
          <Text style={styles.heroCount}>{count}</Text>
          <Text style={styles.heroCountLabel}>of 3</Text>
        </View>
      </View>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <View style={styles.progressContainer}>
        <ProgressBar progress={progress} height={8} />
        <Text style={styles.progressLabel}>
          {count} / 3 tasks complete
        </Text>
      </View>

      {/* ── Rest day banner ───────────────────────────────────────────────── */}
      {entry.is_rest_day && (
        <View style={styles.restBanner}>
          <Text style={styles.restBannerText}>
            Rest / Recovery Day — lighter weights, focus on form
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
          <Card style={styles.sectionHeaderCard}>
            <View style={styles.sectionHeaderRow}>
              <IconChip
                icon={<Text style={styles.chipIcon}>🚶</Text>}
                accent="sky"
              />
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionLabel}>WALKING</Text>
                <Text style={styles.sectionSub}>{entry.walking_task}</Text>
              </View>
            </View>
          </Card>
          <CircleCheck
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
          <Card style={styles.sectionHeaderCard}>
            <View style={styles.sectionHeaderRow}>
              <IconChip
                icon={<Text style={styles.chipIcon}>⏱</Text>}
                accent="gold"
              />
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionLabel}>INTERMITTENT FASTING</Text>
                <Text style={styles.sectionSub}>
                  16:8 protocol — eating window: 12 pm → 8 pm
                </Text>
              </View>
            </View>
          </Card>
          <CircleCheck
            checked={entry.fasting_completed}
            label="Fasting window completed"
            onToggle={() => handleToggle('fasting_completed')}
          />
        </View>

        {/* ── Today's Meals ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Card style={styles.sectionHeaderCard}>
            <View style={styles.sectionHeaderRow}>
              <IconChip
                icon={<Text style={styles.chipIcon}>🍽</Text>}
                accent="clay"
              />
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionLabel}>TODAY'S MEAL PLAN</Text>
                <Text style={styles.sectionSub}>Your configured meals for today</Text>
              </View>
            </View>
          </Card>
          {todaysMeals.length > 0 ? (
            todaysMeals.map((meal) => (
              <CircleCheck
                key={meal.id}
                checked={meal.is_consumed}
                label={
                  meal.recipe?.title
                    ? `${meal.meal_type}: ${meal.recipe.title}`
                    : `${meal.meal_type}: Unknown`
                }
                onToggle={() => handleToggleMeal(meal.id, meal.is_consumed)}
              />
            ))
          ) : (
            <Text style={styles.emptyHint}>No meals planned for today.</Text>
          )}
        </View>

        {/* ── Body Weight Logging ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <Card style={styles.weightCard}>
            <View style={styles.sectionHeaderRow}>
              <IconChip
                icon={<Text style={styles.chipIcon}>⚖</Text>}
                accent="sage"
              />
              <View style={styles.weightContent}>
                <Text style={styles.sectionLabel}>BODY WEIGHT</Text>
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
              <TouchableOpacity
                style={styles.weightLogBtn}
                onPress={handleSaveWeight}
                activeOpacity={0.75}
              >
                <Text style={styles.weightLogBtnText}>Log</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>

        {/* ── Extra Workouts ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.extraWorkoutsTitle}>Bonuses / Ad-hoc</Text>

          {(entry.additional_workouts || []).map((aw) => (
            <CircleCheck
              key={aw.id}
              checked={aw.completed}
              label={
                aw.muscle_group
                  ? `${aw.name} · ${aw.muscle_group} · ${aw.sets}×${aw.reps}`
                  : aw.name
              }
              onToggle={() => handleToggleExtraWorkout(aw.id)}
            />
          ))}

          <Button
            title="+ Add Extra Workout"
            variant="ghost"
            onPress={() => setExtraModalVisible(true)}
          />
        </View>

        <View style={{ height: Spacing.xl }} />
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
    gap: Spacing.md,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },

  // ── Hero card ─────────────────────────────────────────────────────────────
  hero: {
    backgroundColor: Colors.sageDeep,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroRight: {
    alignItems: 'center',
    marginLeft: Spacing.lg,
  },
  heroCount: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.hero,
    color: '#FFFFFF',
    lineHeight: Typography.sizes.hero,
    letterSpacing: -1,
  },
  heroCountLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.4,
  },

  // Header text (inside hero)
  headerDate: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.4,
  },
  headerTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    lineHeight: Typography.sizes.xl * 1.2,
  },
  mealPrepPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.xs,
  },
  mealPrepPillText: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // ── Progress bar strip ────────────────────────────────────────────────────
  progressContainer: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  progressLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },

  // ── Rest banner ───────────────────────────────────────────────────────────
  restBanner: {
    backgroundColor: Colors.skyTint,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  restBannerText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.skyDeep,
  },

  // ── Scroll ────────────────────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  // ── Section ───────────────────────────────────────────────────────────────
  section: { gap: Spacing.sm },

  // ── Section header card ───────────────────────────────────────────────────
  sectionHeaderCard: {
    padding: Spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  sectionHeaderText: {
    flex: 1,
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  sectionLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sectionSub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.sm * 1.45,
  },

  // ── Chip icon ─────────────────────────────────────────────────────────────
  chipIcon: { fontSize: 18 },

  // ── Verdure circle checkbox ───────────────────────────────────────────────
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
  circleCheck: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  circleCheckDone: {
    backgroundColor: Colors.sage,
    borderColor: Colors.sage,
  },
  circleCheckMark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: Typography.title,
    lineHeight: 16,
  },
  checkboxLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    color: Colors.textSecondary,
    flex: 1,
  },
  checkboxLabelChecked: {
    color: Colors.textMuted,
    textDecorationLine: 'line-through',
  },

  // ── Exercise rows inside Card ─────────────────────────────────────────────
  exerciseListCard: {
    padding: 0,
    overflow: 'hidden',
  },
  exerciseRowInCard: {
    borderRadius: 0,
    minHeight: 48,
  },
  exerciseRowDone: {
    backgroundColor: Colors.sageTint,
  },
  exerciseDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.lg,
  },

  // ── Exercise circle checkbox ──────────────────────────────────────────────
  exCheckbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  exCheckboxDone: {
    backgroundColor: Colors.sage,
    borderColor: Colors.sage,
  },
  exCheckmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: Typography.title,
  },

  // ── Watch tutorial button ─────────────────────────────────────────────────
  watchBtn: {
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  watchBtnLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
  },

  // ── No exercises hint ─────────────────────────────────────────────────────
  noExercisesHint: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },

  // ── Empty meal hint ───────────────────────────────────────────────────────
  emptyHint: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },

  // ── Weight card ───────────────────────────────────────────────────────────
  weightCard: {
    padding: Spacing.md,
  },
  weightContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  weightInput: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    padding: 0,
  },
  weightLogBtn: {
    backgroundColor: Colors.sageTint,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    alignSelf: 'center',
  },
  weightLogBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
  },

  // ── Extra workouts ────────────────────────────────────────────────────────
  extraWorkoutsTitle: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
});
