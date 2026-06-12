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

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
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
  getUserProfile,
  setProfileHeightCm,
  setProfileAge,
  setProfileSex,
  setProfileActivityLevel,
  setProfileGoalType,
  getLatestBodyWeight,
  getHydrationGoal,
  setHydrationGoal,
  type Sex,
  type ActivityLevel,
  type GoalType,
  type UserProfileData,
} from '../db/database';
import { suggestGoals } from '../nutrition/tdee';
import {
  ensurePermissions,
  reconcileScheduledNotifications,
  formatTimeString,
  parseTimeString,
} from '../services/notifications';
import { exportBackup, importBackup } from '../services/backup';
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

// Clamp bounds for hydration goal stepper
const HYDRATION_MIN = 250;
const HYDRATION_MAX = 6000;
const HYDRATION_STEP = 250;

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

  // Backup state
  const [backupBusy, setBackupBusy] = useState(false);

  // Nutrition goals — seeded from NUTRITION_GOALS defaults until DB is loaded
  const [goalCalories, setGoalCalories] = useState(1800);
  const [goalProtein, setGoalProtein] = useState(150);

  // Hydration goal (#283)
  const [hydrationGoalMl, setHydrationGoalMl] = useState(2000);

  // User profile state (#281)
  const [profile, setProfile] = useState<UserProfileData>({
    heightCm: null,
    age: null,
    sex: null,
    activityLevel: null,
    goalType: null,
  });
  // Editable text fields for the profile (strings so TextInput is controlled)
  const [profileHeightStr, setProfileHeightStr] = useState('');
  const [profileAgeStr, setProfileAgeStr] = useState('');
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [recalcBusy, setRecalcBusy] = useState(false);

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
          userProfile,
          weight,
          hydrationGoal,
        ] = await Promise.all([
          getWorkoutReminderEnabled(),
          getWorkoutReminderTime(),
          getCookWhenEmptyEnabled(),
          getWeeklyCookDayEnabled(),
          getWeeklyCookDay(),
          getWeeklyCookDayTime(),
          getNutritionGoals(),
          getUserProfile(),
          getLatestBodyWeight(),
          getHydrationGoal(),
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
          setHydrationGoalMl(hydrationGoal);
          setProfile(userProfile);
          setProfileHeightStr(userProfile.heightCm != null ? String(userProfile.heightCm) : '');
          setProfileAgeStr(userProfile.age != null ? String(userProfile.age) : '');
          setLatestWeight(weight);
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

  // ── Hydration goal: step handler (#283) ───────────────────────────────

  async function adjustHydrationGoal(delta: number) {
    const newVal = Math.min(HYDRATION_MAX, Math.max(HYDRATION_MIN, hydrationGoalMl + delta));
    await setHydrationGoal(newVal);
    setHydrationGoalMl(newVal);
  }

  // ── Profile: field save helpers (#281) ────────────────────────────────

  async function handleProfileHeightBlur() {
    const val = parseFloat(profileHeightStr);
    if (Number.isFinite(val) && val > 0) {
      await setProfileHeightCm(val);
      setProfile((prev) => ({ ...prev, heightCm: val }));
    }
  }

  async function handleProfileAgeBlur() {
    const val = parseFloat(profileAgeStr);
    if (Number.isFinite(val) && val > 0) {
      await setProfileAge(val);
      setProfile((prev) => ({ ...prev, age: val }));
    }
  }

  async function handleProfileSex(sex: Sex) {
    await setProfileSex(sex);
    setProfile((prev) => ({ ...prev, sex }));
  }

  async function handleProfileActivity(level: ActivityLevel) {
    await setProfileActivityLevel(level);
    setProfile((prev) => ({ ...prev, activityLevel: level }));
  }

  async function handleProfileGoal(goal: GoalType) {
    await setProfileGoalType(goal);
    setProfile((prev) => ({ ...prev, goalType: goal }));
  }

  // ── Profile: recalculate goals ────────────────────────────────────────

  async function handleRecalcGoals() {
    const { heightCm, age, sex, activityLevel, goalType } = profile;
    if (
      heightCm == null || age == null || sex == null ||
      activityLevel == null || goalType == null
    ) {
      Alert.alert(
        'Profile incomplete',
        'Please fill in all profile fields (sex, height, age, activity level and goal) before recalculating.'
      );
      return;
    }
    const weightKg = latestWeight ?? 80; // fallback if no weight logged
    const goals = suggestGoals({ sex, age, heightCm, activityLevel, goalType }, weightKg);
    setRecalcBusy(true);
    try {
      await setNutritionGoalCalories(goals.calories);
      await setNutritionGoalProtein(goals.protein);
      setGoalCalories(goals.calories);
      setGoalProtein(goals.protein);
      Alert.alert(
        'Goals updated',
        `Daily goals set to ${goals.calories} kcal and ${goals.protein} g protein.`
      );
    } finally {
      setRecalcBusy(false);
    }
  }

  // ── Backup: export ──────────────────────────────────────────────────────

  async function handleBackupExport() {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      await exportBackup();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Backup failed', message);
    } finally {
      setBackupBusy(false);
    }
  }

  // ── Backup: restore ─────────────────────────────────────────────────────

  function handleBackupRestore() {
    if (backupBusy) return;
    Alert.alert(
      'Restore from backup',
      'This will replace ALL current data with the contents of the backup file. This cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBackupBusy(true);
            try {
              const result = await importBackup();
              if (result === null) {
                // User cancelled the picker — no action needed
                return;
              }
              Alert.alert(
                'Restore complete',
                `Restored ${result.tablesRestored} tables and ${result.rowsRestored} rows. Revisit each screen to see the updated data.`
              );
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Something went wrong.';
              Alert.alert('Restore failed', message);
            } finally {
              setBackupBusy(false);
            }
          },
        },
      ]
    );
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

      {/* ── Your profile section (#281) ─────────────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.sectionLabelRow}>
          <Ionicons name="person-outline" size={16} color={Colors.sageDeep} />
          <Text style={styles.sectionLabel}>Your profile</Text>
        </View>

        <Text style={styles.nutritionSubtitle}>
          Used to compute personalized calorie and protein goals.
        </Text>

        {/* Sex chips */}
        <Text style={styles.profileFieldLabel}>Biological sex</Text>
        <View style={styles.profileChipRow}>
          {(['male', 'female'] as Sex[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.profileChip, profile.sex === s && styles.profileChipSelected]}
              onPress={() => handleProfileSex(s)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={s === 'male' ? 'Male' : 'Female'}
            >
              <Text style={[styles.profileChipLabel, profile.sex === s && styles.profileChipLabelSelected]}>
                {s === 'male' ? 'Male' : 'Female'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Height */}
        <Text style={styles.profileFieldLabel}>Height (cm)</Text>
        <TextInput
          style={styles.profileInput}
          value={profileHeightStr}
          onChangeText={setProfileHeightStr}
          onBlur={handleProfileHeightBlur}
          keyboardType="decimal-pad"
          placeholder="e.g. 178"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Height in centimetres"
          returnKeyType="done"
        />

        {/* Age */}
        <Text style={styles.profileFieldLabel}>Age (years)</Text>
        <TextInput
          style={styles.profileInput}
          value={profileAgeStr}
          onChangeText={setProfileAgeStr}
          onBlur={handleProfileAgeBlur}
          keyboardType="number-pad"
          placeholder="e.g. 30"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Age in years"
          returnKeyType="done"
        />

        {/* Activity level chips */}
        <Text style={styles.profileFieldLabel}>Activity level</Text>
        <View style={styles.profileActivityGrid}>
          {(
            [
              { value: 'sedentary',   label: 'Sedentary' },
              { value: 'light',       label: 'Light' },
              { value: 'moderate',    label: 'Moderate' },
              { value: 'active',      label: 'Active' },
              { value: 'very_active', label: 'Very active' },
            ] as Array<{ value: ActivityLevel; label: string }>
          ).map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.profileActivityChip, profile.activityLevel === opt.value && styles.profileChipSelected]}
              onPress={() => handleProfileActivity(opt.value)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
            >
              <Text style={[styles.profileChipLabel, profile.activityLevel === opt.value && styles.profileChipLabelSelected]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Goal type chips */}
        <Text style={styles.profileFieldLabel}>Goal</Text>
        <View style={styles.profileChipRow}>
          {(
            [
              { value: 'cut',      label: 'Lose weight' },
              { value: 'maintain', label: 'Maintain' },
              { value: 'gain',     label: 'Build muscle' },
            ] as Array<{ value: GoalType; label: string }>
          ).map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.profileChip, profile.goalType === opt.value && styles.profileChipSelected]}
              onPress={() => handleProfileGoal(opt.value)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
            >
              <Text style={[styles.profileChipLabel, profile.goalType === opt.value && styles.profileChipLabelSelected]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sectionDivider} />

        {/* Recalculate button */}
        <TouchableOpacity
          style={[styles.recalcBtn, recalcBusy && styles.backupRowDisabled]}
          onPress={handleRecalcGoals}
          disabled={recalcBusy}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Recalculate nutrition goals from profile"
        >
          {recalcBusy ? (
            <ActivityIndicator size="small" color={Colors.sageDeep} />
          ) : (
            <Ionicons name="calculator-outline" size={16} color={Colors.sageDeep} />
          )}
          <Text style={styles.recalcBtnLabel}>Recalculate goals from profile</Text>
        </TouchableOpacity>
      </Card>

      {/* ── Hydration goal section (#283) ────────────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.sectionLabelRow}>
          <Ionicons name="water-outline" size={16} color={Colors.skyDeep} />
          <Text style={[styles.sectionLabel, styles.sectionLabelHydration]}>Hydration goal</Text>
        </View>

        <Text style={styles.nutritionSubtitle}>
          Daily water intake target shown in the Today card
        </Text>

        <View style={styles.goalStepperRow}>
          <View style={styles.goalStepperLabelBlock}>
            <Text style={styles.goalStepperTitle}>Daily water goal</Text>
            <Text style={styles.goalStepperUnit}>ml / day</Text>
          </View>
          <View style={styles.goalStepperControls}>
            <TouchableOpacity
              style={[styles.goalStepperBtn, styles.goalStepperBtnHydration]}
              onPress={() => adjustHydrationGoal(-HYDRATION_STEP)}
              accessibilityLabel="Decrease hydration goal"
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="remove-outline" size={18} color={Colors.skyDeep} />
            </TouchableOpacity>
            <Text style={styles.goalStepperValue}>{hydrationGoalMl}</Text>
            <TouchableOpacity
              style={[styles.goalStepperBtn, styles.goalStepperBtnHydration]}
              onPress={() => adjustHydrationGoal(HYDRATION_STEP)}
              accessibilityLabel="Increase hydration goal"
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="add-outline" size={18} color={Colors.skyDeep} />
            </TouchableOpacity>
          </View>
        </View>
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

      {/* ── Data & backup section (#277) ──────────────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.sectionLabelRow}>
          <Ionicons name="save-outline" size={16} color={Colors.skyDeep} />
          <Text style={[styles.sectionLabel, styles.sectionLabelBackup]}>Data &amp; backup</Text>
        </View>

        <Text style={styles.backupSubtitle}>
          Save a copy of all your data to Files, iCloud, or Drive.
        </Text>

        {/* Back up data */}
        <TouchableOpacity
          style={[styles.backupRow, backupBusy && styles.backupRowDisabled]}
          onPress={handleBackupExport}
          disabled={backupBusy}
          accessibilityLabel="Back up data"
          accessibilityRole="button"
          activeOpacity={0.7}
        >
          <View style={styles.backupIconChip}>
            <Ionicons name="cloud-upload-outline" size={18} color={Colors.skyDeep} />
          </View>
          <View style={styles.backupTextBlock}>
            <Text style={styles.backupRowTitle}>Back up data</Text>
            <Text style={styles.backupRowSubtitle}>
              Export all your data to a JSON file
            </Text>
          </View>
          <Ionicons name="chevron-forward-outline" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.sectionDivider} />

        {/* Restore from backup */}
        <TouchableOpacity
          style={[styles.backupRow, backupBusy && styles.backupRowDisabled]}
          onPress={handleBackupRestore}
          disabled={backupBusy}
          accessibilityLabel="Restore from backup"
          accessibilityRole="button"
          activeOpacity={0.7}
        >
          <View style={[styles.backupIconChip, styles.backupIconChipRestore]}>
            <Ionicons name="cloud-download-outline" size={18} color={Colors.clayDeep} />
          </View>
          <View style={styles.backupTextBlock}>
            <Text style={styles.backupRowTitle}>Restore from backup</Text>
            <Text style={styles.backupRowSubtitle}>
              Replace all data from a backup file
            </Text>
          </View>
          <Ionicons name="chevron-forward-outline" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
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

  // Hydration section overrides (#283)
  sectionLabelHydration: {
    color: Colors.skyDeep,
  },
  goalStepperBtnHydration: {
    backgroundColor: Colors.skyTint,
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

  // Data & backup section
  sectionLabelBackup: {
    color: Colors.skyDeep,
  },
  backupSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: Typography.sizes.xs * 1.5,
  },
  backupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  backupRowDisabled: {
    opacity: 0.5,
  },
  backupIconChip: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupIconChipRestore: {
    backgroundColor: Colors.clayTint,
  },
  backupTextBlock: {
    flex: 1,
  },
  backupRowTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  backupRowSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },

  // ── Profile section (#281) ──────────────────────────────────────────────
  profileFieldLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  profileChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  profileChip: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 80,
  },
  profileChipSelected: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.sage,
  },
  profileChipLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  profileChipLabelSelected: {
    color: Colors.sageDeep,
    fontFamily: Typography.title,
  },
  profileActivityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  profileActivityChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  profileInput: {
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
  recalcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  recalcBtnLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
  },
});
