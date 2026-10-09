import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getMealInventory,
  getWeeklyMealPlan,
  logCookedMeal,
  assignMealToPlan,
  toggleMealConsumed,
  removeMealFromPlan,
  copyMealToDates,
  getRecipes,
  getRecipesIncludingArchived,
  Recipe,
  MealInventoryWithRecipe,
  WeeklyMealPlanItem,
  toISODate,
  resetCookEmptyNotified,
} from '../db/database';
import { checkAndNotifyEmptyInventory } from '../services/notifications';
import { addDays as addDaysKey } from '../utils/dates';
import { copyResultMessage } from '../data/copyResult';
import {
  Card,
  Row,
  IconChip,
  Pill,
  Button,
  ScreenHeader,
} from '../components';
import { iconChipIconColor } from '../components/IconChip';

// ─── Helpers ──────────────────────────────────────────────────

const logDbError = (err: any) => console.error('[MealPrepScreen] DB Error:', err);

// ─── Verdure circle checkbox (24px, sage when done) ───────────

function CircleCheck({
  checked,
  onToggle,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? 'Toggle'}
      accessibilityState={{ checked }}
    >
      <View
        style={[styles.circle, checked && styles.circleDone]}
        importantForAccessibility="no-hide-descendants"
      >
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
  const [loadError, setLoadError] = useState<'initial' | 'refresh' | null>(null);

  const [logModalVisible, setLogModalVisible] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ date: string; meal_type: string } | null>(null);

  const [copyMealTarget, setCopyMealTarget] = useState<{ planId: number; title: string; date: string } | null>(
    null
  );

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [planRecipes, setPlanRecipes] = useState<Recipe[]>([]);

  // Tracks whether the screen has completed its first load. Post-action
  // refreshes (handleLogCookedMeal, handleAssignMeal, handleToggleConsumed)
  // and every re-focus call loadData() again — only the very first load
  // should show the full-screen "Loading meals…" state; a background
  // reload must update the list in place instead of blanking it out.
  const hasLoadedOnceRef = useRef(false);

  // mountedRef reflects the component's real lifetime; it is cleared only
  // on true unmount below — NOT on blur, which also runs the focus
  // effect's cleanup, so the two must not be conflated.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // runIdRef guards against overlapping loads: it is bumped at the start of
  // every loadData() call, and again when the focus effect's cleanup runs
  // (i.e. on blur). A load only commits its results if it is still the
  // current run when it resolves, so a stale in-flight
  // load — whether superseded by a newer load or abandoned via blur — can
  // never clobber newer state. Post-action refreshes (handleLogCookedMeal,
  // handleAssignMeal, handleToggleConsumed) naturally win this way too,
  // since each starts a new, higher run id.
  const runIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const runId = ++runIdRef.current;
    setLoadError(null);
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    try {
      const [inv, plan, allRecipes, allPlanRecipes] = await Promise.all([
        getMealInventory(),
        getWeeklyMealPlan(),
        getRecipes(),
        getRecipesIncludingArchived(),
      ]);
      if (!mountedRef.current || runIdRef.current !== runId) return;
      setInventory(inv);
      setWeeklyPlan(plan);
      setRecipes(allRecipes);
      setPlanRecipes(allPlanRecipes);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      if (!mountedRef.current || runIdRef.current !== runId) return;
      logDbError(err);
      setLoadError(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    } finally {
      if (mountedRef.current && runIdRef.current === runId) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Check on focus in case inventory emptied while the screen was away
      checkAndNotifyEmptyInventory().catch((err) =>
        console.warn('[MealPrepScreen] checkAndNotifyEmptyInventory failed:', err)
      );
      return () => {
        runIdRef.current++;
      };
    }, [loadData])
  );

  // ─── Actions ─────────────────────────────────────────────────

  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const runGuarded = async (action: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await action();
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleLogCookedMeal = async (recipe_id: string, portions: number) => {
    // Backstop — the modal's own Save button is disabled for anything
    // outside this range, but never trust the caller alone.
    if (!Number.isInteger(portions) || portions < 1 || portions > 50) return;
    await runGuarded(async () => {
      try {
        await logCookedMeal(recipe_id, portions);
      } catch (err) {
        logDbError(err);
        Alert.alert('Error', 'Failed to record your cooked meal. Please try again.');
        return;
      }
      try {
        await resetCookEmptyNotified();
      } catch (err) {
        console.warn('[MealPrepScreen] resetCookEmptyNotified failed:', err);
      }
      setLogModalVisible(false);
      loadData();
    });
  };

  const handleAssignMeal = async (recipe_id: string) => {
    if (!assignTarget) return;
    await runGuarded(async () => {
      try {
        await assignMealToPlan(assignTarget.date, assignTarget.meal_type, recipe_id);
        setAssignModalVisible(false);
        loadData();
      } catch (err) {
        logDbError(err);
        Alert.alert('Error', 'Failed to assign the meal. Please try again.');
      }
    });
  };

  const handleRemoveMeal = async (planId: number) => {
    await runGuarded(async () => {
      try {
        await removeMealFromPlan(planId);
      } catch (err) {
        logDbError(err);
        Alert.alert('Error', 'Failed to remove the meal. Please try again.');
        return;
      }
      loadData();
    });
  };

  const handleCopyMeal = async (dates: string[]) => {
    if (!copyMealTarget) return;
    const { planId } = copyMealTarget;
    await runGuarded(async () => {
      try {
        const result = await copyMealToDates(planId, dates);
        setCopyMealTarget(null);
        loadData();
        const { title, message } = copyResultMessage(result);
        Alert.alert(title, message);
      } catch (err) {
        logDbError(err);
        Alert.alert('Error', 'Failed to copy. Please try again.');
      }
    });
  };

  const handleToggleConsumed = async (planId: number, currentVal: boolean) => {
    try {
      await toggleMealConsumed(planId, !currentVal);
    } catch (err) {
      logDbError(err);
      Alert.alert('Error', 'Failed to update the meal. Please try again.');
      return;
    }
    try {
      await checkAndNotifyEmptyInventory();
    } catch (err) {
      console.warn('[MealPrepScreen] checkAndNotifyEmptyInventory failed:', err);
    }
    loadData();
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
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
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
                icon={<Ionicons name="restaurant-outline" size={20} color={iconChipIconColor('clay')} />}
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
    const todayStr = toISODate();
    const dateKeys = Array.from({ length: 7 }).map((_, i) => addDaysKey(todayStr, i));

    return (
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {dateKeys.map((dateStr) => {
          const isToday = dateStr === todayStr;
          // Derive a Date object for display-only formatting (weekday/day number)
          // Using Date(y,m,d) constructor ensures local midnight interpretation
          const [y, mo, dy] = dateStr.split('-').map(Number);
          const dateObj = new Date(y, mo - 1, dy);

          const lunchPlan = weeklyPlan.find(p => p.date === dateStr && p.meal_type === 'Lunch');
          const dinnerPlan = weeklyPlan.find(p => p.date === dateStr && p.meal_type === 'Dinner');

          const lunchRecipe = lunchPlan ? planRecipes.find(r => r.id === lunchPlan.recipe_id) : null;
          const dinnerRecipe = dinnerPlan ? planRecipes.find(r => r.id === dinnerPlan.recipe_id) : null;

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
                  onRemove={handleRemoveMeal}
                  onCopy={(planId, title) => setCopyMealTarget({ planId, title, date: dateStr })}
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
                  onRemove={handleRemoveMeal}
                  onCopy={(planId, title) => setCopyMealTarget({ planId, title, date: dateStr })}
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

      {loading ? (
        <View style={styles.loadingState}>
          <Text style={styles.loadingText}>Loading meals…</Text>
        </View>
      ) : loadError === 'initial' ? (
        <View style={styles.errorState}>
          <Text style={styles.emptyTitle}>Couldn't load your meals</Text>
          <Text style={styles.emptySub}>Your data is safe. Try again.</Text>
          <Button title="Retry" onPress={loadData} style={styles.errorRetry} />
        </View>
      ) : (
        <>
          {loadError === 'refresh' && (
            <View style={styles.refreshBanner}>
              <Text style={styles.refreshBannerText}>
                Couldn't refresh. Showing the last loaded data.
              </Text>
              <Button
                title="Retry"
                variant="ghost"
                onPress={loadData}
                style={styles.refreshBannerRetry}
              />
            </View>
          )}
          {activeTab === 'weekly' ? renderWeeklyTab() : renderInventoryTab()}
        </>
      )}

      {logModalVisible && (
        <LogMealModal
          visible={logModalVisible}
          onClose={() => setLogModalVisible(false)}
          recipes={recipes}
          onSave={handleLogCookedMeal}
          saving={saving}
        />
      )}

      <AssignMealModal
        visible={assignModalVisible}
        onClose={() => setAssignModalVisible(false)}
        inventory={inventory}
        onSave={handleAssignMeal}
        saving={saving}
      />

      {copyMealTarget && (
        <CopyTargetModal
          title={`Copy ${copyMealTarget.title} to…`}
          targets={copyTargetsFor(copyMealTarget.date)}
          saving={saving}
          onClose={() => setCopyMealTarget(null)}
          onConfirm={handleCopyMeal}
        />
      )}
    </View>
  );
}

// ─── MealSlot sub-component ───────────────────────────────────

function MealSlot({
  label,
  plan,
  recipe,
  onToggleConsumed,
  onRemove,
  onCopy,
  onAssign,
}: {
  label: string;
  plan: WeeklyMealPlanItem | undefined;
  recipe: Recipe | null;
  onToggleConsumed: (id: number, current: boolean) => void;
  onRemove: (id: number) => void;
  onCopy: (id: number, title: string) => void;
  onAssign: () => void;
}) {
  const confirmRemove = (planId: number, eaten: boolean, refunds: boolean) => {
    let message = 'Remove this meal from your plan?';
    if (eaten) {
      message = refunds
        ? 'This portion will go back to your inventory and the meal will be removed from your nutrition history.'
        : 'This meal will be removed from your nutrition history.';
    }
    Alert.alert(
      'Remove meal',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => onRemove(planId) },
      ]
    );
  };

  const subtitle = recipe
    ? `${recipe.calories} kcal · ${recipe.protein}g protein`
    : undefined;

  return (
    <View style={styles.mealSlot}>
      <Text style={styles.mealTypeLabel}>{label}</Text>
      {plan ? (
        <View style={styles.assignedRow}>
          <IconChip
            icon={
              <Ionicons
                name={label === 'Lunch' ? 'nutrition-outline' : 'restaurant-outline'}
                size={18}
                color={iconChipIconColor('clay')}
              />
            }
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
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => onCopy(plan.id, recipe?.title ?? label)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${recipe?.title ?? label} to…`}
          >
            <Ionicons name="copy-outline" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => confirmRemove(plan.id, plan.is_consumed, plan.consumed_from_inventory_id != null)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${recipe?.title ?? label} from plan`}
          >
            <Ionicons name="close" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
          <CircleCheck
            checked={plan.is_consumed}
            onToggle={() => onToggleConsumed(plan.id, plan.is_consumed)}
            accessibilityLabel={`Mark ${recipe?.title ?? label} ${plan.is_consumed ? 'not consumed' : 'consumed'}`}
          />
        </View>
      ) : (
        <View style={styles.assignBtnWrap}>
          <TouchableOpacity
            style={styles.assignBtn}
            onPress={onAssign}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Assign recipe to ${label}`}
          >
            <Text style={styles.assignBtnText}>Assign</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Copy chooser ─────────────────────────────────────────────

interface CopyTarget {
  date: string;
  label: string;
}

function copyTargetsFor(sourceDate: string): CopyTarget[] {
  const todayStr = toISODate();
  const targets: CopyTarget[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysKey(todayStr, i);
    if (date === sourceDate) continue;
    const [y, mo, dy] = date.split('-').map(Number);
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : new Date(y, mo - 1, dy).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
    targets.push({ date, label });
  }
  return targets;
}

function CopyTargetModal({ title, targets, saving, onClose, onConfirm }: {
  title: string;
  targets: CopyTarget[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (dates: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);

  const toggle = (date: string) =>
    setChosen((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));

  const orderedChoice = targets.filter((t) => chosen.includes(t.date)).map((t) => t.date);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>{title}</Text>

          <FlatList
            style={styles.modalList}
            data={targets}
            keyExtractor={(t) => t.date}
            renderItem={({ item }) => {
              const isSelected = chosen.includes(item.date);
              return (
                <TouchableOpacity
                  style={[styles.recipeOpt, isSelected && styles.recipeOptSelected]}
                  onPress={() => toggle(item.date)}
                  disabled={saving}
                  activeOpacity={0.75}
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.label}
                  accessibilityState={{ checked: isSelected }}
                >
                  <Text style={[styles.recipeOptText, isSelected && styles.recipeOptTextSelected]}>
                    {item.label}
                  </Text>
                  {isSelected && <View style={styles.recipeCheckDot} />}
                </TouchableOpacity>
              );
            }}
          />

          <View style={styles.modalBtnRow}>
            <Button title="Cancel" variant="ghost" onPress={onClose} style={styles.modalBtnHalf} />
            <Button
              title="Copy"
              variant="primary"
              onPress={() => onConfirm(orderedChoice)}
              disabled={orderedChoice.length === 0 || saving}
              style={styles.modalBtnHalf}
            />
          </View>
        </View>
      </View>
    </Modal>
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

function LogMealModal({ visible, onClose, recipes, onSave, saving }: {
  visible: boolean;
  onClose: () => void;
  recipes: Recipe[];
  onSave: (recipe_id: string, portions: number) => void;
  saving: boolean;
}) {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [portions, setPortions] = useState('4');

  // Portions are whole meals: "2.5"/"2,5" don't make sense here, so only
  // integers 1–50 are valid. The parent mounts this component
  // only while `visible`, so this state is fresh on every open — no reset
  // effect needed.
  const trimmedPortions = portions.trim();
  const parsedPortions = Number(trimmedPortions.replace(',', '.'));
  const isPortionsValid =
    Number.isInteger(parsedPortions) && parsedPortions >= 1 && parsedPortions <= 50;
  const showPortionsError = trimmedPortions.length > 0 && !isPortionsValid;
  const canSave = !!selectedRecipeId && isPortionsValid;

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
              accessibilityLabel="Portions cooked"
            />
          </View>
          {showPortionsError && (
            <Text style={styles.portionsError}>Enter 1–50 portions</Text>
          )}

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
              onPress={() => {
                if (selectedRecipeId && isPortionsValid) {
                  onSave(selectedRecipeId, parsedPortions);
                }
              }}
              disabled={!canSave || saving}
              style={styles.modalBtnHalf}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Assign Meal Modal ────────────────────────────────────────

function AssignMealModal({ visible, onClose, inventory, onSave, saving }: {
  visible: boolean;
  onClose: () => void;
  inventory: MealInventoryWithRecipe[];
  onSave: (recipe_id: string) => void;
  saving: boolean;
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
                  disabled={saving}
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
  copyBtn: {
    padding: Spacing.xs,
  },
  removeBtn: {
    padding: Spacing.xs,
    marginRight: Spacing.sm,
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

  // ── Loading state ──────────────────────────────────────────
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Spacing.xxl,
  },
  loadingText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },

  // ── Load error ─────────────────────────────────────────────
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  errorRetry: {
    marginTop: Spacing.md,
  },

  refreshBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.clayTint,
    borderRadius: Radius.md,
  },
  refreshBannerText: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.clayDeep,
  },
  refreshBannerRetry: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
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
  portionsError: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.danger,
    textAlign: 'right',
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
