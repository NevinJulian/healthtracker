/**
 * OnboardingScreen — First-launch personalized nutrition profile.
 *
 * Shown instead of the navigator when onboardingComplete is false.
 * Renders OUTSIDE the drawer navigator, so it handles its own safe-area
 * top inset via useSafeAreaInsets (unlike normal screens where the nav
 * header owns top padding).
 *
 * Flow:
 *   Step 1 — Collect height, age, sex
 *   Step 2 — Collect activity level + goal type
 *   Step 3 — Collect current weight, show computed goals, confirm
 *
 * Skippable at any step: sets onboardingComplete = true, leaves default
 * goals untouched. Non-destructive for existing users.
 *
 * Styling: Verdure tokens only. Outline Ionicons only. No raw hex. No emoji.
 *
 * Issue #281 — Personalized nutrition goals + onboarding flow.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  setProfileHeightCm,
  setProfileAge,
  setProfileSex,
  setProfileActivityLevel,
  setProfileGoalType,
  setOnboardingComplete,
  setNutritionGoalCalories,
  setNutritionGoalProtein,
  upsertBodyWeight,
  toISODate,
  type Sex,
  type ActivityLevel,
  type GoalType,
} from '../db/database';
import { suggestGoals, type UserProfile } from '../nutrition/tdee';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Types / constants
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the flow is complete (both "Get started" and "Skip"). */
  onComplete: () => void;
  /** Latest body weight pre-fetched from DB, used to prefill the weight field. */
  latestWeight?: number | null;
}

const ACTIVITY_OPTIONS: Array<{ value: ActivityLevel; label: string; description: string }> = [
  { value: 'sedentary',   label: 'Sedentary',   description: 'Little or no exercise' },
  { value: 'light',       label: 'Light',       description: 'Light exercise 1–3 days/week' },
  { value: 'moderate',    label: 'Moderate',    description: 'Exercise 3–5 days/week' },
  { value: 'active',      label: 'Active',      description: 'Hard exercise 6–7 days/week' },
  { value: 'very_active', label: 'Very active', description: 'Physical job or twice-daily training' },
];

const GOAL_OPTIONS: Array<{ value: GoalType; label: string; description: string }> = [
  { value: 'cut',      label: 'Lose weight',    description: '−500 kcal/day deficit' },
  { value: 'maintain', label: 'Maintain',       description: 'Eat at your TDEE' },
  { value: 'gain',     label: 'Build muscle',   description: '+300 kcal/day surplus' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable primitives
// ─────────────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

interface OptionChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

function OptionChip({ label, selected, onPress, accessibilityLabel }: OptionChipProps) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

interface OptionRowProps {
  label: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}

function OptionRow({ label, description, selected, onPress }: OptionRowProps) {
  return (
    <TouchableOpacity
      style={[styles.optionRow, selected && styles.optionRowSelected]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.optionRowText}>
        <Text style={[styles.optionRowLabel, selected && styles.optionRowLabelSelected]}>
          {label}
        </Text>
        <Text style={[styles.optionRowDesc, selected && styles.optionRowDescSelected]}>
          {description}
        </Text>
      </View>
      {selected && (
        <Ionicons name="checkmark-circle" size={20} color={Colors.sageDeep} />
      )}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete, latestWeight }: Props) {
  const insets = useSafeAreaInsets();

  // Form state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sex, setSexState] = useState<Sex | null>(null);
  const [heightStr, setHeightStr] = useState('');
  const [ageStr, setAgeStr] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(null);
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [weightStr, setWeightStr] = useState(
    latestWeight != null ? String(latestWeight) : ''
  );

  // Async action state
  const [saving, setSaving] = useState(false);

  // ── Computed goals (step 3 preview) ──────────────────────────────────────

  const heightNum = parseFloat(heightStr);
  const ageNum    = parseFloat(ageStr);
  const weightNum = parseFloat(weightStr);

  const profileReady =
    sex !== null &&
    Number.isFinite(heightNum) && heightNum > 0 &&
    Number.isFinite(ageNum)    && ageNum > 0 &&
    activityLevel !== null &&
    goalType !== null &&
    Number.isFinite(weightNum) && weightNum > 0;

  const computedGoals =
    profileReady
      ? suggestGoals(
          {
            sex: sex!,
            age: ageNum,
            heightCm: heightNum,
            activityLevel: activityLevel!,
            goalType: goalType!,
          } as UserProfile,
          weightNum
        )
      : null;

  // ── Navigation helpers ────────────────────────────────────────────────────

  function canAdvanceStep1(): boolean {
    return (
      sex !== null &&
      Number.isFinite(parseFloat(heightStr)) && parseFloat(heightStr) > 0 &&
      Number.isFinite(parseFloat(ageStr)) && parseFloat(ageStr) > 0
    );
  }

  function canAdvanceStep2(): boolean {
    return activityLevel !== null && goalType !== null;
  }

  // ── Skip (non-destructive) ────────────────────────────────────────────────

  async function handleSkip() {
    setSaving(true);
    try {
      await setOnboardingComplete(true);
      onComplete();
    } finally {
      setSaving(false);
    }
  }

  // ── Confirm + save ────────────────────────────────────────────────────────

  async function handleConfirm() {
    if (!profileReady || !computedGoals) return;
    setSaving(true);
    try {
      // Persist profile fields
      await Promise.all([
        setProfileHeightCm(heightNum),
        setProfileAge(ageNum),
        setProfileSex(sex!),
        setProfileActivityLevel(activityLevel!),
        setProfileGoalType(goalType!),
      ]);

      // Write suggested goals into the nutrition goal settings
      await setNutritionGoalCalories(computedGoals.calories);
      await setNutritionGoalProtein(computedGoals.protein);

      // Write today's body weight if not already logged
      if (Number.isFinite(weightNum) && weightNum > 0) {
        await upsertBodyWeight(toISODate(), weightNum);
      }

      await setOnboardingComplete(true);
      onComplete();
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <View style={styles.headerBlock}>
          <Text style={styles.headline}>Your profile</Text>
          <Text style={styles.subheadline}>
            We'll compute your daily calorie and protein targets. You can always change
            them later in Settings.
          </Text>

          {/* Step indicator */}
          <View style={styles.stepRow}>
            {([1, 2, 3] as const).map((s) => (
              <View
                key={s}
                style={[styles.stepDot, s === step && styles.stepDotActive, s < step && styles.stepDotDone]}
              />
            ))}
          </View>
        </View>

        {/* ── Step 1: Height / Age / Sex ─────────────────────────────── */}
        {step === 1 && (
          <View style={styles.stepBlock}>
            {/* Sex */}
            <SectionLabel>Biological sex</SectionLabel>
            <View style={styles.chipRow}>
              <OptionChip
                label="Male"
                selected={sex === 'male'}
                onPress={() => setSexState('male')}
              />
              <OptionChip
                label="Female"
                selected={sex === 'female'}
                onPress={() => setSexState('female')}
              />
            </View>

            {/* Height */}
            <SectionLabel>Height (cm)</SectionLabel>
            <TextInput
              style={styles.textInput}
              value={heightStr}
              onChangeText={setHeightStr}
              keyboardType="decimal-pad"
              placeholder="e.g. 178"
              placeholderTextColor={Colors.textMuted}
              accessibilityLabel="Height in centimetres"
              returnKeyType="done"
            />

            {/* Age */}
            <SectionLabel>Age (years)</SectionLabel>
            <TextInput
              style={styles.textInput}
              value={ageStr}
              onChangeText={setAgeStr}
              keyboardType="number-pad"
              placeholder="e.g. 30"
              placeholderTextColor={Colors.textMuted}
              accessibilityLabel="Age in years"
              returnKeyType="done"
            />

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleSkip}
                disabled={saving}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Skip onboarding"
              >
                <Text style={styles.skipLabel}>Skip for now</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, !canAdvanceStep1() && styles.primaryBtnDisabled]}
                onPress={() => setStep(2)}
                disabled={!canAdvanceStep1() || saving}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Continue to step 2"
              >
                <Text style={styles.primaryBtnLabel}>Continue</Text>
                <Ionicons name="arrow-forward-outline" size={16} color={Colors.textOnAccent} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 2: Activity + Goal ─────────────────────────────────── */}
        {step === 2 && (
          <View style={styles.stepBlock}>
            {/* Activity level */}
            <SectionLabel>Activity level</SectionLabel>
            {ACTIVITY_OPTIONS.map((opt) => (
              <OptionRow
                key={opt.value}
                label={opt.label}
                description={opt.description}
                selected={activityLevel === opt.value}
                onPress={() => setActivityLevel(opt.value)}
              />
            ))}

            {/* Goal */}
            <SectionLabel>Your goal</SectionLabel>
            {GOAL_OPTIONS.map((opt) => (
              <OptionRow
                key={opt.value}
                label={opt.label}
                description={opt.description}
                selected={goalType === opt.value}
                onPress={() => setGoalType(opt.value)}
              />
            ))}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setStep(1)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Back to step 1"
              >
                <Ionicons name="arrow-back-outline" size={16} color={Colors.sageDeep} />
                <Text style={styles.backLabel}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, !canAdvanceStep2() && styles.primaryBtnDisabled]}
                onPress={() => setStep(3)}
                disabled={!canAdvanceStep2() || saving}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Continue to step 3"
              >
                <Text style={styles.primaryBtnLabel}>Continue</Text>
                <Ionicons name="arrow-forward-outline" size={16} color={Colors.textOnAccent} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 3: Weight + Preview ────────────────────────────────── */}
        {step === 3 && (
          <View style={styles.stepBlock}>
            {/* Weight input */}
            <SectionLabel>Current weight (kg)</SectionLabel>
            <TextInput
              style={styles.textInput}
              value={weightStr}
              onChangeText={setWeightStr}
              keyboardType="decimal-pad"
              placeholder="e.g. 82.5"
              placeholderTextColor={Colors.textMuted}
              accessibilityLabel="Body weight in kilograms"
              returnKeyType="done"
            />

            {/* Computed goals preview */}
            {computedGoals != null && (
              <View style={styles.previewCard}>
                <View style={styles.previewLabelRow}>
                  <Ionicons name="calculator-outline" size={16} color={Colors.sageDeep} />
                  <Text style={styles.previewCardLabel}>Your suggested goals</Text>
                </View>

                <View style={styles.previewRow}>
                  <View style={styles.previewItem}>
                    <Text style={styles.previewValue}>{computedGoals.calories}</Text>
                    <Text style={styles.previewUnit}>kcal / day</Text>
                  </View>
                  <View style={styles.previewDivider} />
                  <View style={styles.previewItem}>
                    <Text style={styles.previewValue}>{computedGoals.protein}</Text>
                    <Text style={styles.previewUnit}>g protein / day</Text>
                  </View>
                </View>

                <Text style={styles.previewNote}>
                  These will be set as your daily goals. You can adjust them any time in
                  Settings under Nutrition goals.
                </Text>
              </View>
            )}

            {!profileReady && (
              <View style={styles.noticeRow}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.clayDeep} />
                <Text style={styles.noticeText}>
                  Enter your weight above to see your suggested goals.
                </Text>
              </View>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setStep(2)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Back to step 2"
              >
                <Ionicons name="arrow-back-outline" size={16} color={Colors.sageDeep} />
                <Text style={styles.backLabel}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, (!profileReady || saving) && styles.primaryBtnDisabled]}
                onPress={handleConfirm}
                disabled={!profileReady || saving}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Confirm and get started"
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.textOnAccent} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnLabel}>Get started</Text>
                    <Ionicons name="checkmark-outline" size={16} color={Colors.textOnAccent} />
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Skip option also available on last step */}
            <TouchableOpacity
              style={styles.skipBtnCenter}
              onPress={handleSkip}
              disabled={saving}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Skip and use default goals"
            >
              <Text style={styles.skipLabelCenter}>Skip and use default goals</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },

  // Header block
  headerBlock: {
    marginBottom: Spacing.xl,
  },
  headline: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xxl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  subheadline: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.sm * 1.5,
    marginBottom: Spacing.lg,
  },

  // Step dots
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.canvasSunken,
  },
  stepDotActive: {
    backgroundColor: Colors.sage,
    width: 24,
  },
  stepDotDone: {
    backgroundColor: Colors.sageTint,
  },

  // Step block
  stepBlock: {
    gap: Spacing.md,
  },

  // Section label
  sectionLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.md,
  },

  // Chip row (sex selection)
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  chip: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.sage,
  },
  chipLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },
  chipLabelSelected: {
    color: Colors.sageDeep,
  },

  // Text input
  textInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line2,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
  },

  // Option row (activity/goal selection)
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  optionRowSelected: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.sage,
  },
  optionRowText: {
    flex: 1,
  },
  optionRowLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  optionRowLabelSelected: {
    color: Colors.sageDeep,
  },
  optionRowDesc: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  optionRowDescSelected: {
    color: Colors.sageDeep,
  },

  // Preview card (step 3)
  previewCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.sageTint,
  },
  previewLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  previewCardLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  previewItem: {
    flex: 1,
    alignItems: 'center',
  },
  previewValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xxl,
    color: Colors.sageDeep,
    letterSpacing: -0.5,
  },
  previewUnit: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  previewDivider: {
    width: 1,
    height: 48,
    backgroundColor: Colors.line,
  },
  previewNote: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.xs * 1.5,
  },

  // Notice row
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.clayDeep,
    lineHeight: Typography.sizes.xs * 1.5,
  },

  // Action row (buttons)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    gap: Spacing.md,
  },

  // Primary CTA button
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.sage,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textOnAccent,
  },

  // Back button
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  backLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
  },

  // Skip button (inline)
  skipBtn: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  skipLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },

  // Skip button (centered, step 3)
  skipBtnCenter: {
    alignSelf: 'center',
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  skipLabelCenter: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
});
