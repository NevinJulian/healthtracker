/**
 * CookingTasksScreen
 *
 * Lists all meals queued for cooking (cooking_tasks table).
 * Issue #10: task list UI
 * Issue #11: step-by-step instructions on tap
 * Issue #12: "Finished Cooking" button → inventory update + navigation
 *
 * Verdure redesign: Unit 8 (#241)
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
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getCookingTasks,
  finishCooking,
  deleteCookingTask,
  CookingTaskWithRecipe,
} from '../db/database';
import {
  Card,
  Row,
  IconChip,
  Pill,
  ProgressBar,
  Button,
  ScreenHeader,
} from '../components';

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
  const cookIcon = (
    <Text style={{ fontSize: 18, color: Colors.clayDeep }}>{'🍳'}</Text>
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Cook ${task.recipe.title}`}
    >
      <Card style={styles.card}>
        <View style={styles.cardInner}>
          {/* Leading icon chip */}
          <IconChip icon={cookIcon} accent="clay" size={44} style={styles.cardIcon} />

          {/* Main content */}
          <View style={styles.cardBody}>
            {/* Title row */}
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {task.recipe.title}
              </Text>
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
            </View>

            {/* Chips row: category, servings, prep time */}
            <View style={styles.chipsRow}>
              <Pill label={task.recipe.category} accent="clay" />
              <Pill label={`${task.servings_to_cook}×`} accent="sage" />
              <Pill label={`${task.recipe.prepTimeMinutes} min`} accent="sky" />
            </View>

            {/* Macros row */}
            <View style={styles.macroRow}>
              <Pill label={`${task.recipe.calories} kcal`} accent="gold" />
              <Pill label={`${task.recipe.protein}g protein`} accent="sage" />
              <Pill label={`${task.recipe.carbs}g carbs`} accent="clay" />
              <Pill label={`${task.recipe.fat}g fat`} accent="sky" />
            </View>

            {/* Footer */}
            <View style={styles.cardFooter}>
              <Text style={styles.ingredientCount}>
                {task.recipe.ingredients.length} ingredients
              </Text>
              <Text style={styles.tapHint}>Tap to cook</Text>
            </View>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
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
  const insets = useSafeAreaInsets();

  if (!task || !visible) return null;

  // Split instructions by newline so each line becomes a numbered step
  const steps = task.recipe.instructions
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const hasSteps = steps.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Hero header — deep sage-d panel per DESIGN.md §5 */}
        <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, Spacing.xl) }]}>
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
          <View style={styles.modalServingsRow}>
            <View style={styles.servingsBadge}>
              <Text style={styles.servingsBadgeText}>
                {task.servings_to_cook} serving{task.servings_to_cook > 1 ? 's' : ''}
              </Text>
            </View>
            {hasSteps && (
              <Text style={styles.stepCountLabel}>
                {steps.length} steps
              </Text>
            )}
          </View>
        </View>

        {/* Scrollable instructions */}
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Quick macros banner */}
          <View style={styles.instrMacros}>
            <Pill label={`${task.recipe.calories} kcal`} accent="gold" />
            <Pill label={`${task.recipe.protein}g protein`} accent="sage" />
            <Pill label={`${task.recipe.carbs}g carbs`} accent="clay" />
            <Pill label={`${task.recipe.fat}g fat`} accent="sky" />
          </View>

          {/* Steps heading */}
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
            <Card style={styles.noStepsBox}>
              <Text style={styles.noStepsText}>
                No step-by-step instructions available. Follow the recipe as written.
              </Text>
            </Card>
          )}

          {/* Freezer tips if present */}
          {task.recipe.freezerTips ? (
            <View style={styles.freezerBox}>
              <Text style={styles.freezerTitle}>Freezer Tips</Text>
              <Text style={styles.freezerText}>{task.recipe.freezerTips}</Text>
            </View>
          ) : null}

          {/* Spacer so button doesn't overlap last step */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Finished Cooking button — fixed at bottom */}
        <View style={[styles.finishedContainer, { paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
          <Button
            title={finishing ? 'Saving…' : 'Finished Cooking'}
            onPress={onFinished}
            disabled={finishing}
            variant="primary"
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CookingTasksScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<CookingTaskWithRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const data = await getCookingTasks();
      setTasks(data);
    } catch (err) {
      console.error('[CookingTasksScreen] handleRefresh error:', err);
    } finally {
      setRefreshing(false);
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
        'Well done!',
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

  if (loading && !refreshing) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={Colors.sage} />
        <Text style={styles.loadingText}>Loading cooking queue…</Text>
      </View>
    );
  }

  const totalServings = tasks.reduce((sum, t) => sum + t.servings_to_cook, 0);

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
        <View
          style={styles.emptyContainer}
          accessible={true}
          accessibilityLabel="No cooking tasks yet. Open a recipe and add it to your shopping list to queue it for cooking."
        >
          <Text style={styles.emptyTitle}>No cooking tasks yet</Text>
          <Text style={styles.emptySubtitle}>
            Open a recipe and tap{' '}
            <Text style={styles.emptyAccent}>
              "Add to Shopping List"
            </Text>{' '}
            to queue it for cooking.
          </Text>
          <Button
            title="Browse Recipes"
            onPress={() => navigation.navigate('Recipes')}
            variant="primary"
            style={styles.emptyCtaBtn}
          />
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, Spacing.xxl) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.sage}
              colors={[Colors.sage]}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <ScreenHeader
                title="Cooking Queue"
                subtitle={`${tasks.length} meal${tasks.length !== 1 ? 's' : ''} · ${totalServings} serving${totalServings !== 1 ? 's' : ''} queued`}
              />
              {/* Progress bar — progress is always 0 here since these are all pending */}
              <View style={styles.progressSection}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressLabel}>READY TO COOK</Text>
                  <Text style={styles.progressValue}>{tasks.length} queued</Text>
                </View>
                <ProgressBar progress={0} height={6} />
              </View>
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
    backgroundColor: Colors.canvas,
  },
  centred: {
    flex: 1,
    backgroundColor: Colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    fontFamily: Typography.body,
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
  },

  // ── List ──────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  listHeader: {
    marginBottom: Spacing.lg,
  },
  progressSection: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  progressValue: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    padding: 0,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cardIcon: {
    flexShrink: 0,
    marginTop: 2,
  },
  cardBody: {
    flex: 1,
    gap: Spacing.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.md * 1.35,
  },
  removeBtn: {
    paddingLeft: Spacing.sm,
    paddingTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBtnText: {
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontWeight: Typography.weights.bold,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  macroRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  ingredientCount: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },
  tapHint: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
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
  emptyTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: Typography.sizes.sm * 1.5,
  },
  emptyAccent: {
    color: Colors.sageDeep,
    fontWeight: Typography.weights.bold,
  },
  emptyCtaBtn: {
    marginTop: Spacing.sm,
    alignSelf: 'stretch',
  },

  // ── Instructions Modal ────────────────────────────────────────────────────
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  // Hero header — deep sage-d fill per DESIGN.md §5
  modalHeader: {
    backgroundColor: Colors.sageDeep,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  modalBackBtn: {
    paddingVertical: Spacing.xs,
    alignSelf: 'flex-start',
  },
  modalBackText: {
    fontFamily: Typography.title,
    color: Colors.surface,
    fontSize: Typography.sizes.sm,
    opacity: 0.9,
  },
  modalTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xxl,
    color: Colors.surface,
    lineHeight: Typography.sizes.xxl * 1.15,
    letterSpacing: -0.5,
  },
  modalServingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  servingsBadge: {
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs - 1,
    alignSelf: 'flex-start',
  },
  servingsBadgeText: {
    fontFamily: Typography.label,
    color: Colors.sageDeep,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  stepCountLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.surface,
    opacity: 0.75,
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
    fontFamily: Typography.title,
    fontSize: Typography.sizes.lg,
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
    backgroundColor: Colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    fontFamily: Typography.label,
    color: Colors.sageDeep,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  stepText: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.md * 1.55,
  },

  // Freezer tips box
  freezerBox: {
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  freezerTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.clayDeep,
  },
  freezerText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.clayDeep,
    lineHeight: Typography.sizes.sm * 1.5,
  },

  // No steps fallback
  noStepsBox: {
    // Card component handles surface + radius
  },
  noStepsText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.sm * 1.5,
  },

  // Finished Cooking button area
  finishedContainer: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    backgroundColor: Colors.canvas,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
