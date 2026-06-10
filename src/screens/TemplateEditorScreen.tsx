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
import { Ionicons } from '@expo/vector-icons';
import {
  WeeklyTemplateDay,
  Exercise,
  getWeeklyTemplate,
  updateTemplateDay,
  updateTemplateExercises,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { Card, IconChip, Pill, Button, ScreenHeader, Row } from '../components';

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
            <Button
              title="Cancel"
              variant="ghost"
              onPress={onClose}
              style={{ flex: 1 }}
            />
            <Button
              title={initial ? 'Save Changes' : 'Add Exercise'}
              variant="primary"
              onPress={handleSave}
              style={{ flex: 1 }}
            />
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
  const meta = `${exercise.sets}×${exercise.reps}${exercise.videoUrl ? '  · Video' : ''}`;
  return (
    <Row
      title={exercise.name}
      subtitle={meta}
      style={styles.exRow}
      trailing={
        <View style={styles.exActions}>
          <TouchableOpacity
            style={styles.exEditBtn}
            onPress={onEdit}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="create-outline" size={16} color={Colors.sageDeep} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.exDeleteBtn}
            onPress={onDelete}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.exDeleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      }
    />
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

  // Accent family: rest = sky, meal-prep = clay, normal = sage
  const chipAccent = day.is_rest_day ? 'sky' : day.is_meal_prep_day ? 'clay' : 'sage';

  const chipTextColor = day.is_rest_day
    ? Colors.skyDeep
    : day.is_meal_prep_day
    ? Colors.clayDeep
    : Colors.sageDeep;

  return (
    <Card style={styles.card}>
      {/* Day header */}
      <View style={styles.cardHeader}>
        <IconChip
          icon={
            <Text style={[styles.dayChipText, { color: chipTextColor }]}>
              {DAY_SHORT[day.day_of_week]}
            </Text>
          }
          accent={chipAccent}
          size={48}
        />
        <View style={styles.cardHeaderInfo}>
          <Text style={styles.dayLabel}>{DAY_LABELS[day.day_of_week]}</Text>
          <View style={styles.tagRow}>
            {day.is_rest_day && (
              <Pill label="Rest Day" accent="sky" />
            )}
            {day.is_meal_prep_day && (
              <Pill label="Meal Prep" accent="clay" />
            )}
          </View>
        </View>
      </View>

      {/* Walking Task */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>WALKING TASK</Text>
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
        <Text style={styles.fieldLabel}>HAMMER TASK (base label)</Text>
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
        <Button
          title={saving ? 'Saving…' : 'Save label changes'}
          variant="primary"
          onPress={handleSave}
          disabled={saving}
          style={styles.saveLabelBtn}
        />
      )}

      {saved && !isDirty && (
        <Text style={styles.savedConfirm}>✓ Saved — future days will use this template</Text>
      )}

      {/* ── Exercises ────────────────────────────────────────────────── */}
      <View style={styles.exSection}>
        <View style={styles.exSectionHeader}>
          <Text style={styles.fieldLabel}>EXERCISES ({exercises.length})</Text>
          <Button
            title="+ Add"
            variant="ghost"
            onPress={openAddModal}
            style={styles.addExBtn}
          />
        </View>

        {exercises.length === 0 ? (
          <Text style={styles.noExHint}>No exercises yet. Tap + Add to create one.</Text>
        ) : (
          <View style={styles.exList}>
            {exercises.map((ex, idx) => (
              <React.Fragment key={ex.id}>
                <ExerciseItem
                  exercise={ex}
                  onEdit={() => openEditModal(ex)}
                  onDelete={() => handleDeleteExercise(ex.id)}
                />
                {idx < exercises.length - 1 && (
                  <View style={styles.exDivider} />
                )}
              </React.Fragment>
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
    </Card>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TemplateEditorScreen() {
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
        <ActivityIndicator size="large" color={Colors.sage} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Template Editor"
        subtitle="Edit the base weekly schedule. Changes apply to all future generated days."
        style={styles.screenHeader}
      />

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
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas },
  centred: {
    flex: 1, backgroundColor: Colors.canvas,
    alignItems: 'center', justifyContent: 'center',
  },

  // Screen header
  screenHeader: {
    paddingTop: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.lg },

  // Card — uses shared Card component, override just gap/padding additions
  card: {
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  dayChipText: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.black,
    letterSpacing: 0.8,
    color: Colors.sageDeep, // overridden per card but text inherits from parent for rest/clay/sage
  },
  cardHeaderInfo: { flex: 1 },
  dayLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
  },
  tagRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },

  // Fields
  fieldGroup: { gap: Spacing.xs },
  fieldRow: { flexDirection: 'row', gap: Spacing.sm },
  fieldLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  inputHint: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 16,
  },

  // Save-label button
  saveLabelBtn: {
    marginTop: Spacing.xs,
  },
  savedConfirm: {
    fontFamily: Typography.body,
    color: Colors.sageDeep,
    fontSize: Typography.sizes.xs,
    textAlign: 'center',
    fontWeight: Typography.weights.medium,
  },

  // Exercise section
  exSection: { gap: Spacing.sm, marginTop: Spacing.xs },
  exSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addExBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    minHeight: 34,
  },
  noExHint: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  exList: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  exRow: {
    borderRadius: 0,
    backgroundColor: Colors.surface,
  },
  exDivider: {
    height: 1,
    backgroundColor: Colors.line,
    marginHorizontal: Spacing.lg,
  },

  // Exercise item trailing actions
  exActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'center',
  },
  exEditBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
  },
  exDeleteBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.canvasSunken,
    borderRadius: Radius.sm,
  },
  exDeleteBtnText: {
    fontSize: Typography.sizes.sm,
    color: Colors.danger,
    fontWeight: Typography.weights.bold,
  },

  // Exercise modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(44,53,46,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  modalHandle: {
    width: 40, height: 4,
    backgroundColor: Colors.line2,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  modalTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.4,
  },
  modalFields: { gap: Spacing.md },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
});
