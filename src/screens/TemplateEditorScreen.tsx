import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  WeeklyTemplateDay,
  getWeeklyTemplate,
  updateTemplateDay,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Day label map ────────────────────────────────────────────────────────────

const DAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  0: 'Sunday',
};

const DAY_SHORT: Record<number, string> = {
  1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 0: 'SUN',
};

// ─── Single editiable day card ────────────────────────────────────────────────

interface TemplateCardProps {
  day: WeeklyTemplateDay;
  onSave: (dayOfWeek: number, walk: string, hammer: string) => Promise<void>;
}

function TemplateCard({ day, onSave }: TemplateCardProps) {
  const [walk, setWalk] = useState(day.walking_task);
  const [hammer, setHammer] = useState(day.hammer_task);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = walk !== day.walking_task || hammer !== day.hammer_task;

  const handleSave = async () => {
    if (!walk.trim() || !hammer.trim()) {
      Alert.alert('Validation', 'Walking task and hammer task cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await onSave(day.day_of_week, walk.trim(), hammer.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to save template day.');
    } finally {
      setSaving(false);
    }
  };

  const accentColor = day.is_rest_day
    ? Colors.textMuted
    : day.is_meal_prep_day
    ? Colors.accent
    : Colors.secondary;

  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      {/* Day header */}
      <View style={styles.cardHeader}>
        <View style={[styles.dayBadge, { backgroundColor: accentColor + '20' }]}>
          <Text style={[styles.dayBadgeText, { color: accentColor }]}>
            {DAY_SHORT[day.day_of_week]}
          </Text>
        </View>
        <View style={styles.cardHeaderInfo}>
          <Text style={styles.dayLabel}>{DAY_LABELS[day.day_of_week]}</Text>
          <View style={styles.tagRow}>
            {day.is_rest_day && (
              <Text style={styles.tagRest}>💤 Rest Day</Text>
            )}
            {day.is_meal_prep_day && (
              <Text style={styles.tagMealPrep}>🥗 Meal Prep</Text>
            )}
          </View>
        </View>
      </View>

      {/* Walking Task */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>🚶 WALKING TASK</Text>
        <TextInput
          style={styles.input}
          value={walk}
          onChangeText={setWalk}
          multiline
          placeholder="Enter walking task…"
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      {/* Hammer Task (base — no weight suffix shown here) */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>🏋️ HAMMER TASK (base)</Text>
        <TextInput
          style={styles.input}
          value={hammer}
          onChangeText={setHammer}
          multiline
          placeholder="Enter hammer / gym task…"
          placeholderTextColor={Colors.textMuted}
        />
        <Text style={styles.inputHint}>
          Weight suffix (@ Baseline + Xkg) is appended automatically based on the
          21-day progression cycle.
        </Text>
      </View>

      {/* Save button */}
      {isDirty && (
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.background} />
          ) : (
            <Text style={styles.saveBtnText}>Save changes</Text>
          )}
        </TouchableOpacity>
      )}

      {saved && !isDirty && (
        <Text style={styles.savedConfirm}>✓ Saved — future days will use this template</Text>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TemplateEditorScreen() {
  const insets = useSafeAreaInsets();
  const [template, setTemplate] = useState<WeeklyTemplateDay[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getWeeklyTemplate();
      setTemplate(rows);
    } catch (err) {
      console.error('TemplateEditorScreen: load error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  const handleSave = useCallback(
    async (dayOfWeek: number, walk: string, hammer: string) => {
      await updateTemplateDay(dayOfWeek, walk, hammer);
      // Refresh local state so unchanged cards reflect the updated value
      setTemplate((prev) =>
        prev.map((d) =>
          d.day_of_week === dayOfWeek
            ? { ...d, walking_task: walk, hammer_task: hammer }
            : d
        )
      );
    },
    []
  );

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Template Editor</Text>
        <Text style={styles.headerSubtitle}>
          Edit the base weekly schedule. Changes apply to all future generated days.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {template.map((day) => (
          <TemplateCard key={day.day_of_week} day={day} onSave={handleSave} />
        ))}
        <View style={{ height: 32 }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  },

  // Header
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 4,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  // Card
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    borderLeftWidth: 3,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: 4,
  },
  dayBadge: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.black,
    letterSpacing: 1,
  },
  cardHeaderInfo: { flex: 1 },
  dayLabel: {
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  tagRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: 2 },
  tagRest: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.medium,
  },
  tagMealPrep: {
    fontSize: Typography.sizes.xs,
    color: Colors.accent,
    fontWeight: Typography.weights.medium,
  },

  // Field
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  inputHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 16,
  },

  // Save button
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm + 2,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    color: Colors.background,
    fontWeight: Typography.weights.bold,
    fontSize: Typography.sizes.sm,
  },
  savedConfirm: {
    color: Colors.accent,
    fontSize: Typography.sizes.xs,
    textAlign: 'center',
    fontWeight: Typography.weights.medium,
  },
});
