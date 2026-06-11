/**
 * RecipeEditorScreen.tsx
 *
 * Single screen for both CREATE and EDIT modes:
 *   - No recipeId param  → create mode (empty form, custom-<timestamp> id)
 *   - recipeId param     → edit mode (prefilled from recipe_library)
 *
 * Live macro preview is computed from the current ingredient list using
 * the same engine as the import pipeline:
 *   computeRecipeMacros() (local NUTRITION_TABLE) + lookupNutrition() (OFF).
 *
 * Styling: Verdure design system only — tokens from src/theme/tokens.ts.
 * No raw hex, no magic numbers. Outline Ionicons only.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  createRecipe,
  getRecipeById,
  getRecipeCategories,
  isSeededRecipe,
  Recipe,
  RecipeIngredient,
  updateRecipe,
} from '../db/database';
import { computeRecipeMacros, ComputeIngredient } from '../nutrition/computeMacros';
import { lookupNutrition } from '../api/openfoodfacts';
import { normaliseIngredientName } from '../nutrition/units';
import { NUTRITION_TABLE } from '../nutrition/nutritionTable';
import { Card, Button, ScreenHeader } from '../components';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Mutable row in the ingredient editor list. */
interface IngredientRow {
  key: string;        // local React key (UUID-ish)
  name: string;
  quantity: string;   // string so TextInput can show partial input
  unit: string;
}

interface ComputedMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['g', 'ml', 'whole', 'tsp', 'tbsp', 'cup', 'oz', 'clove', 'slice', 'pinch'];

const KNOWN_CATEGORIES = [
  'Fresh & Fridge',
  'Quick Cook',
  'Freezer Batch',
  'Freezer Sauce',
  'Imported',
];

const DEFAULT_SERVINGS = '4';
const DEFAULT_PREP = '30';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _rowCounter = 0;
function newKey(): string {
  return `row-${Date.now()}-${++_rowCounter}`;
}

function rowsToIngredients(rows: IngredientRow[]): RecipeIngredient[] {
  return rows
    .filter((r) => r.name.trim() !== '' && parseFloat(r.quantity) > 0)
    .map((r) => ({
      name: r.name.trim(),
      baseQuantity: parseFloat(r.quantity) || 0,
      unit: r.unit,
    }));
}

function ingredientsToRows(ingredients: RecipeIngredient[]): IngredientRow[] {
  return ingredients.map((ing) => ({
    key: newKey(),
    name: ing.name,
    quantity: String(ing.baseQuantity),
    unit: ing.unit,
  }));
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecipeEditorScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { recipeId } = route.params ?? {};
  const isEdit = Boolean(recipeId);

  // ── Form state ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Fresh & Fridge');
  const [customCategory, setCustomCategory] = useState('');
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [servings, setServings] = useState(DEFAULT_SERVINGS);
  const [prepTime, setPrepTime] = useState(DEFAULT_PREP);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { key: newKey(), name: '', quantity: '', unit: 'g' },
  ]);
  const [instructions, setInstructions] = useState('');
  const [freezerTips, setFreezerTips] = useState('');

  // ── Category picker state ─────────────────────────────────────────────────
  const [categories, setCategories] = useState<string[]>(KNOWN_CATEGORIES);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // ── Macro preview state ───────────────────────────────────────────────────
  const [macros, setMacros] = useState<ComputedMacros | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [estimatedIngredients, setEstimatedIngredients] = useState<string[]>([]);

  // ── Loading / saving state ────────────────────────────────────────────────
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load existing recipe in edit mode ────────────────────────────────────

  useEffect(() => {
    if (isEdit) {
      loadRecipe();
    }
    loadCategories();
  }, []);

  const loadRecipe = async () => {
    try {
      const data = await getRecipeById(recipeId);
      if (!data) {
        Alert.alert('Error', 'Recipe not found.');
        navigation.goBack();
        return;
      }
      setTitle(data.title);
      setServings(String(data.defaultServings));
      setPrepTime(String(data.prepTimeMinutes));
      setInstructions(data.instructions ?? '');
      setFreezerTips(data.freezerTips ?? '');
      setIngredients(
        data.ingredients.length > 0
          ? ingredientsToRows(data.ingredients)
          : [{ key: newKey(), name: '', quantity: '', unit: 'g' }],
      );

      // Category
      if (KNOWN_CATEGORIES.includes(data.category)) {
        setCategory(data.category);
        setShowCustomCategory(false);
      } else {
        setCategory('__custom__');
        setCustomCategory(data.category);
        setShowCustomCategory(true);
      }
    } catch {
      Alert.alert('Error', 'Failed to load recipe.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const dbCats = await getRecipeCategories();
      // Merge with known categories, deduplicate, keep order
      const merged = Array.from(new Set([...KNOWN_CATEGORIES, ...dbCats]));
      setCategories(merged);
    } catch {
      // Non-fatal — use default list
    }
  };

  // ── Live macro recompute ──────────────────────────────────────────────────

  const scheduleMacroRecompute = useCallback(() => {
    if (recomputeTimer.current) {
      clearTimeout(recomputeTimer.current);
    }
    recomputeTimer.current = setTimeout(() => {
      recomputeMacros();
    }, 600);
  }, [ingredients, servings]);

  useEffect(() => {
    scheduleMacroRecompute();
    return () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    };
  }, [ingredients, servings]);

  const recomputeMacros = async () => {
    const validIngredients = rowsToIngredients(ingredients);
    if (validIngredients.length === 0) {
      setMacros(null);
      setEstimatedIngredients([]);
      return;
    }

    const numServings = Math.max(1, parseInt(servings, 10) || 1);

    setMacroLoading(true);
    try {
      // Build OFF overrides for ingredients not in local table
      const offOverrides: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = {};
      const needsOFF = validIngredients.filter((ing) => {
        const key = normaliseIngredientName(ing.name);
        return !NUTRITION_TABLE[key];
      });

      for (const ing of needsOFF) {
        try {
          const nutrition = await lookupNutrition(ing.name);
          if (nutrition) {
            const key = normaliseIngredientName(ing.name);
            offOverrides[key] = nutrition;
            offOverrides[ing.name.toLowerCase()] = nutrition;
          }
        } catch {
          // OFF call failed — ingredient will be estimated
        }
      }

      const computeIngredients: ComputeIngredient[] = validIngredients.map((i) => ({
        name: i.name,
        baseQuantity: i.baseQuantity,
        unit: i.unit,
      }));

      const result = computeRecipeMacros(
        computeIngredients,
        numServings,
        Object.keys(offOverrides).length > 0 ? offOverrides : undefined,
      );

      setMacros(result.macros);
      setEstimatedIngredients(result.unmatchedIngredients);
    } catch {
      // Leave previous macros displayed if recompute throws
    } finally {
      setMacroLoading(false);
    }
  };

  // ── Ingredient list mutations ─────────────────────────────────────────────

  const updateIngredient = (key: string, field: keyof IngredientRow, value: string) => {
    setIngredients((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  };

  const addIngredient = () => {
    setIngredients((prev) => [...prev, { key: newKey(), name: '', quantity: '', unit: 'g' }]);
  };

  const removeIngredient = (key: string) => {
    setIngredients((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length > 0 ? next : [{ key: newKey(), name: '', quantity: '', unit: 'g' }];
    });
  };

  // ── Unit cycling (tap to cycle through options) ───────────────────────────

  const cycleUnit = (key: string, currentUnit: string) => {
    const idx = UNIT_OPTIONS.indexOf(currentUnit);
    const next = UNIT_OPTIONS[(idx + 1) % UNIT_OPTIONS.length];
    updateIngredient(key, 'unit', next);
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    // Validation
    if (!title.trim()) {
      Alert.alert('Validation', 'Please enter a recipe title.');
      return;
    }

    const validIngredients = rowsToIngredients(ingredients);
    if (validIngredients.length === 0) {
      Alert.alert('Validation', 'Please add at least one ingredient with a quantity.');
      return;
    }

    const numServings = Math.max(1, parseInt(servings, 10) || 1);
    const numPrepTime = Math.max(0, parseInt(prepTime, 10) || 0);

    const resolvedCategory = showCustomCategory && customCategory.trim()
      ? customCategory.trim()
      : category;

    // Compute final macros synchronously for the saved recipe
    let finalMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    if (macros) {
      finalMacros = macros;
    } else {
      const result = computeRecipeMacros(
        validIngredients.map((i) => ({ name: i.name, baseQuantity: i.baseQuantity, unit: i.unit })),
        numServings,
      );
      finalMacros = result.macros;
    }

    const recipe: Recipe = {
      id: isEdit ? recipeId : `custom-${Date.now()}`,
      title: title.trim(),
      category: resolvedCategory,
      calories: finalMacros.calories,
      protein: finalMacros.protein,
      carbs: finalMacros.carbs,
      fat: finalMacros.fat,
      prepTimeMinutes: numPrepTime,
      defaultServings: numServings,
      ingredients: validIngredients,
      instructions: instructions.trim(),
      freezerTips: freezerTips.trim(),
    };

    setSaving(true);
    try {
      if (isEdit) {
        await updateRecipe(recipe);
        navigation.goBack();
      } else {
        await createRecipe(recipe);
        // Navigate to the new recipe's detail screen
        navigation.replace('RecipeDetail', { recipeId: recipe.id });
      }
    } catch {
      Alert.alert('Error', 'Failed to save recipe. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={Colors.sage} />
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const effectiveCategory = showCustomCategory ? '__custom__' : category;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title={isEdit ? 'Edit Recipe' : 'New Recipe'}
          style={styles.header}
        />

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TITLE</Text>
          <Card style={styles.fieldCard}>
            <TextInput
              style={styles.textInput}
              placeholder="Recipe name"
              placeholderTextColor={Colors.textMuted}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
              maxLength={120}
            />
          </Card>
        </View>

        {/* ── Category ───────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <Card style={styles.fieldCard}>
            <TouchableOpacity
              style={styles.pickerRow}
              onPress={() => setShowCategoryPicker((v) => !v)}
              activeOpacity={0.75}
            >
              <Text style={styles.pickerValue}>
                {showCustomCategory
                  ? (customCategory.trim() || 'Custom category')
                  : category}
              </Text>
              <Ionicons
                name={showCategoryPicker ? 'chevron-up-outline' : 'chevron-down-outline'}
                size={16}
                color={Colors.textMuted}
              />
            </TouchableOpacity>

            {showCategoryPicker && (
              <View style={styles.pickerOptions}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.pickerOption,
                      effectiveCategory === cat && styles.pickerOptionActive,
                    ]}
                    onPress={() => {
                      setCategory(cat);
                      setShowCustomCategory(false);
                      setShowCategoryPicker(false);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        effectiveCategory === cat && styles.pickerOptionTextActive,
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
                {/* Custom entry */}
                <TouchableOpacity
                  style={[
                    styles.pickerOption,
                    showCustomCategory && styles.pickerOptionActive,
                  ]}
                  onPress={() => {
                    setShowCustomCategory(true);
                    setShowCategoryPicker(false);
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      showCustomCategory && styles.pickerOptionTextActive,
                    ]}
                  >
                    Custom...
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {showCustomCategory && (
              <TextInput
                style={[styles.textInput, styles.customCategoryInput]}
                placeholder="Enter custom category"
                placeholderTextColor={Colors.textMuted}
                value={customCategory}
                onChangeText={setCustomCategory}
                returnKeyType="done"
                maxLength={60}
              />
            )}
          </Card>
        </View>

        {/* ── Servings + Prep Time ───────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SERVINGS &amp; PREP TIME</Text>
          <View style={styles.rowTwo}>
            <Card style={[styles.fieldCard, styles.halfCard]}>
              <Text style={styles.fieldLabel}>Default Servings</Text>
              <TextInput
                style={styles.numberInput}
                placeholder="4"
                placeholderTextColor={Colors.textMuted}
                value={servings}
                onChangeText={setServings}
                keyboardType="numeric"
                returnKeyType="next"
                maxLength={3}
              />
            </Card>
            <Card style={[styles.fieldCard, styles.halfCard]}>
              <Text style={styles.fieldLabel}>Prep Time (min)</Text>
              <TextInput
                style={styles.numberInput}
                placeholder="30"
                placeholderTextColor={Colors.textMuted}
                value={prepTime}
                onChangeText={setPrepTime}
                keyboardType="numeric"
                returnKeyType="next"
                maxLength={4}
              />
            </Card>
          </View>
        </View>

        {/* ── Ingredients ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INGREDIENTS</Text>
          <Card style={styles.ingredientsCard}>
            {ingredients.map((row, idx) => (
              <View key={row.key}>
                {idx > 0 && <View style={styles.rowDivider} />}
                <IngredientEditorRow
                  row={row}
                  onChangeName={(v) => updateIngredient(row.key, 'name', v)}
                  onChangeQuantity={(v) => updateIngredient(row.key, 'quantity', v)}
                  onCycleUnit={() => cycleUnit(row.key, row.unit)}
                  onRemove={() => removeIngredient(row.key)}
                  showRemove={ingredients.length > 1}
                />
              </View>
            ))}

            <TouchableOpacity
              style={styles.addIngredientBtn}
              onPress={addIngredient}
              activeOpacity={0.75}
            >
              <Ionicons name="add-circle-outline" size={18} color={Colors.sage} />
              <Text style={styles.addIngredientText}>Add ingredient</Text>
            </TouchableOpacity>
          </Card>
        </View>

        {/* ── Live Macro Preview ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MACROS PER SERVING (ESTIMATED)</Text>
          <Card style={styles.macroCard}>
            {macroLoading ? (
              <View style={styles.macroLoading}>
                <ActivityIndicator size="small" color={Colors.sage} />
                <Text style={styles.macroLoadingText}>Computing…</Text>
              </View>
            ) : macros ? (
              <View style={styles.macroRow}>
                <MacroChip value={String(macros.calories)} label="kcal" />
                <View style={styles.macroDivider} />
                <MacroChip value={`${macros.protein}g`} label="Protein" />
                <View style={styles.macroDivider} />
                <MacroChip value={`${macros.carbs}g`} label="Carbs" />
                <View style={styles.macroDivider} />
                <MacroChip value={`${macros.fat}g`} label="Fat" />
              </View>
            ) : (
              <Text style={styles.macroEmpty}>
                Add ingredients with quantities to see macros.
              </Text>
            )}
            {estimatedIngredients.length > 0 && (
              <View style={styles.estimatedBanner}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.goldDeep} />
                <Text style={styles.estimatedText}>
                  Estimated (no data):{' '}
                  {estimatedIngredients.join(', ')}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.recomputeBtn}
              onPress={recomputeMacros}
              activeOpacity={0.75}
            >
              <Ionicons name="refresh-outline" size={14} color={Colors.sageDeep} />
              <Text style={styles.recomputeText}>Recompute</Text>
            </TouchableOpacity>
          </Card>
        </View>

        {/* ── Instructions ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INSTRUCTIONS</Text>
          <Card style={styles.fieldCard}>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Describe the cooking steps. Each new line becomes a numbered step."
              placeholderTextColor={Colors.textMuted}
              value={instructions}
              onChangeText={setInstructions}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
            />
          </Card>
        </View>

        {/* ── Freezer Tips ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FREEZER TIPS (OPTIONAL)</Text>
          <Card style={styles.fieldCard}>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Any notes for freezing and reheating"
              placeholderTextColor={Colors.textMuted}
              value={freezerTips}
              onChangeText={setFreezerTips}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
            />
          </Card>
        </View>

        {/* ── Save button ────────────────────────────────────────────────── */}
        <View style={styles.actionsSection}>
          <Button
            title={saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Recipe'}
            variant="primary"
            onPress={handleSave}
            disabled={saving}
          />
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => navigation.goBack()}
            disabled={saving}
          />
        </View>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface IngredientEditorRowProps {
  row: IngredientRow;
  onChangeName: (v: string) => void;
  onChangeQuantity: (v: string) => void;
  onCycleUnit: () => void;
  onRemove: () => void;
  showRemove: boolean;
}

function IngredientEditorRow({
  row,
  onChangeName,
  onChangeQuantity,
  onCycleUnit,
  onRemove,
  showRemove,
}: IngredientEditorRowProps) {
  return (
    <View style={styles.ingredientRow}>
      {/* Name */}
      <TextInput
        style={[styles.textInput, styles.ingredientName]}
        placeholder="Ingredient name"
        placeholderTextColor={Colors.textMuted}
        value={row.name}
        onChangeText={onChangeName}
        returnKeyType="next"
      />
      {/* Quantity */}
      <TextInput
        style={[styles.textInput, styles.ingredientQty]}
        placeholder="Qty"
        placeholderTextColor={Colors.textMuted}
        value={row.quantity}
        onChangeText={onChangeQuantity}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />
      {/* Unit — tap to cycle */}
      <TouchableOpacity
        style={styles.unitChip}
        onPress={onCycleUnit}
        activeOpacity={0.75}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <Text style={styles.unitChipText}>{row.unit}</Text>
      </TouchableOpacity>
      {/* Remove */}
      {showRemove && (
        <TouchableOpacity
          onPress={onRemove}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle-outline" size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

interface MacroChipProps {
  value: string;
  label: string;
}

function MacroChip({ value, label }: MacroChipProps) {
  return (
    <View style={styles.macroChip}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  centred: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },

  // ── Section ───────────────────────────────────────────────────────────────
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },

  // ── Cards & inputs ────────────────────────────────────────────────────────
  fieldCard: {
    padding: Spacing.md,
  },
  halfCard: {
    flex: 1,
  },
  rowTwo: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  fieldLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs - 1,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
  },
  textInput: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    paddingVertical: Spacing.xs,
  },
  numberInput: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.4,
    paddingVertical: Spacing.xs,
  },
  multilineInput: {
    minHeight: 100,
    lineHeight: Typography.sizes.sm * 1.55,
  },

  // ── Category picker ───────────────────────────────────────────────────────
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  pickerValue: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    flex: 1,
  },
  pickerOptions: {
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  pickerOption: {
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pickerOptionActive: {
    backgroundColor: Colors.sageTint,
  },
  pickerOptionText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },
  pickerOptionTextActive: {
    color: Colors.sageDeep,
    fontFamily: Typography.title,
  },
  customCategoryInput: {
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },

  // ── Ingredients ───────────────────────────────────────────────────────────
  ingredientsCard: {
    padding: Spacing.md,
    gap: 0,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  ingredientName: {
    flex: 1,
  },
  ingredientQty: {
    width: 56,
    textAlign: 'right',
  },
  unitChip: {
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    minWidth: 44,
    alignItems: 'center',
  },
  unitChipText: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    letterSpacing: 0.4,
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 0,
  },
  addIngredientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  addIngredientText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sage,
  },

  // ── Macro preview ─────────────────────────────────────────────────────────
  macroCard: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  macroLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  macroLoadingText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },
  macroRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  macroChip: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  macroValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.md,
    color: Colors.clayDeep,
    letterSpacing: -0.3,
  },
  macroLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs - 1,
    color: Colors.clay,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  macroDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  macroEmpty: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  estimatedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.goldTint,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  estimatedText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.goldDeep,
    flex: 1,
    lineHeight: Typography.sizes.xs * 1.5,
  },
  recomputeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-end',
  },
  recomputeText: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    letterSpacing: 0.4,
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  actionsSection: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
});
