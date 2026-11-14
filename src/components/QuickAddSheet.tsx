import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addFoodLogEntry,
  deleteFoodLogEntry,
  getFoodLogForDate,
  updateFoodLogEntry,
  type FoodLogEntry,
} from '../db/database';
import { addDays } from '../utils/dates';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';
import Button from './Button';
import {
  formatEntrySummary,
  validateQuickAdd,
  type QuickAddField,
  type QuickAddFields,
} from './quickAddInput';

const DAYS_BACK = 6;
const BACKDROP_OPACITY = 0.45;
const SHEET_MAX_HEIGHT = '92%';
const EMPTY_FIELDS: QuickAddFields = { label: '', calories: '', protein: '', carbs: '', fat: '' };

export interface QuickAddSheetProps {
  visible: boolean;
  /** Local YYYY-MM-DD of today; the chips count back from it. */
  today: string;
  /** Entry to load into the form when the sheet opens, or null for an empty form. */
  entry: FoodLogEntry | null;
  onClose: () => void;
  /** Called after an entry was added, updated or deleted. */
  onChanged: () => void;
}

function fieldsFromEntry(entry: FoodLogEntry): QuickAddFields {
  return {
    label: entry.label ?? '',
    calories: String(entry.calories),
    protein: String(entry.protein),
    carbs: String(entry.carbs),
    fat: String(entry.fat),
  };
}

function chipLabel(date: string, index: number): string {
  if (index === 0) return 'Today';
  if (index === 1) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

const FIELD_LABELS: Record<QuickAddField, string> = {
  label: 'Label (optional)',
  calories: 'Calories (kcal)',
  protein: 'Protein (g)',
  carbs: 'Carbs (g)',
  fat: 'Fat (g)',
};

const NUMBER_FIELDS: QuickAddField[] = ['calories', 'protein', 'carbs', 'fat'];

export default function QuickAddSheet({ visible, today, entry, onClose, onChanged }: QuickAddSheetProps) {
  const [day, setDay] = useState(today);
  const [fields, setFields] = useState<QuickAddFields>(EMPTY_FIELDS);
  const [editing, setEditing] = useState<FoodLogEntry | null>(null);
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setDay(entry?.date ?? today);
    setFields(entry ? fieldsFromEntry(entry) : EMPTY_FIELDS);
    setEditing(entry);
  }, [visible]);

  const loadEntries = useCallback(async (date: string, isCurrent: () => boolean) => {
    try {
      const rows = await getFoodLogForDate(date);
      if (isCurrent()) setEntries(rows);
    } catch (err) {
      console.error('QuickAddSheet: getFoodLogForDate error', err);
      if (isCurrent()) {
        setEntries([]);
        Alert.alert('Could not load entries', 'The entries for this day could not be read.');
      }
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    void loadEntries(day, () => current);
    return () => {
      current = false;
    };
  }, [visible, day, loadEntries]);

  const days = useMemo(() => Array.from({ length: DAYS_BACK + 1 }, (_, i) => addDays(today, -i)), [today]);
  const result = useMemo(() => validateQuickAdd(fields), [fields]);

  const reset = () => {
    setFields(EMPTY_FIELDS);
    setEditing(null);
  };

  const selectDay = (date: string) => {
    setDay(date);
    reset();
  };

  const loadEntry = (item: FoodLogEntry) => {
    setFields(fieldsFromEntry(item));
    setEditing(item);
  };

  const refresh = async () => {
    await loadEntries(day, () => true);
    onChanged();
  };

  const handleSave = async () => {
    if (!result.valid || busyRef.current) return;
    busyRef.current = true;
    try {
      if (editing) {
        await updateFoodLogEntry(editing.id, result.entry);
      } else {
        await addFoodLogEntry({ date: day, ...result.entry });
      }
      reset();
      await refresh();
    } catch (err) {
      console.error('QuickAddSheet: save error', err);
      Alert.alert('Could not save', 'The entry was not saved. Please try again.');
    } finally {
      busyRef.current = false;
    }
  };

  const handleDelete = () => {
    const target = editing;
    if (!target) return;
    Alert.alert('Delete entry?', `${target.label ?? 'Quick add'} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (busyRef.current) return;
          busyRef.current = true;
          try {
            await deleteFoodLogEntry(target.id);
            reset();
            await refresh();
          } catch (err) {
            console.error('QuickAddSheet: delete error', err);
            Alert.alert('Could not delete', 'The entry was not deleted. Please try again.');
          } finally {
            busyRef.current = false;
          }
        },
      },
    ]);
  };

  const errors = result.valid ? {} : result.errors;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close quick add"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboard}
        >
          <SafeAreaView edges={['bottom']} style={styles.sheet} testID="quick-add-sheet">
            <View style={styles.header}>
              <Text style={styles.title}>Quick add</Text>
              <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {days.map((date, i) => {
                  const active = date === day;
                  return (
                    <TouchableOpacity
                      key={date}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => selectDay(date)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {chipLabel(date, i)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {(['label', ...NUMBER_FIELDS] as QuickAddField[]).map((key) => (
                <View key={key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{FIELD_LABELS[key]}</Text>
                  <TextInput
                    style={styles.input}
                    value={fields[key]}
                    onChangeText={(text) => setFields((prev) => ({ ...prev, [key]: text }))}
                    keyboardType={key === 'label' ? 'default' : 'decimal-pad'}
                    accessibilityLabel={FIELD_LABELS[key]}
                    placeholderTextColor={Colors.textMuted}
                  />
                  {errors[key] && fields[key] !== '' ? (
                    <Text style={styles.errorText}>{errors[key]}</Text>
                  ) : null}
                </View>
              ))}

              <View style={styles.actions}>
                <Button
                  title={editing ? 'Update' : 'Save'}
                  onPress={handleSave}
                  disabled={!result.valid}
                  style={styles.actionButton}
                />
                {editing ? (
                  <Button title="Delete" variant="ghost" onPress={handleDelete} style={styles.actionButton} />
                ) : null}
              </View>

              <View style={styles.list}>
                {entries.length === 0 ? (
                  <Text style={styles.emptyText}>No entries for this day.</Text>
                ) : (
                  entries.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.listItem, item.id === editing?.id && styles.listItemActive]}
                      onPress={() => loadEntry(item)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                    >
                      <Text style={styles.listItemText}>
                        {`${item.label ?? 'Quick add'} — ${formatEntrySummary(item)}`}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.textPrimary,
    opacity: BACKDROP_OPACITY,
  },
  keyboard: {
    flex: 1,
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: SHEET_MAX_HEIGHT,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.line2,
  },
  title: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
  },
  closeText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  chips: {
    paddingBottom: Spacing.md,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.line2,
    backgroundColor: Colors.canvasSunken,
    marginRight: Spacing.sm,
  },
  chipActive: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.sageDeep,
  },
  chipText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },
  field: {
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.canvasSunken,
    color: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.line2,
  },
  errorText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.danger,
    marginTop: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  actionButton: {
    flex: 1,
  },
  list: {
    gap: Spacing.sm,
  },
  listItem: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.line2,
    backgroundColor: Colors.surface,
  },
  listItemActive: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.sageDeep,
  },
  listItemText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  emptyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },
});
