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
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  WeeklyTemplateDay,
  Exercise,
  getWeeklyTemplate,
  updateTemplateDay,
  updateTemplateExercises,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Day label maps ───────────────────────────────────────────────────────────

const DAY_LABELS: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
  5: 'Friday', 6: 'Saturday', 0: 'Sunday',
};

const DAY_SHORT: Record<number, string> = {
  1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 0: 'SUN',
};

// ─── Exercise Edit Modal ──────────────────────────────────────────────────────

interface ExerciseModalProps {
  visible: boolean;
  initial: Exercise | null; // null = adding new
  onSave: (ex: Exercise) => void;
  onClose: () => void;
}

function ExerciseModal({ visible, initial, onSave, onClose }: ExerciseModalProps) {
  const [name, setName] = useState('');
  const [sets, setSets] = useState('3');
  const [reps, setReps] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  // Sync form when the modal opens
  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? '');
      setSets(initial?.sets ?? '3');
      setReps(initial?.reps ?? '');
      setVideoUrl(initial?.videoUrl ?? '');
    }
  }, [visible, initial]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Exercise name cannot be empty.');
      return;
    }
    const ex: Exercise = {
      id: initial?.id ?? `ex-${Date.now()}`,
      name: name.trim(),
      sets: sets.trim() || '3',
      reps: reps.trim(),
      videoUrl: videoUrl.trim(),
      completed: false,
    };
    onSave(ex);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>
            {initial ? 'Edit Exercise' : 'Add Exercise'}
          </Text>

          <View style={styles.modalFields}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>NAME</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Chest Press"
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>SETS</Text>
                <TextInput
                  style={styles.input}
                  value={sets}
                  onChangeText={setSets}
                  keyboardType="numeric"
                  placeholder="3"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 2 }]}>
                <Text style={styles.fieldLabel}>REPS / DURATION</Text>
                <TextInput
                  style={styles.input}
                  value={reps}
                  onChangeText={setReps}
                  placeholder="e.g. 8-10 or 45 min"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>YOUTUBE URL (optional)</Text>
              <TextInput
                style={styles.input}
                value={videoUrl}
                onChangeText={setVideoUrl}
                placeholder="https://youtube.com/watch?v=…"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>
                {initial ? 'Save Changes' : 'Add Exercise'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Single Exercises List Item ───────────────────────────────────────────────

function ExerciseItem({
  exercise,
  onEdit,
  onDelete,
}: {
  exercise: Exercise;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.exItem}>
      <View style={styles.exItemInfo}>
        <Text style={styles.exItemName}>{exercise.name}</Text>
        <Text style={styles.exItemMeta}>
          {exercise.sets}×{exercise.reps}
          {exercise.videoUrl ? '  · 📹 Video' : ''}
        </Text>
      </View>
      <TouchableOpacity style={styles.exEditBtn} onPress={onEdit}>
        <Text style={styles.exEditBtnText}>✏️</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.exDeleteBtn} onPress={onDelete}>
        <Text style={styles.exDeleteBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Single editable day card ─────────────────────────────────────────────────

interface TemplateCardProps {
  day: WeeklyTemplateDay;
  onSave: (dayOfWeek: number, walk: string, hammer: string) => Promise<void>;
  onExercisesChange: (dayOfWeek: number, exercises: Exercise[]) => Promise<void>;
}

function TemplateCard({ day, onSave, onExercisesChange }: TemplateCardProps) {
  const [walk, setWalk] = useState(day.walking_task);
  const [hammer, setHammer] = useState(day.hammer_task);
  const [exercises, setExercises] = useState<Exercise[]>(day.exercises);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Exercise modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

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

  const openAddModal = () => {
    setEditingExercise(null);
    setModalVisible(true);
  };

  const openEditModal = (ex: Exercise) => {
    setEditingExercise(ex);
    setModalVisible(true);
  };

  const handleExerciseSave = async (ex: Exercise) => {
    let updated: Exercise[];
    if (editingExercise) {
      updated = exercises.map((e) => (e.id === ex.id ? ex : e));
    } else {
      updated = [...exercises, ex];
    }
    setExercises(updated);
    setModalVisible(false);
    try {
      await onExercisesChange(day.day_of_week, updated);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to save exercises.');
    }
  };

  const handleDeleteExercise = (id: string) => {
    Alert.alert('Delete Exercise', 'Remove this exercise from the template?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const updated = exercises.filter((e) => e.id !== id);
          setExercises(updated);
          try {
            await onExercisesChange(day.day_of_week, updated);
          } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Failed to delete exercise.');
          }
        },
      },
    ]);
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
            {day.is_rest_day && <Text style={styles.tagRest}>💤 Rest Day</Text>}
            {day.is_meal_prep_day && <Text style={styles.tagMealPrep}>🥗 Meal Prep</Text>}
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

      {/* Hammer Task label */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>🏋️ HAMMER TASK (base label)</Text>
        <TextInput
          style={styles.input}
          value={hammer}
          onChangeText={setHammer}
          multiline
          placeholder="Enter hammer / gym task label…"
          placeholderTextColor={Colors.textMuted}
        />
        <Text style={styles.inputHint}>
          Weight suffix (@ Baseline + Xkg) is appended automatically based on the
          21-day progression cycle.
        </Text>
      </View>

      {/* Save button for walk/hammer label edits */}
      {isDirty && (
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.background} />
          ) : (
            <Text style={styles.saveBtnText}>Save label changes</Text>
          )}
        </TouchableOpacity>
      )}

      {saved && !isDirty && (
        <Text style={styles.savedConfirm}>✓ Saved — future days will use this template</Text>
      )}

      {/* ── Exercises ────────────────────────────────────────────────── */}
      <View style={styles.exSection}>
        <View style={styles.exSectionHeader}>
          <Text style={styles.fieldLabel}>💪 EXERCISES ({exercises.length})</Text>
          <TouchableOpacity style={styles.addExBtn} onPress={openAddModal}>
            <Text style={styles.addExBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {exercises.length === 0 ? (
          <Text style={styles.noExHint}>No exercises yet. Tap + Add to create one.</Text>
        ) : (
          <View style={styles.exList}>
            {exercises.map((ex) => (
              <ExerciseItem
                key={ex.id}
                exercise={ex}
                onEdit={() => openEditModal(ex)}
                onDelete={() => handleDeleteExercise(ex.id)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Exercise modal */}
      <ExerciseModal
        visible={modalVisible}
        initial={editingExercise}
        onSave={handleExerciseSave}
        onClose={() => setModalVisible(false)}
      />
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

  const handleExercisesChange = useCallback(
    async (dayOfWeek: number, exercises: Exercise[]) => {
      await updateTemplateExercises(dayOfWeek, exercises);
      setTemplate((prev) =>
        prev.map((d) =>
          d.day_of_week === dayOfWeek ? { ...d, exercises } : d
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
          <TemplateCard
            key={day.day_of_week}
            day={day}
            onSave={handleSave}
            onExercisesChange={handleExercisesChange}
          />
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
    flex: 1, backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
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
  scrollContent: { padding: Spacing.lg, gap: Spacing.md },

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
    width: 48, height: 48,
    borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center',
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

  // Fields
  fieldGroup: { gap: 6 },
  fieldRow: { flexDirection: 'row', gap: Spacing.sm },
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
    minHeight: 42,
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

  // Exercise section
  exSection: { gap: Spacing.sm, marginTop: 4 },
  exSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addExBtn: {
    backgroundColor: Colors.secondary + '25',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.secondary + '60',
  },
  addExBtnText: {
    color: Colors.secondary,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  noExHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  exList: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Exercise item
  exItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  exItemInfo: { flex: 1, gap: 1 },
  exItemName: {
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  exItemMeta: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },
  exEditBtn: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
  },
  exEditBtnText: { fontSize: 16 },
  exDeleteBtn: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.danger + '18', borderRadius: Radius.sm,
  },
  exDeleteBtnText: {
    fontSize: Typography.sizes.sm,
    color: Colors.danger,
    fontWeight: Typography.weights.bold,
  },

  // Exercise modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 32,
    gap: Spacing.md,
  },
  modalHandle: {
    width: 40, height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  modalTitle: {
    fontSize: Typography.sizes.lg,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  modalFields: { gap: Spacing.md },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    color: Colors.textSecondary,
    fontWeight: Typography.weights.semibold,
    fontSize: Typography.sizes.sm,
  },
});
