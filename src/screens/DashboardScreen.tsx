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
import { Ionicons } from '@expo/vector-icons';

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
  getWaterForDay,
  addWater,
  getHydrationGoal,
  logBodyMeasurement,
  getLatestMeasurements,
  type BodyMeasurement,
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
import { iconChipIconColor } from '../components/IconChip';

// ─── Verdure circle checkbox ──────────────────────────────────────────────────
// Replaces old square Checkbox: 24px circle, empty = line2 ring, done = sage fill

/**
 * CircleCheck — Verdure 24px circle checkbox (DESIGN.md §5).
 * When `label` is provided renders as a full tappable row (used for walk/fasting/session toggles).
 * When `label` is omitted renders as the bare circle only (for use as Row leading slot).
 */
function CircleCheck({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label?: string;
  onToggle: () => void;
}) {
  const circle = (
    <View style={[styles.circleCheck, checked && styles.circleCheckDone]}>
      {checked && <Text style={styles.circleCheckMark}>✓</Text>}
    </View>
  );

  if (!label) {
    return (
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        {circle}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      {circle}
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
        <CircleCheck checked={exercise.completed} onToggle={onToggle} />
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
            icon={<Ionicons name="barbell-outline" size={20} color={iconChipIconColor('sage')} />}
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

  // Hydration state
  const [waterMl, setWaterMl] = useState(0);
  const [hydrationGoal, setHydrationGoal] = useState(2000);

  // Measurements state
  const [measurementsModalVisible, setMeasurementsModalVisible] = useState(false);
  const [latestMeasurements, setLatestMeasurements] = useState<BodyMeasurement | null>(null);

  const today = toISODate();

  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      await syncRollingSchedule();
      const [data, meals, water, goal, measurements] = await Promise.all([
        getLogByDate(today),
        getTodaysMealsWithRecipe(today),
        getWaterForDay(today),
        getHydrationGoal(),
        getLatestMeasurements(),
      ]);

      setEntry(data);
      setTodaysMeals(meals);
      setWaterMl(water);
      setHydrationGoal(goal);
      setLatestMeasurements(measurements);
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

  // ── Hydration handlers ────────────────────────────────────────────────────────

  const handleAddWater = async (ml: number) => {
    try {
      await addWater(today, ml);
      setWaterMl((prev) => Math.max(0, prev + ml));
    } catch (err) {
      console.error('addWater error', err);
    }
  };

  // ── Measurement handlers ──────────────────────────────────────────────────────

  const handleSaveMeasurements = async (fields: {
    waist_cm?: number | null;
    chest_cm?: number | null;
    hips_cm?: number | null;
    thigh_cm?: number | null;
    arm_cm?: number | null;
  }) => {
    try {
      await logBodyMeasurement(today, fields);
      const updated = await getLatestMeasurements();
      setLatestMeasurements(updated);
    } catch (err) {
      console.error('logBodyMeasurement error', err);
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
                icon={<Ionicons name="walk-outline" size={20} color={iconChipIconColor('sky')} />}
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
                icon={<Ionicons name="time-outline" size={20} color={iconChipIconColor('gold')} />}
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
                icon={<Ionicons name="restaurant-outline" size={20} color={iconChipIconColor('clay')} />}
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
              <Row
                key={meal.id}
                leading={
                  <CircleCheck
                    checked={meal.is_consumed}
                    onToggle={() => handleToggleMeal(meal.id, meal.is_consumed)}
                  />
                }
                title={
                  meal.recipe?.title
                    ? `${meal.meal_type}: ${meal.recipe.title}`
                    : `${meal.meal_type}: Unknown`
                }
                subtitle={
                  meal.recipe
                    ? `${meal.recipe.calories} kcal · ${meal.recipe.protein}g protein`
                    : undefined
                }
                style={meal.is_consumed ? styles.rowConsumed : undefined}
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
                icon={<Ionicons name="scale-outline" size={20} color={iconChipIconColor('sage')} />}
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

        {/* ── Hydration ────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Card style={styles.sectionHeaderCard}>
            <View style={styles.sectionHeaderRow}>
              <IconChip
                icon={<Ionicons name="water-outline" size={20} color={iconChipIconColor('sky')} />}
                accent="sky"
              />
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionLabel}>HYDRATION</Text>
                <Text style={styles.sectionSub}>
                  {waterMl} / {hydrationGoal} ml today
                </Text>
              </View>
              <Pill
                label={waterMl >= hydrationGoal ? 'Goal met' : `${Math.round((waterMl / hydrationGoal) * 100)}%`}
                accent={waterMl >= hydrationGoal ? 'sage' : 'sky'}
              />
            </View>
            <ProgressBar
              progress={Math.min(1, waterMl / Math.max(1, hydrationGoal))}
              height={6}
              style={styles.hydrationBar}
            />
            <View style={styles.hydrationButtons}>
              <TouchableOpacity
                style={styles.hydrationBtn}
                onPress={() => handleAddWater(250)}
                activeOpacity={0.75}
                accessibilityLabel="Add 250 ml"
                accessibilityRole="button"
              >
                <Ionicons name="add-outline" size={14} color={Colors.skyDeep} />
                <Text style={styles.hydrationBtnLabel}>+250 ml</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.hydrationBtn}
                onPress={() => handleAddWater(500)}
                activeOpacity={0.75}
                accessibilityLabel="Add 500 ml"
                accessibilityRole="button"
              >
                <Ionicons name="add-outline" size={14} color={Colors.skyDeep} />
                <Text style={styles.hydrationBtnLabel}>+500 ml</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.hydrationBtn, styles.hydrationBtnUndo]}
                onPress={() => handleAddWater(-250)}
                activeOpacity={0.75}
                accessibilityLabel="Remove 250 ml"
                accessibilityRole="button"
              >
                <Ionicons name="remove-outline" size={14} color={Colors.textMuted} />
                <Text style={[styles.hydrationBtnLabel, styles.hydrationBtnUndoLabel]}>-250 ml</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>

        {/* ── Body Measurements ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Card style={styles.sectionHeaderCard}>
            <View style={styles.sectionHeaderRow}>
              <IconChip
                icon={<Ionicons name="body-outline" size={20} color={iconChipIconColor('clay')} />}
                accent="clay"
              />
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionLabel}>MEASUREMENTS</Text>
                <Text style={styles.sectionSub}>
                  {latestMeasurements
                    ? `Last: ${latestMeasurements.date}`
                    : 'No measurements logged yet'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.measureLogBtn}
                onPress={() => setMeasurementsModalVisible(true)}
                activeOpacity={0.75}
                accessibilityLabel="Log measurements"
                accessibilityRole="button"
              >
                <Ionicons name="add-outline" size={16} color={Colors.clayDeep} />
                <Text style={styles.measureLogBtnLabel}>Log</Text>
              </TouchableOpacity>
            </View>
            {latestMeasurements && (
              <View style={styles.measurementPills}>
                {latestMeasurements.waist_cm != null && (
                  <View style={styles.measurePill}>
                    <Text style={styles.measurePillLabel}>Waist</Text>
                    <Text style={styles.measurePillValue}>{latestMeasurements.waist_cm} cm</Text>
                  </View>
                )}
                {latestMeasurements.chest_cm != null && (
                  <View style={styles.measurePill}>
                    <Text style={styles.measurePillLabel}>Chest</Text>
                    <Text style={styles.measurePillValue}>{latestMeasurements.chest_cm} cm</Text>
                  </View>
                )}
                {latestMeasurements.hips_cm != null && (
                  <View style={styles.measurePill}>
                    <Text style={styles.measurePillLabel}>Hips</Text>
                    <Text style={styles.measurePillValue}>{latestMeasurements.hips_cm} cm</Text>
                  </View>
                )}
                {latestMeasurements.thigh_cm != null && (
                  <View style={styles.measurePill}>
                    <Text style={styles.measurePillLabel}>Thigh</Text>
                    <Text style={styles.measurePillValue}>{latestMeasurements.thigh_cm} cm</Text>
                  </View>
                )}
                {latestMeasurements.arm_cm != null && (
                  <View style={styles.measurePill}>
                    <Text style={styles.measurePillLabel}>Arm</Text>
                    <Text style={styles.measurePillValue}>{latestMeasurements.arm_cm} cm</Text>
                  </View>
                )}
              </View>
            )}
          </Card>
        </View>

        {/* ── Extra Workouts ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.extraWorkoutsTitle}>Bonuses / Ad-hoc</Text>

          {(entry.additional_workouts || []).map((aw) => (
            <Row
              key={aw.id}
              leading={
                <CircleCheck
                  checked={aw.completed}
                  onToggle={() => handleToggleExtraWorkout(aw.id)}
                />
              }
              title={aw.name}
              subtitle={
                aw.muscle_group
                  ? `${aw.muscle_group} · ${aw.sets} sets × ${aw.reps} reps`
                  : undefined
              }
              style={aw.completed ? styles.rowConsumed : undefined}
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

      {/* ── Body Measurements Modal ──────────────────────────────────────── */}
      <MeasurementsModal
        visible={measurementsModalVisible}
        onClose={() => setMeasurementsModalVisible(false)}
        onSave={handleSaveMeasurements}
        latest={latestMeasurements}
      />
    </View>
  );
}

// ─── Body Measurements Modal ──────────────────────────────────────────────────

function MeasurementsModal({
  visible,
  onClose,
  onSave,
  latest,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (fields: {
    waist_cm?: number | null;
    chest_cm?: number | null;
    hips_cm?: number | null;
    thigh_cm?: number | null;
    arm_cm?: number | null;
  }) => Promise<void>;
  latest: BodyMeasurement | null;
}) {
  const [waist, setWaist] = useState('');
  const [chest, setChest] = useState('');
  const [hips, setHips]   = useState('');
  const [thigh, setThigh] = useState('');
  const [arm, setArm]     = useState('');

  // Pre-fill from latest measurements when the modal opens
  useEffect(() => {
    if (visible) {
      setWaist(latest?.waist_cm != null ? String(latest.waist_cm) : '');
      setChest(latest?.chest_cm != null ? String(latest.chest_cm) : '');
      setHips(latest?.hips_cm != null  ? String(latest.hips_cm)  : '');
      setThigh(latest?.thigh_cm != null ? String(latest.thigh_cm) : '');
      setArm(latest?.arm_cm != null    ? String(latest.arm_cm)   : '');
    }
  }, [visible, latest]);

  const parseField = (s: string): number | null => {
    const v = parseFloat(s);
    return isNaN(v) || v <= 0 ? null : v;
  };

  const handleSave = async () => {
    await onSave({
      waist_cm: parseField(waist),
      chest_cm: parseField(chest),
      hips_cm:  parseField(hips),
      thigh_cm: parseField(thigh),
      arm_cm:   parseField(arm),
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Body Measurements</Text>
          <Text style={styles.modalSubtitle}>Enter values in cm — leave blank to skip</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
            {(
              [
                { label: 'Waist', value: waist, onChange: setWaist },
                { label: 'Chest', value: chest, onChange: setChest },
                { label: 'Hips',  value: hips,  onChange: setHips  },
                { label: 'Thigh', value: thigh, onChange: setThigh },
                { label: 'Arm',   value: arm,   onChange: setArm   },
              ] as const
            ).map((field) => (
              <View key={field.label} style={styles.measureField}>
                <Text style={styles.measureFieldLabel}>{field.label} (cm)</Text>
                <TextInput
                  style={styles.measureFieldInput}
                  value={field.value}
                  onChangeText={field.onChange}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="next"
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button title="Cancel" variant="ghost" onPress={onClose} />
            <Button title="Save" variant="primary" onPress={handleSave} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
    color: Colors.textOnAccent,
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
    color: Colors.textOnAccent,
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
    color: Colors.textOnAccent,
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
    color: Colors.textOnAccent,
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

  // ── Consumed / done row dimming ───────────────────────────────────────────
  rowConsumed: {
    opacity: 0.6,
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

  // ── Hydration ─────────────────────────────────────────────────────────────
  hydrationBar: {
    marginTop: Spacing.md,
  },
  hydrationButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  hydrationBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.skyTint,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.sky,
  },
  hydrationBtnLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.skyDeep,
  },
  hydrationBtnUndo: {
    backgroundColor: Colors.canvasSunken,
    borderColor: Colors.line2,
  },
  hydrationBtnUndoLabel: {
    color: Colors.textMuted,
  },

  // ── Measurements ──────────────────────────────────────────────────────────
  measureLogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.clay,
    alignSelf: 'center',
  },
  measureLogBtnLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.clayDeep,
  },
  measurementPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  measurePill: {
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    minWidth: 64,
  },
  measurePillLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs - 1,
    color: Colors.clayDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  measurePillValue: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    marginTop: 2,
  },

  // ── Measurements modal ────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(44,53,46,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '75%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: Colors.line2,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: Spacing.xs,
  },
  modalSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
  },
  modalScroll: {
    paddingBottom: Spacing.md,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  measureField: {
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  measureFieldLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  measureFieldInput: {
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.line2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
  },
});
