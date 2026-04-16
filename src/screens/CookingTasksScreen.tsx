/**
 * CookingTasksScreen
 *
 * Lists all meals queued for cooking (cooking_tasks table).
 * Issue #10: task list UI
 * Issue #11: step-by-step instructions on tap
 * Issue #12: "Finished Cooking" button → inventory update + navigation
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getCookingTasks,
  finishCooking,
  deleteCookingTask,
  CookingTaskWithRecipe,
} from '../db/database';

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onPress,
  onRemove,
}: {
  task: CookingTaskWithRecipe;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Cook ${task.recipe.title}`}
    >
      {/* Left accent strip */}
      <View style={styles.cardAccent} />

      <View style={styles.cardBody}>
        {/* Recipe name + servings badge */}
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {task.recipe.title}
          </Text>
          <View style={styles.servingsBadge}>
            <Text style={styles.servingsBadgeText}>
              {task.servings_to_cook}×
            </Text>
          </View>
        </View>

        {/* Category chip */}
        <View style={styles.categoryChip}>
          <Text style={styles.categoryChipText}>{task.recipe.category}</Text>
        </View>

        {/* Macros row */}
        <View style={styles.macroRow}>
          <MacroPill label="kcal" value={task.recipe.calories} color={Colors.warning} />
          <MacroPill label="protein" value={`${task.recipe.protein}g`} color={Colors.accent} />
          <MacroPill label="carbs" value={`${task.recipe.carbs}g`} color={Colors.secondary} />
          <MacroPill label="fat" value={`${task.recipe.fat}g`} color="#FF8A65" />
        </View>

        {/* Prep time + ingredient count + CTA hint */}
        <View style={styles.cardFooter}>
          <Text style={styles.prepTime}>
            ⏱ {task.recipe.prepTimeMinutes} min
          </Text>
          <Text style={styles.ingredientCount}>
            🥬 {task.recipe.ingredients.length} ingredients
          </Text>
          <Text style={styles.tapHint}>Tap to cook →</Text>
        </View>
      </View>

      {/* Remove button */}
      <TouchableOpacity
        style={styles.removeBtn}
        onPress={onRemove}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${task.recipe.title} from queue`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function MacroPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <View style={[styles.macroPill, { borderColor: color + '40' }]}>
      <Text style={[styles.macroPillValue, { color }]}>{value}</Text>
      <Text style={styles.macroPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Instructions Modal ──────────────────────────────────────────────────────

function InstructionsModal({
  task,
  visible,
  onClose,
  onFinished,
  finishing,
}: {
  task: CookingTaskWithRecipe | null;
  visible: boolean;
  onClose: () => void;
  onFinished: () => void;
  finishing: boolean;
}) {
  if (!task || !visible) return null;

  // Split instructions by newline so each line becomes a numbered step
  const steps = task.recipe.instructions
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Fallback for recipes with no structured instructions
  const hasSteps = steps.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Modal Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.modalBackBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.modalBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={2}>
            {task.recipe.title}
          </Text>
          <View style={styles.servingsBadgeSm}>
            <Text style={styles.servingsBadgeSmText}>
              {task.servings_to_cook} serving{task.servings_to_cook > 1 ? 's' : ''}
            </Text>
          </View>
          {hasSteps && (
            <Text style={styles.stepCountLabel}>
              {steps.length} steps
            </Text>
          )}
        </View>

        {/* Scrollable instructions */}
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Quick macros banner */}
          <View style={styles.instrMacros}>
            <MacroPill label="kcal" value={task.recipe.calories} color={Colors.warning} />
            <MacroPill label="protein" value={`${task.recipe.protein}g`} color={Colors.accent} />
            <MacroPill label="carbs" value={`${task.recipe.carbs}g`} color={Colors.secondary} />
            <MacroPill label="fat" value={`${task.recipe.fat}g`} color="#FF8A65" />
          </View>

          {/* Steps */}
          <Text style={styles.instrHeading}>Step-by-Step Instructions</Text>
          {hasSteps ? (
            steps.map((step, idx) => (
              <View key={idx} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{idx + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))
          ) : (
            <View style={styles.noStepsBox}>
              <Text style={styles.noStepsText}>
                No step-by-step instructions available. Follow the recipe as written.
              </Text>
            </View>
          )}

          {/* Freezer tips if present */}
          {task.recipe.freezerTips ? (
            <View style={styles.freezerBox}>
              <Text style={styles.freezerTitle}>❄️ Freezer Tips</Text>
              <Text style={styles.freezerText}>{task.recipe.freezerTips}</Text>
            </View>
          ) : null}

          {/* Spacer so button doesn't overlap last step */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Finished Cooking button — fixed at bottom */}
        <View style={styles.finishedContainer}>
          <TouchableOpacity
            style={[styles.finishedBtn, finishing && styles.finishedBtnDisabled]}
            onPress={onFinished}
            disabled={finishing}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Mark cooking as finished"
          >
            <Text style={styles.finishedBtnIcon}>{finishing ? '⏳' : '✅'}</Text>
            <Text style={styles.finishedBtnText}>
              {finishing ? 'Saving...' : 'Finished Cooking!'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CookingTasksScreen() {
  const navigation = useNavigation<any>();
  const [tasks, setTasks] = useState<CookingTaskWithRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<CookingTaskWithRecipe | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Reload whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [])
  );

  const loadTasks = async () => {
    try {
      setLoading(true);
      const data = await getCookingTasks();
      setTasks(data);
    } catch (err) {
      console.error('[CookingTasksScreen] loadTasks error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTask = (task: CookingTaskWithRecipe) => {
    setSelectedTask(task);
    setModalVisible(true);
  };

  const handleRemoveTask = (task: CookingTaskWithRecipe) => {
    Alert.alert(
      'Remove Task',
      `Remove "${task.recipe.title}" from your cooking queue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCookingTask(task.id);
              await loadTasks();
            } catch (err) {
              console.error('[CookingTasksScreen] deleteCookingTask error:', err);
              Alert.alert('Error', 'Failed to remove the task.');
            }
          },
        },
      ]
    );
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setSelectedTask(null);
  };

  /**
   * Issue #12 — "Finished Cooking" flow:
   *   1. Calls finishCooking() (upserts inventory, deletes task)
   *   2. Closes modal
   *   3. Navigates to "Meal Prep" drawer screen (which includes the inventory tab)
   */
  const handleFinishedCooking = async () => {
    if (!selectedTask || finishing) return;
    setFinishing(true);
    try {
      await finishCooking(
        selectedTask.id,
        selectedTask.recipe_id,
        selectedTask.servings_to_cook
      );
      setModalVisible(false);
      setSelectedTask(null);
      // Reload the list
      await loadTasks();
      // Navigate to My Inventory
      Alert.alert(
        '🎉 Well done!',
        `${selectedTask.servings_to_cook} portion(s) of "${selectedTask.recipe.title}" added to your inventory.`,
        [
          {
            text: 'View Inventory',
            onPress: () => navigation.navigate('Meal Prep'),
          },
          { text: 'Stay Here', style: 'cancel' },
        ]
      );
    } catch (err) {
      console.error('[CookingTasksScreen] finishCooking error:', err);
      Alert.alert('Error', 'Failed to record your cooked meal. Please try again.');
    } finally {
      setFinishing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Loading cooking queue…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Instructions full-screen modal */}
      <InstructionsModal
        task={selectedTask}
        visible={modalVisible}
        onClose={handleCloseModal}
        onFinished={handleFinishedCooking}
        finishing={finishing}
      />

      {tasks.length === 0 ? (
        /* Empty state */
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>👨‍🍳</Text>
          <Text style={styles.emptyTitle}>No cooking tasks yet</Text>
          <Text style={styles.emptySubtitle}>
            Open a recipe and tap{' '}
            <Text style={{ color: Colors.accent, fontWeight: '700' }}>
              "Add to Shopping List"
            </Text>{' '}
            to queue it for cooking.
          </Text>
          <TouchableOpacity
            style={styles.emptyCtaBtn}
            onPress={() => navigation.navigate('Recipes')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Browse recipes to add a cooking task"
          >
            <Text style={styles.emptyCtaBtnText}>🍽 Browse Recipes</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderTitle}>
                {tasks.length} meal{tasks.length !== 1 ? 's' : ''} to cook
              </Text>
              <Text style={styles.listHeaderSub}>
                Tap a card to see step-by-step instructions
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() => handleOpenTask(item)}
              onRemove={() => handleRemoveTask(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centred: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.md,
  },

  // ── List ──────────────────────────────────────────────────────────────────
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  listHeader: {
    marginBottom: Spacing.lg,
    gap: 4,
  },
  listHeaderTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  listHeaderSub: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
    alignItems: 'center',
  },
  cardAccent: {
    width: 4,
    backgroundColor: Colors.accent,
  },
  cardBody: {
    flex: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  servingsBadge: {
    backgroundColor: Colors.accent + '20',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  servingsBadgeText: {
    color: Colors.accent,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
  },

  // ── Macros ────────────────────────────────────────────────────────────────
  categoryChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipText: {
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
    textTransform: 'capitalize',
  },
  macroRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  macroPill: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    minWidth: 48,
  },
  macroPillValue: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  macroPillLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prepTime: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },
  ingredientCount: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },
  removeBtn: {
    padding: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  removeBtnText: {
    fontSize: 16,
    color: Colors.textMuted,
    fontWeight: Typography.weights.bold,
  },
  tapHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.accent,
    fontWeight: Typography.weights.semibold,
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCtaBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  emptyCtaBtnText: {
    color: Colors.background,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
  },

  // ── Instructions Modal ────────────────────────────────────────────────────
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.xs,
  },
  modalBackBtn: {
    paddingVertical: Spacing.xs,
    alignSelf: 'flex-start',
  },
  modalBackText: {
    color: Colors.accent,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.medium,
  },
  modalTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    lineHeight: 26,
  },
  servingsBadgeSm: {
    backgroundColor: Colors.secondary + '20',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.secondary,
  },
  servingsBadgeSmText: {
    color: Colors.secondary,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: Spacing.lg,
  },

  instrMacros: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
    marginBottom: Spacing.lg,
  },
  instrHeading: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },

  // Step row
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.accent + '20',
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    color: Colors.accent,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  stepText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    lineHeight: 24,
  },

  // Freezer tips box
  freezerBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  freezerTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  freezerText: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Finished Cooking button
  finishedContainer: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  finishedBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    elevation: 4,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  finishedBtnIcon: {
    fontSize: 20,
  },
  finishedBtnText: {
    color: Colors.background,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.3,
  },
  finishedBtnDisabled: {
    backgroundColor: Colors.textMuted,
    elevation: 0,
    shadowOpacity: 0,
  },
  stepCountLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.medium,
  },
  noStepsBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noStepsText: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
