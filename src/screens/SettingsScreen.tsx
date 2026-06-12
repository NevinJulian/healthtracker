/**
 * SettingsScreen — Unit 3a: workout reminder toggle + time chooser.
 *
 * Structure is deliberately open for Unit 3b to add cooking-reminder
 * controls in the same card/section pattern below the workout section.
 *
 * Styling: Verdure tokens only (Colors, Spacing, Typography, Radius).
 * No raw hex or magic numbers. Outline Ionicons only (no emoji in UI).
 * Screen adds no top padding — the nav header owns it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  getWorkoutReminderEnabled,
  getWorkoutReminderTime,
  setWorkoutReminderEnabled,
  setWorkoutReminderTime,
  getCookWhenEmptyEnabled,
  setCookWhenEmptyEnabled,
  getWeeklyCookDayEnabled,
  setWeeklyCookDayEnabled,
  getWeeklyCookDay,
  setWeeklyCookDay,
  getWeeklyCookDayTime,
  setWeeklyCookDayTime,
  getNutritionGoals,
  setNutritionGoalCalories,
  setNutritionGoalProtein,
} from '../db/database';
import {
  ensurePermissions,
  reconcileScheduledNotifications,
  formatTimeString,
  parseTimeString,
} from '../services/notifications';
import Card from '../components/Card';
import ScreenHeader from '../components/ScreenHeader';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReminderState {
  enabled: boolean;
  time: string;
  permissionDenied: boolean;
}

interface CookingReminderState {
  cookWhenEmptyEnabled: boolean;
  weeklyCookDayEnabled: boolean;
  weeklyCookDay: number;       // 0–6 (0 = Sunday)
  weeklyCookDayTime: string;   // "HH:MM"
  permissionDenied: boolean;
}

// Clamp bounds for nutrition goal steppers
const CALORIES_MIN = 500;
const CALORIES_MAX = 5000;
const CALORIES_STEP = 50;
const PROTEIN_MIN = 10;
const PROTEIN_MAX = 500;
const PROTEIN_STEP = 5;

// Day labels for the weekday chip selector (index = JS weekday 0–6)
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// ─── Time stepper helpers ────────────────────────────────────────────────────

const MINUTE_STEP = 15; // steps: 00, 15, 30, 45

function stepHour(hour: number, delta: number): number {
  return ((hour + delta + 24) % 24);
}

function stepMinute(minute: number, delta: number): number {
  const steps = 60 / MINUTE_STEP;
  const currentStep = Math.round(minute / MINUTE_STEP) % steps;
  const newStep = ((currentStep + delta) % steps + steps) % steps;
  return newStep * MINUTE_STEP;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface StepperProps {
  value: string;
  label: string;
  onDecrement: () => void;
  onIncrement: () => void;
}

function TimeStepper({ value, label, onDecrement, onIncrement }: StepperProps) {
  return (
    <View style={stepperStyles.container}>
      <Text style={stepperStyles.label}>{label}</Text>
      <View style={stepperStyles.row}>
        <TouchableOpacity
          style={stepperStyles.btn}
          onPress={onDecrement}
          accessibilityLabel={`Decrease ${label}`}
          accessibilityRole="button"
          activeOpacity={0.7}
        >
          <Ionicons name="remove-outline" size={18} color={Colors.sageDeep} />
        </TouchableOpacity>
        <Text style={stepperStyles.value}>{value}</Text>
        <TouchableOpacity
          style={stepperStyles.btn}
          onPress={onIncrement}
          accessibilityLabel={`Increase ${label}`}
          accessibilityRole="button"
          activeOpacity={0.7}
        >
          <Ionicons name="add-outline" size={18} color={Colors.sageDeep} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
  },
  label: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    minWidth: 36,
    textAlign: 'center',
  },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [reminder, setReminder] = useState<ReminderState>({
    enabled: false,
    time: '08:00',
    permissionDenied: false,
  });

  const [cooking, setCooking] = useState<CookingReminderState>({
    cookWhenEmptyEnabled: false,
    weeklyCookDayEnabled: false,
    weeklyCookDay: 0,
    weeklyCookDayTime: '10:00',
    permissionDenied: false,
  });

  // Nutrition goals — seeded from NUTRITION_GOALS defaults until DB is loaded
  const [goalCalories, setGoalCalories] = useState(1800);
  const [goalProtein, setGoalProtein] = useState(150);

  // Load persisted settings on focus (same pattern as other screens using useFocusEffect)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [
          workoutEnabled,
          workoutTime,
          cookWhenEmptyEnabled,
          weeklyCookDayEnabled,
          weeklyCookDay,
          weeklyCookDayTime,
          nutritionGoals,
        ] = await Promise.all([
          getWorkoutReminderEnabled(),
          getWorkoutReminderTime(),
          getCookWhenEmptyEnabled(),
          getWeeklyCookDayEnabled(),
          getWeeklyCookDay(),
          getWeeklyCookDayTime(),
          getNutritionGoals(),
        ]);
        if (active) {
          setReminder((prev) => ({ ...prev, enabled: workoutEnabled, time: workoutTime, permissionDenied: false }));
          setCooking((prev) => ({
            ...prev,
            cookWhenEmptyEnabled,
            weeklyCookDayEnabled,
            weeklyCookDay,
            weeklyCookDayTime,
            permissionDenied: false,
          }));
          setGoalCalories(nutritionGoals.calories);
          setGoalProtein(nutritionGoals.protein);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Workout: Toggle ─────────────────────────────────────────────────────

  async function handleWorkoutToggle(value: boolean) {
    if (value) {
      const granted = await ensurePermissions();
      if (!granted) {
        setReminder((prev) => ({ ...prev, permissionDenied: true }));
        return;
      }
    }
    await setWorkoutReminderEnabled(value);
    setReminder((prev) => ({ ...prev, enabled: value, permissionDenied: false }));
    await reconcileScheduledNotifications();
  }

  // ── Workout: Time adjustments ───────────────────────────────────────────

  async function adjustWorkoutTime(hourDelta: number, minuteDelta: number) {
    const { hour, minute } = parseTimeString(reminder.time);
    const newHour = stepHour(hour, hourDelta);
    const newMinute = stepMinute(minute, minuteDelta);
    const newTime = formatTimeString(newHour, newMinute);
    await setWorkoutReminderTime(newTime);
    setReminder((prev) => ({ ...prev, time: newTime }));
    if (reminder.enabled) {
      await reconcileScheduledNotifications();
    }
  }

  // ── Cooking: Cook-when-empty toggle ────────────────────────────────────

  async function handleCookWhenEmptyToggle(value: boolean) {
    if (value) {
      const granted = await ensurePermissions();
      if (!granted) {
        setCooking((prev) => ({ ...prev, permissionDenied: true }));
        return;
      }
    }
    await setCookWhenEmptyEnabled(value);
    setCooking((prev) => ({ ...prev, cookWhenEmptyEnabled: value, permissionDenied: false }));
  }

  // ── Cooking: Weekly cook-day toggle ────────────────────────────────────

  async function handleWeeklyCookDayToggle(value: boolean) {
    if (value) {
      const granted = await ensurePermissions();
      if (!granted) {
        setCooking((prev) => ({ ...prev, permissionDenied: true }));
        return;
      }
    }
    await setWeeklyCookDayEnabled(value);
    setCooking((prev) => ({ ...prev, weeklyCookDayEnabled: value, permissionDenied: false }));
    await reconcileScheduledNotifications();
  }

  // ── Cooking: Weekday chip selection ────────────────────────────────────

  async function handleWeekdaySelect(day: number) {
    await setWeeklyCookDay(day);
    setCooking((prev) => ({ ...prev, weeklyCookDay: day }));
    if (cooking.weeklyCookDayEnabled) {
      await reconcileScheduledNotifications();
    }
  }

  // ── Cooking: Cook-day time adjustments ─────────────────────────────────

  async function adjustCookDayTime(hourDelta: number, minuteDelta: number) {
    const { hour, minute } = parseTimeString(cooking.weeklyCookDayTime);
    const newHour = stepHour(hour, hourDelta);
    const newMinute = stepMinute(minute, minuteDelta);
    const newTime = formatTimeString(newHour, newMinute);
    await setWeeklyCookDayTime(newTime);
    setCooking((prev) => ({ ...prev, weeklyCookDayTime: newTime }));
    if (cooking.weeklyCookDayEnabled) {
      await reconcileScheduledNotifications();
    }
  }

  // ── Nutrition goals: step handlers ────────────────────────────────────

  async function adjustCalories(delta: number) {
    const newVal = Math.min(CALORIES_MAX, Math.max(CALORIES_MIN, goalCalories + delta));
    await setNutritionGoalCalories(newVal);
    setGoalCalories(newVal);
  }

  async function adjustProtein(delta: number) {
    const newVal = Math.min(PROTEIN_MAX, Math.max(PROTEIN_MIN, goalProtein + delta));
    await setNutritionGoalProtein(newVal);
    setGoalProtein(newVal);
  }

  const { hour: workoutHour, minute: workoutMinute } = parseTimeString(reminder.time);
  const { hour: cookHour, minute: cookMinute } = parseTimeString(cooking.weeklyCookDayTime);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Settings"
        subtitle="Notifications and preferences"
        style={styles.header}
      />

      {/* ── Workout reminder section ─────────────────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.sectionLabelRow}>
          <Ionicons name="barbell-outline" size={16} color={Colors.sageDeep} />
          <Text style={styles.sectionLabel}>Workout reminder</Text>
        </View>

        {/* Toggle row */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextBlock}>
            <Text style={styles.toggleTitle}>Daily reminder</Text>
            <Text style={styles.toggleSubtitle}>
              Get a notification at your chosen time each day
            </Text>
          </View>
          <Switch
            value={reminder.enabled}
            onValueChange={handleWorkoutToggle}
            trackColor={{ false: Colors.canvasSunken, true: Colors.sage }}
            thumbColor={reminder.enabled ? Colors.surface : Colors.textMuted}
            ios_backgroundColor={Colors.canvasSunken}
            accessibilityLabel="Enable daily workout reminder"
          />
        </View>

        {/* Permission denied notice */}
        {reminder.permissionDenied && (
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.clayDeep} />
            <Text style={styles.noticeText}>
              Enable notifications in your device settings to receive reminders.
            </Text>
          </View>
        )}

        {/* Time chooser (visible only when enabled) */}
        {reminder.enabled && (
          <View style={styles.timePicker}>
            <View style={styles.timePickerDivider} />
            <Text style={styles.timePickerHeading}>Reminder time</Text>
            <View style={styles.timeStepperRow}>
              <TimeStepper
                label="Hour"
                value={String(workoutHour).padStart(2, '0')}
                onDecrement={() => adjustWorkoutTime(-1, 0)}
                onIncrement={() => adjustWorkoutTime(1, 0)}
              />
              <Text style={styles.timeSeparator}>:</Text>
              <TimeStepper
                label="Minute"
                value={String(workoutMinute).padStart(2, '0')}
                onDecrement={() => adjustWorkoutTime(0, -1)}
                onIncrement={() => adjustWorkoutTime(0, 1)}
              />
            </View>
            <Text style={styles.timePreview}>
              Reminder set for {formatTimeString(workoutHour, workoutMinute)}
            </Text>
          </View>
        )}
      </Card>

      {/* ── Cooking reminders section (Unit 3b) ─────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.sectionLabelRow}>
          <Ionicons name="restaurant-outline" size={16} color={Colors.clayDeep} />
          <Text style={[styles.sectionLabel, styles.sectionLabelCooking]}>Cooking reminders</Text>
        </View>

        {/* Cooking permission denied notice (shared) */}
        {cooking.permissionDenied && (
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.clayDeep} />
            <Text style={styles.noticeText}>
              Enable notifications in your device settings to receive reminders.
            </Text>
          </View>
        )}

        {/* Cook-when-empty toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextBlock}>
            <Text style={styles.toggleTitle}>Cook when stock is empty</Text>
            <Text style={styles.toggleSubtitle}>
              Get a nudge when you run out of prepped meals
            </Text>
          </View>
          <Switch
            value={cooking.cookWhenEmptyEnabled}
            onValueChange={handleCookWhenEmptyToggle}
            trackColor={{ false: Colors.canvasSunken, true: Colors.clay }}
            thumbColor={cooking.cookWhenEmptyEnabled ? Colors.surface : Colors.textMuted}
            ios_backgroundColor={Colors.canvasSunken}
            accessibilityLabel="Enable cook-when-empty reminder"
          />
        </View>

        <View style={styles.sectionDivider} />

        {/* Weekly cook-day toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextBlock}>
            <Text style={styles.toggleTitle}>Weekly cook day</Text>
            <Text style={styles.toggleSubtitle}>
              Recurring reminder on your chosen day and time
            </Text>
          </View>
          <Switch
            value={cooking.weeklyCookDayEnabled}
            onValueChange={handleWeeklyCookDayToggle}
            trackColor={{ false: Colors.canvasSunken, true: Colors.clay }}
            thumbColor={cooking.weeklyCookDayEnabled ? Colors.surface : Colors.textMuted}
            ios_backgroundColor={Colors.canvasSunken}
            accessibilityLabel="Enable weekly cook-day reminder"
          />
        </View>

        {/* Weekday + time chooser (visible only when weekly cook-day is enabled) */}
        {cooking.weeklyCookDayEnabled && (
          <View style={styles.timePicker}>
            <View style={styles.timePickerDivider} />

            {/* Weekday chip selector */}
            <Text style={styles.timePickerHeading}>Cook day</Text>
            <View style={styles.weekdayRow}>
              {DAY_LABELS.map((label, idx) => {
                const selected = cooking.weeklyCookDay === idx;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[styles.weekdayChip, selected && styles.weekdayChipSelected]}
                    onPress={() => handleWeekdaySelect(idx)}
                    accessibilityLabel={`Select ${label}`}
                    accessibilityRole="button"
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.weekdayChipLabel, selected && styles.weekdayChipLabelSelected]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Time stepper */}
            <Text style={[styles.timePickerHeading, styles.timePickerHeadingSpaced]}>Reminder time</Text>
            <View style={styles.timeStepperRow}>
              <TimeStepper
                label="Hour"
                value={String(cookHour).padStart(2, '0')}
                onDecrement={() => adjustCookDayTime(-1, 0)}
                onIncrement={() => adjustCookDayTime(1, 0)}
              />
              <Text style={styles.timeSeparator}>:</Text>
              <TimeStepper
                label="Minute"
                value={String(cookMinute).padStart(2, '0')}
                onDecrement={() => adjustCookDayTime(0, -1)}
                onIncrement={() => adjustCookDayTime(0, 1)}
              />
            </View>
            <Text style={styles.timePreview}>
              Reminder every {DAY_LABELS[cooking.weeklyCookDay]} at {formatTimeString(cookHour, cookMinute)}
            </Text>
          </View>
        )}
      </Card>

      {/* ── Nutrition goals section (#274) ──────────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.sectionLabelRow}>
          <Ionicons name="nutrition-outline" size={16} color={Colors.clayDeep} />
          <Text style={[styles.sectionLabel, styles.sectionLabelNutrition]}>Nutrition goals</Text>
        </View>

        <Text style={styles.nutritionSubtitle}>
          Daily targets used in the Analytics screen
        </Text>

        {/* Calories stepper */}
        <View style={styles.goalStepperRow}>
          <View style={styles.goalStepperLabelBlock}>
            <Text style={styles.goalStepperTitle}>Daily calories</Text>
            <Text style={styles.goalStepperUnit}>kcal / day</Text>
          </View>
          <View style={styles.goalStepperControls}>
            <TouchableOpacity
              style={styles.goalStepperBtn}
              onPress={() => adjustCalories(-CALORIES_STEP)}
              accessibilityLabel="Decrease calorie goal"
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="remove-outline" size={18} color={Colors.clayDeep} />
            </TouchableOpacity>
            <Text style={styles.goalStepperValue}>{goalCalories}</Text>
            <TouchableOpacity
              style={styles.goalStepperBtn}
              onPress={() => adjustCalories(CALORIES_STEP)}
              accessibilityLabel="Increase calorie goal"
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="add-outline" size={18} color={Colors.clayDeep} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionDivider} />

        {/* Protein stepper */}
        <View style={styles.goalStepperRow}>
          <View style={styles.goalStepperLabelBlock}>
            <Text style={styles.goalStepperTitle}>Daily protein</Text>
            <Text style={styles.goalStepperUnit}>g / day</Text>
          </View>
          <View style={styles.goalStepperControls}>
            <TouchableOpacity
              style={styles.goalStepperBtn}
              onPress={() => adjustProtein(-PROTEIN_STEP)}
              accessibilityLabel="Decrease protein goal"
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="remove-outline" size={18} color={Colors.clayDeep} />
            </TouchableOpacity>
            <Text style={styles.goalStepperValue}>{goalProtein}</Text>
            <TouchableOpacity
              style={styles.goalStepperBtn}
              onPress={() => adjustProtein(PROTEIN_STEP)}
              accessibilityLabel="Increase protein goal"
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="add-outline" size={18} color={Colors.clayDeep} />
            </TouchableOpacity>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: Spacing.xxl,
  },
  header: {
    paddingTop: Spacing.lg,
  },
  card: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },

  // Section heading
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  toggleTextBlock: {
    flex: 1,
  },
  toggleTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  toggleSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: Typography.sizes.xs * 1.5,
  },

  // Permission denied notice
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.clayDeep,
    lineHeight: Typography.sizes.xs * 1.5,
  },

  // Time picker
  timePicker: {
    marginTop: Spacing.md,
  },
  timePickerDivider: {
    height: 1,
    backgroundColor: Colors.line,
    marginBottom: Spacing.md,
  },
  timePickerHeading: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  timeStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  timeSeparator: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textMuted,
    marginTop: Spacing.md, // visually align with the value text
  },
  timePreview: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },

  // Cooking section overrides
  sectionLabelCooking: {
    color: Colors.clayDeep,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: Colors.line,
    marginVertical: Spacing.md,
  },

  // Weekday chip selector
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  weekdayChip: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
  },
  weekdayChipSelected: {
    backgroundColor: Colors.clayTint,
  },
  weekdayChipLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weekdayChipLabelSelected: {
    color: Colors.clayDeep,
  },
  timePickerHeadingSpaced: {
    marginTop: Spacing.md,
  },

  // Nutrition goals section
  sectionLabelNutrition: {
    color: Colors.clayDeep,
  },
  nutritionSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: Typography.sizes.xs * 1.5,
  },
  goalStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  goalStepperLabelBlock: {
    flex: 1,
  },
  goalStepperTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  goalStepperUnit: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  goalStepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  goalStepperBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.clayTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalStepperValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    minWidth: 52,
    textAlign: 'center',
  },
});
