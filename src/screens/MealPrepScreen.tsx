import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getMealInventory,
  getWeeklyMealPlan,
  logCookedMeal,
  assignMealToPlan,
  toggleMealConsumed,
  getRecipes,
  Recipe,
  MealInventoryWithRecipe,
  WeeklyMealPlanItem,
  toISODate,
} from '../db/database';
import {
  Card,
  Row,
  IconChip,
  Pill,
  Button,
  ScreenHeader,
} from '../components';

// ─── Helpers ──────────────────────────────────────────────────

const logDbError = (err: any) => console.error('[MealPrepScreen] DB Error:', err);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ─── Verdure circle checkbox (24px, sage when done) ───────────

function CircleCheck({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View style={[styles.circle, checked && styles.circleDone]}>
        {checked && <Text style={styles.circleMark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────

export default function MealPrepScreen() {
  const [activeTab, setActiveTab] = useState<'weekly' | 'inventory'>('weekly');

  const [inventory, setInventory] = useState<MealInventoryWithRecipe[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyMealPlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [logModalVisible, setLogModalVisible] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ date: string; meal_type: string } | null>(null);

  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const inv = await getMealInventory();
      const plan = await getWeeklyMealPlan();
      const allRecipes = await getRecipes();
      setInventory(inv);
      setWeeklyPlan(plan);
      setRecipes(allRecipes);
    } catch (err) {
      logDbError(err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Actions ─────────────────────────────────────────────────

  const handleLogCookedMeal = async (recipe_id: string, portions: number) => {
    if (portions <= 0) return;
    try {
      await logCookedMeal(recipe_id, portions);
      setLogModalVisible(false);
      loadData();
    } catch (err) {
      logDbError(err);
    }
  };

  const handleAssignMeal = async (recipe_id: string) => {
    if (!assignTarget) return;
    try {
      await assignMealToPlan(assignTarget.date, assignTarget.meal_type, recipe_id);
      setAssignModalVisible(false);
      loadData();
    } catch (err) {
      logDbError(err);
    }
  };

  const handleToggleConsumed = async (planId: number, currentVal: boolean) => {
    try {
      await toggleMealConsumed(planId, !currentVal);
      loadData();
    } catch (err) {
      logDbError(err);
    }
  };

  // ─── Tab Switcher ─────────────────────────────────────────────
  // Pill track: canvasSunken bg, sage-fill active pill, white text on active.
  // Follows the same pattern as DashboardScreen segment controls.

  const renderTabSwitcher = () => (
    <View style={styles.tabTrack}>
      {(['weekly', 'inventory'] as const).map((tab) => {
        const active = activeTab === tab;
        const label = tab === 'weekly' ? 'Weekly Plan' : 'My Inventory';
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.tabPill, active && styles.tabPillActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.75}
          >
            <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ─── Inventory Tab ────────────────────────────────────────────

  const renderInventoryTab = () => (
    <ScrollView
      style={styles.scrollFlex}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Button
        title="+ Log Cooked Meal"
        onPress={() => setLogModalVisible(true)}
        variant="primary"
        style={styles.logButton}
      />

      {inventory.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Your inventory is empty</Text>
          <Text style={styles.emptySub}>Cook and log a meal to see it here.</Text>
        </View>
      ) : (
        inventory.map((item) => (
          <Card key={item.id} style={styles.inventoryCard}>
            {/* Header row: icon chip + title + portions pill */}
            <View style={styles.invCardHeader}>
              <IconChip
                icon={<Text style={styles.chipIcon}>🍲</Text>}
                accent="clay"
                size={40}
              />
              <View style={styles.invTitleBlock}>
                <Text style={styles.invTitle} numberOfLines={1}>
                  {item.recipe.title}
                </Text>
                <Text style={styles.invDate}>Cooked {item.date_cooked}</Text>
              </View>
              <Pill
                label={`${item.portions_available}x`}
                accent="clay"
              />
            </View>

            {/* Macro row */}
            <View style={styles.macroRow}>
              <MacroChip label="kcal" value={String(item.recipe.calories)} />
              <MacroChip label="protein" value={`${item.recipe.protein}g`} />
              <MacroChip label="carbs" value={`${item.recipe.carbs}g`} />
              <MacroChip label="fat" value={`${item.recipe.fat}g`} />
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );

  // ─── Weekly Tab ───────────────────────────────────────────────

  const renderWeeklyTab = () => {
    const today = new Date();
    const todayStr = toISODate(today);
    const days = Array.from({ length: 7 }).map((_, i) => addDays(today, i));

    return (
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {days.map((dateObj) => {
          const dateStr = toISODate(dateObj);
          const isToday = dateStr === todayStr;

          const lunchPlan = weeklyPlan.find(p => p.date === dateStr && p.meal_type === 'Lunch');
          const dinnerPlan = weeklyPlan.find(p => p.date === dateStr && p.meal_type === 'Dinner');

          const lunchRecipe = lunchPlan ? recipes.find(r => r.id === lunchPlan.recipe_id) : null;
          const dinnerRecipe = dinnerPlan ? recipes.find(r => r.id === dinnerPlan.recipe_id) : null;

          // Daily totals
          const consumed = [
            lunchPlan?.is_consumed && lunchRecipe,
            dinnerPlan?.is_consumed && dinnerRecipe,
          ].filter(Boolean) as Recipe[];
          const totalKcal = consumed.reduce((s, r) => s + (r.calories || 0), 0);
          const totalProtein = consumed.reduce((s, r) => s + (r.protein || 0), 0);

          return (
            <Card
              key={dateStr}
              style={[styles.dayCard, isToday && styles.dayCardToday]}
            >
              {/* Day header */}
              <View style={styles.dayHeader}>
                <View style={[styles.dayBadge, isToday && styles.dayBadgeToday]}>
                  <Text style={[styles.dayBadgeDay, isToday && styles.dayBadgeDayToday]}>
                    {dateObj.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
                  </Text>
                  <Text style={[styles.dayBadgeNum, isToday && styles.dayBadgeNumToday]}>
                    {dateObj.getDate()}
                  </Text>
                </View>
                <Text style={styles.dayLongLabel}>
                  {dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {isToday ? ' — Today' : ''}
                </Text>
                {totalKcal > 0 && (
                  <Pill label={`${totalKcal} kcal`} accent="clay" />
                )}
              </View>

              {/* Meal slots */}
              <View style={styles.mealSlotList}>
                <MealSlot
                  label="Lunch"
                  plan={lunchPlan}
                  recipe={lunchRecipe ?? null}
                  onToggleConsumed={(id, val) => handleToggleConsumed(id, val)}
                  onAssign={() => {
                    setAssignTarget({ date: dateStr, meal_type: 'Lunch' });
                    setAssignModalVisible(true);
                  }}
                />
                <View style={styles.slotDivider} />
                <MealSlot
                  label="Dinner"
                  plan={dinnerPlan}
                  recipe={dinnerRecipe ?? null}
                  onToggleConsumed={(id, val) => handleToggleConsumed(id, val)}
                  onAssign={() => {
                    setAssignTarget({ date: dateStr, meal_type: 'Dinner' });
                    setAssignModalVisible(true);
                  }}
                />
              </View>

              {/* Daily total footer — only when something is consumed */}
              {(totalKcal > 0 || totalProtein > 0) && (
                <View style={styles.dailyTotal}>
                  <Text style={styles.dailyTotalLabel}>CONSUMED TODAY</Text>
                  <Text style={styles.dailyTotalValues}>
                    {totalKcal} kcal · {totalProtein}g protein
                  </Text>
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    );
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Meal Plan"
        subtitle="Plan, track & inventory your meals"
        style={styles.screenHeader}
      />

      <View style={styles.tabRow}>
        {renderTabSwitcher()}
      </View>

      {activeTab === 'weekly' ? renderWeeklyTab() : renderInventoryTab()}

      <LogMealModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        recipes={recipes}
        onSave={handleLogCookedMeal}
      />

      <AssignMealModal
        visible={assignModalVisible}
        onClose={() => setAssignModalVisible(false)}
        inventory={inventory}
        onSave={handleAssignMeal}
      />
    </View>
  );
}

// ─── MealSlot sub-component ───────────────────────────────────

function MealSlot({
  label,
  plan,
  recipe,
  onToggleConsumed,
  onAssign,
}: {
  label: string;
  plan: WeeklyMealPlanItem | undefined;
  recipe: Recipe | null;
  onToggleConsumed: (id: number, current: boolean) => void;
  onAssign: () => void;
}) {
  const subtitle = recipe
    ? `${recipe.calories} kcal · ${recipe.protein}g protein`
    : undefined;

  return (
    <View style={styles.mealSlot}>
      <Text style={styles.mealTypeLabel}>{label}</Text>
      {plan ? (
        <View style={styles.assignedRow}>
          <IconChip
            icon={<Text style={styles.chipIcon}>{label === 'Lunch' ? '🥗' : '🍽'}</Text>}
            accent="clay"
            size={36}
          />
          <View style={styles.assignedText}>
            <Text
              style={[
                styles.assignedTitle,
                plan.is_consumed && styles.assignedTitleConsumed,
              ]}
              numberOfLines={1}
            >
              {recipe?.title ?? 'Unknown Recipe'}
            </Text>
            {subtitle && (
              <Text
                style={[
                  styles.assignedMeta,
                  plan.is_consumed && styles.assignedMetaConsumed,
                ]}
              >
                {subtitle}
              </Text>
            )}
          </View>
          <CircleCheck
            checked={plan.is_consumed}
            onToggle={() => onToggleConsumed(plan.id, plan.is_consumed)}
          />
        </View>
      ) : (
        <View style={styles.assignBtnWrap}>
          <TouchableOpacity
            style={styles.assignBtn}
            onPress={onAssign}
            activeOpacity={0.75}
          >
            <Text style={styles.assignBtnText}>Assign</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── MacroChip helper ─────────────────────────────────────────

function MacroChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macroChip}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ─── Log Meal Modal ───────────────────────────────────────────

function LogMealModal({ visible, onClose, recipes, onSave }: {
  visible: boolean;
  onClose: () => void;
  recipes: Recipe[];
  onSave: (recipe_id: string, portions: number) => void;
}) {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [portions, setPortions] = useState('4');

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Log Cooked Meal</Text>
          <Text style={styles.modalSub}>Select what you just cooked:</Text>

          <FlatList
            style={styles.modalList}
            data={recipes}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => {
              const isSelected = selectedRecipeId === item.id;
              return (
                <TouchableOpacity
                  style={[styles.recipeOpt, isSelected && styles.recipeOptSelected]}
                  onPress={() => setSelectedRecipeId(item.id)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.recipeOptText, isSelected && styles.recipeOptTextSelected]}>
                    {item.title}
                  </Text>
                  {isSelected && (
                    <View style={styles.recipeCheckDot} />
                  )}
                </TouchableOpacity>
              );
            }}
          />

          <View style={styles.portionsRow}>
            <Text style={styles.portionsLabel}>Portions cooked</Text>
            <TextInput
              style={styles.portionsInput}
              keyboardType="number-pad"
              value={portions}
              onChangeText={setPortions}
            />
          </View>

          <View style={styles.modalBtnRow}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={onClose}
              style={styles.modalBtnHalf}
            />
            <Button
              title="Save"
              variant="primary"
              onPress={() =>
                selectedRecipeId && onSave(selectedRecipeId, parseInt(portions, 10) || 0)
              }
              disabled={!selectedRecipeId}
              style={styles.modalBtnHalf}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Assign Meal Modal ────────────────────────────────────────

function AssignMealModal({ visible, onClose, inventory, onSave }: {
  visible: boolean;
  onClose: () => void;
  inventory: MealInventoryWithRecipe[];
  onSave: (recipe_id: string) => void;
}) {
  if (!visible) return null;

  const validInventory = inventory.filter((item) => item.portions_available > 0);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Assign from Inventory</Text>

          {validInventory.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No inventory available</Text>
              <Text style={styles.emptySub}>Cook and log a meal first.</Text>
            </View>
          ) : (
            <FlatList
              style={styles.modalList}
              data={validInventory}
              keyExtractor={(r) => r.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.recipeOpt}
                  onPress={() => onSave(item.recipe_id)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.recipeOptText}>{item.recipe.title}</Text>
                  <Pill label={`${item.portions_available}x`} accent="clay" />
                </TouchableOpacity>
              )}
            />
          )}

          <Button
            title="Close"
            variant="ghost"
            onPress={onClose}
            style={styles.modalBtnFull}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screenHeader: {
    paddingTop: Spacing.lg,
  },
  tabRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },

  // Tab switcher
  tabTrack: {
    flexDirection: 'row',
    backgroundColor: Colors.canvasSunken,
    borderRadius: Radius.full,
    padding: 4,
    gap: Spacing.xs,
  },
  tabPill: {
    flex: 1,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    alignItems: 'center',
  },
  tabPillActive: {
    backgroundColor: Colors.sage,
  },
  tabPillText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.semibold,
  },
  tabPillTextActive: {
    color: Colors.surface,
  },

  scrollFlex: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },

  // ── Weekly day card ────────────────────────────────────────
  dayCard: {
    gap: Spacing.md,
  },
  dayCardToday: {
    borderWidth: 1.5,
    borderColor: Colors.sageTint,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dayBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeToday: {
    backgroundColor: Colors.sage,
  },
  dayBadgeDay: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
    color: Colors.textMuted,
  },
  dayBadgeDayToday: {
    color: Colors.surface,
  },
  dayBadgeNum: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.md * 1.2,
  },
  dayBadgeNumToday: {
    color: Colors.surface,
  },
  dayLongLabel: {
    flex: 1,
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },

  // ── Meal slots ─────────────────────────────────────────────
  mealSlotList: {
    gap: 0,
  },
  slotDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: -Spacing.xs,
    opacity: 0.6,
  },
  mealSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    minHeight: 52,
  },
  mealTypeLabel: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    width: 48,
  },
  assignedRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  assignedText: {
    flex: 1,
  },
  assignedTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  assignedTitleConsumed: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  assignedMeta: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.clayDeep,
    marginTop: 2,
  },
  assignedMetaConsumed: {
    color: Colors.textMuted,
  },
  assignBtnWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  assignBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.sage,
  },
  assignBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },

  // ── Daily total footer ─────────────────────────────────────
  dailyTotal: {
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dailyTotalLabel: {
    fontFamily: Typography.label,
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.sageDeep,
  },
  dailyTotalValues: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
  },

  // ── Verdure circle checkbox ────────────────────────────────
  circle: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDone: {
    backgroundColor: Colors.sage,
    borderColor: Colors.sage,
  },
  circleMark: {
    color: Colors.surface,
    fontSize: 13,
    fontWeight: Typography.weights.bold,
    lineHeight: 16,
  },

  // ── Chip icon text ─────────────────────────────────────────
  chipIcon: {
    fontSize: 18,
  },

  // ── Inventory card ─────────────────────────────────────────
  inventoryCard: {
    gap: Spacing.md,
  },
  invCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  invTitleBlock: {
    flex: 1,
  },
  invTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  invDate: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  macroRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  macroChip: {
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
    minWidth: 56,
  },
  macroValue: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.clayDeep,
    fontWeight: Typography.weights.bold,
  },
  macroLabel: {
    fontFamily: Typography.label,
    fontSize: 9,
    color: Colors.clayDeep,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 1,
  },

  logButton: {
    marginBottom: Spacing.xs,
  },

  // ── Empty states ───────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  emptySub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // ── Modals ─────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(44,53,46,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  modalTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  modalSub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },
  modalList: {
    maxHeight: 260,
  },
  recipeOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recipeOptSelected: {
    backgroundColor: Colors.sageTint,
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  recipeOptText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    flex: 1,
  },
  recipeOptTextSelected: {
    fontFamily: Typography.title,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },
  recipeCheckDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.sage,
    marginLeft: Spacing.sm,
  },
  portionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  portionsLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
  },
  portionsInput: {
    backgroundColor: Colors.canvasSunken,
    color: Colors.textPrimary,
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    width: 72,
    textAlign: 'center',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  modalBtnHalf: {
    flex: 1,
  },
  modalBtnFull: {
    marginTop: Spacing.xs,
  },
});
