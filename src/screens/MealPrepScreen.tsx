import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// ─── Component Helpers ────────────────────────────────────────

const logDbError = (err: any) => console.error('[MealPrepScreen] DB Error:', err);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ─── Main Screen ─────────────────────────────────────────────

export default function MealPrepScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'weekly' | 'inventory'>('weekly');

  // State
  const [inventory, setInventory] = useState<MealInventoryWithRecipe[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyMealPlanItem[]>([]);
  
  // Loading
  const [loading, setLoading] = useState(true);

  // Modals state
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ date: string; meal_type: string } | null>(null);

  // Recipes cache for logging
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

  // ─── Actions ───────────────────────────────────────────────

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

  // ─── Renders ───────────────────────────────────────────────

  const renderInventoryTab = () => (
    <ScrollView style={styles.tabContainer} contentContainerStyle={styles.scrollContent}>
      <TouchableOpacity style={styles.actionButton} onPress={() => setLogModalVisible(true)}>
        <Text style={styles.actionButtonText}>+ Log Cooked Meal</Text>
      </TouchableOpacity>

      {inventory.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Your inventory is empty.</Text>
          <Text style={styles.emptyStateSub}>Cook and log a meal to see it here!</Text>
        </View>
      ) : (
        inventory.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.recipe.title}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.portions_available}x portions</Text>
              </View>
            </View>
            <View style={styles.macroRow}>
              <Text style={styles.macroText}>Calories: {item.recipe.calories}</Text>
              <Text style={styles.macroText}>Protein: {item.recipe.protein}g</Text>
              <Text style={styles.macroText}>Carbs: {item.recipe.carbs}g</Text>
              <Text style={styles.macroText}>Fat: {item.recipe.fat}g</Text>
            </View>
            <Text style={styles.dateText}>Cooked on {item.date_cooked}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );

  const renderWeeklyTab = () => {
    const today = new Date();
    const days = Array.from({ length: 7 }).map((_, i) => addDays(today, i));

    return (
      <ScrollView style={styles.tabContainer} contentContainerStyle={styles.scrollContent}>
        {days.map((dateObj) => {
          const dateStr = toISODate(dateObj);
          const lunchPlan = weeklyPlan.find(p => p.date === dateStr && p.meal_type === 'Lunch');
          const dinnerPlan = weeklyPlan.find(p => p.date === dateStr && p.meal_type === 'Dinner');

          // Mapping recipe info
          const lunchRecipe = lunchPlan ? recipes.find(r => r.id === lunchPlan.recipe_id) : null;
          const dinnerRecipe = dinnerPlan ? recipes.find(r => r.id === dinnerPlan.recipe_id) : null;

          return (
            <View key={dateStr} style={styles.dayBlock}>
              <Text style={styles.dayTitle}>
                {dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </Text>

              {/* Lunch Slot */}
              <View style={styles.mealSlot}>
                <Text style={styles.mealType}>Lunch</Text>
                {lunchPlan ? (
                  <View style={styles.assignedMeal}>
                    <TouchableOpacity
                      style={styles.checkbox}
                      onPress={() => handleToggleConsumed(lunchPlan.id, lunchPlan.is_consumed)}
                    >
                      <View style={[styles.checkboxInner, lunchPlan.is_consumed && styles.checkboxChecked]} />
                    </TouchableOpacity>
                    <Text style={[styles.assignedTitle, lunchPlan.is_consumed && styles.struckText]}>
                      {lunchRecipe?.title || 'Unknown Recipe'}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.assignButton}
                    onPress={() => { setAssignTarget({ date: dateStr, meal_type: 'Lunch' }); setAssignModalVisible(true); }}
                  >
                    <Text style={styles.assignButtonText}>Assign Meal</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Dinner Slot */}
              <View style={styles.mealSlot}>
                <Text style={styles.mealType}>Dinner</Text>
                {dinnerPlan ? (
                  <View style={styles.assignedMeal}>
                    <TouchableOpacity
                      style={styles.checkbox}
                      onPress={() => handleToggleConsumed(dinnerPlan.id, dinnerPlan.is_consumed)}
                    >
                      <View style={[styles.checkboxInner, dinnerPlan.is_consumed && styles.checkboxChecked]} />
                    </TouchableOpacity>
                    <Text style={[styles.assignedTitle, dinnerPlan.is_consumed && styles.struckText]}>
                      {dinnerRecipe?.title || 'Unknown Recipe'}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.assignButton}
                    onPress={() => { setAssignTarget({ date: dateStr, meal_type: 'Dinner' }); setAssignModalVisible(true); }}
                  >
                    <Text style={styles.assignButtonText}>Assign Meal</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Planner & Inventory</Text>
        
        <View style={styles.tabSwitcher}>
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'weekly' && styles.tabPillActive]}
            onPress={() => setActiveTab('weekly')}
          >
            <Text style={[styles.tabPillText, activeTab === 'weekly' && styles.tabPillTextActive]}>
              📅 Weekly Plan
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'inventory' && styles.tabPillActive]}
            onPress={() => setActiveTab('inventory')}
          >
            <Text style={[styles.tabPillText, activeTab === 'inventory' && styles.tabPillTextActive]}>
              📦 My Inventory
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {activeTab === 'weekly' ? renderWeeklyTab() : renderInventoryTab()}

      {/* Log Modal */}
      <LogMealModal 
        visible={logModalVisible} 
        onClose={() => setLogModalVisible(false)} 
        recipes={recipes}
        onSave={handleLogCookedMeal}
      />

      {/* Assign Modal */}
      <AssignMealModal
        visible={assignModalVisible}
        onClose={() => setAssignModalVisible(false)}
        inventory={inventory}
        onSave={handleAssignMeal}
      />
    </View>
  );
}

// ─── Log Meal Modal ──────────────────────────────────────────

function LogMealModal({ visible, onClose, recipes, onSave }: any) {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [portions, setPortions] = useState('4');

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Log Cooked Meal</Text>
          <Text style={styles.modalSubtitle}>Select what you just cooked:</Text>

          <FlatList
            style={{ maxHeight: 250, marginBottom: 16 }}
            data={recipes}
            keyExtractor={(r: any) => r.id}
            renderItem={({ item }) => {
              const isSelected = selectedRecipeId === item.id;
              return (
                <TouchableOpacity
                  style={[styles.recipeSelectOpt, isSelected && styles.recipeSelectOptActive]}
                  onPress={() => setSelectedRecipeId(item.id)}
                >
                  <Text style={[styles.recipeSelectText, isSelected && styles.recipeSelectTextActive]}>
                    {item.title}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          <View style={styles.inputRow}>
            <Text style={{ color: Colors.textPrimary }}>Portions Cooked:</Text>
            <TextInput
              style={styles.numericInput}
              keyboardType="number-pad"
              value={portions}
              onChangeText={setPortions}
            />
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modalBtnSave, !selectedRecipeId && { opacity: 0.5 }]} 
              onPress={() => selectedRecipeId && onSave(selectedRecipeId, parseInt(portions, 10) || 0)}
              disabled={!selectedRecipeId}
            >
              <Text style={styles.modalBtnTextSave}>Save Logs</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Assign Meal Modal ───────────────────────────────────────

function AssignMealModal({ visible, onClose, inventory, onSave }: any) {
  if (!visible) return null;

  const validInventory = inventory.filter((item: any) => item.portions_available > 0);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Assign Meal from Inventory</Text>
          
          {validInventory.length === 0 ? (
            <Text style={styles.emptyStateText}>No inventory. Please cook first!</Text>
          ) : (
            <FlatList
              style={{ maxHeight: 300, marginVertical: 16 }}
              data={validInventory}
              keyExtractor={(r: any) => r.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.recipeSelectOpt}
                  onPress={() => onSave(item.recipe_id)}
                >
                  <Text style={styles.recipeSelectText}>{item.recipe.title}</Text>
                  <Text style={{ color: Colors.accent, fontSize: 12 }}>({item.portions_available}x portions left)</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
            <Text style={styles.modalBtnTextCancel}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    padding: 4,
    gap: 2,
  },
  tabPill: {
    flex: 1,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    alignItems: 'center',
  },
  tabPillActive: { backgroundColor: Colors.accent },
  tabPillText: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.semibold,
  },
  tabPillTextActive: { color: Colors.background },
  
  tabContainer: { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md },

  // Inventory Card
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.xs,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: Typography.sizes.md, color: Colors.textPrimary, fontWeight: Typography.weights.bold, flex: 1 },
  badge: { backgroundColor: Colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { color: Colors.background, fontSize: Typography.sizes.xs, fontWeight: Typography.weights.bold },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  macroText: { fontSize: Typography.sizes.xs, color: Colors.textSecondary },
  dateText: { fontSize: 10, color: Colors.textMuted, marginTop: 4, fontStyle: 'italic' },

  actionButton: {
    backgroundColor: Colors.accent,
    padding: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  actionButtonText: { color: Colors.background, fontSize: Typography.sizes.md, fontWeight: Typography.weights.bold },

  emptyState: { alignItems: 'center', marginTop: 40, gap: 8 },
  emptyStateText: { color: Colors.textPrimary, fontSize: Typography.sizes.md, fontWeight: Typography.weights.semibold },
  emptyStateSub: { color: Colors.textSecondary, fontSize: Typography.sizes.sm },

  // Weekly blocks
  dayBlock: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  dayTitle: { fontSize: Typography.sizes.md, color: Colors.textPrimary, fontWeight: Typography.weights.bold, marginBottom: Spacing.sm },
  mealSlot: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  mealType: { fontSize: Typography.sizes.sm, color: Colors.textSecondary, width: 60, fontWeight: Typography.weights.semibold },
  
  assignedMeal: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkbox: { 
    width: 20, height: 20, 
    borderRadius: 4, 
    borderWidth: 2, 
    borderColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center'
  },
  checkboxInner: { width: 12, height: 12, borderRadius: 2 },
  checkboxChecked: { backgroundColor: Colors.accent },
  assignedTitle: { fontSize: Typography.sizes.sm, color: Colors.textPrimary, flex: 1 },
  struckText: { textDecorationLine: 'line-through', color: Colors.textMuted },
  
  assignButton: { 
    paddingHorizontal: Spacing.sm, 
    paddingVertical: 4, 
    borderWidth: 1, 
    borderColor: Colors.accent, 
    borderRadius: Radius.sm 
  },
  assignButtonText: { color: Colors.accent, fontSize: Typography.sizes.xs },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, elevation: 5 },
  modalTitle: { fontSize: Typography.sizes.lg, color: Colors.textPrimary, fontWeight: Typography.weights.bold, marginBottom: 4 },
  modalSubtitle: { fontSize: Typography.sizes.sm, color: Colors.textSecondary, marginBottom: 16 },
  
  recipeSelectOpt: { padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recipeSelectOptActive: { backgroundColor: Colors.surfaceElevated },
  recipeSelectText: { color: Colors.textPrimary, fontSize: Typography.sizes.sm },
  recipeSelectTextActive: { color: Colors.accent, fontWeight: Typography.weights.bold },
  
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 16 },
  numericInput: { backgroundColor: Colors.background, color: Colors.textPrimary, padding: 8, borderRadius: Radius.sm, width: 80, textAlign: 'center' },

  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  modalBtnCancel: { flex: 1, padding: Spacing.md, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  modalBtnTextCancel: { color: Colors.textPrimary, fontWeight: Typography.weights.semibold },
  modalBtnSave: { flex: 1, padding: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.accent, alignItems: 'center' },
  modalBtnTextSave: { color: Colors.background, fontWeight: Typography.weights.bold },
});
