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

  // Load persisted settings on focus (same pattern as other screens using useFocusEffect)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const enabled = await getWorkoutReminderEnabled();
        const time = await getWorkoutReminderTime();
        if (active) {
          setReminder((prev) => ({ ...prev, enabled, time, permissionDenied: false }));
        }
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Toggle ──────────────────────────────────────────────────────────────

  async function handleToggle(value: boolean) {
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

  // ── Time adjustments ────────────────────────────────────────────────────

  async function adjustTime(hourDelta: number, minuteDelta: number) {
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

  const { hour, minute } = parseTimeString(reminder.time);

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
            onValueChange={handleToggle}
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
                value={String(hour).padStart(2, '0')}
                onDecrement={() => adjustTime(-1, 0)}
                onIncrement={() => adjustTime(1, 0)}
              />
              <Text style={styles.timeSeparator}>:</Text>
              <TimeStepper
                label="Minute"
                value={String(minute).padStart(2, '0')}
                onDecrement={() => adjustTime(0, -1)}
                onIncrement={() => adjustTime(0, 1)}
              />
            </View>
            <Text style={styles.timePreview}>
              Reminder set for {formatTimeString(hour, minute)}
            </Text>
          </View>
        )}
      </Card>

      {/*
       * ── Unit 3b placeholder ───────────────────────────────────────────
       * Add a cooking-reminder Card here with the same toggle + time-stepper
       * pattern. Keys: cookingReminderEnabled / cookingReminderTime.
       */}
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
});
