import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getRecipeById,
  Recipe,
  addShoppingListItem,
  insertCookingTask,
  deleteRecipe,
  isSeededRecipe,
} from '../db/database';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { Card, Row, IconChip, Button } from '../components';
import { iconChipIconColor } from '../components/IconChip';

// ─── Stat Chip ────────────────────────────────────────────────────────────────

/**
 * StatChip — a single macro/stat cell in the clay-tint accent row.
 * Value in Fraunces display, label in micro uppercase.
 */
function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecipeDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { recipeId } = route.params || {};

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [servings, setServings] = useState<number>(1);

  // Reload recipe when the screen regains focus (e.g. returning from editor)
  useFocusEffect(
    useCallback(() => {
      if (recipeId) {
        loadRecipe(recipeId);
      }
    }, [recipeId]),
  );

  const loadRecipe = async (id: string) => {
    const data = await getRecipeById(id);
    if (data) {
      setRecipe(data);
      setServings(data.defaultServings);
    }
  };

  const handleEdit = () => {
    navigation.navigate('RecipeEditor', { recipeId });
  };

  const handleDelete = () => {
    if (!recipe) return;
    Alert.alert(
      'Delete Recipe',
      `Are you sure you want to delete "${recipe.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRecipe(recipe.id);
              navigation.navigate('RecipesMain');
            } catch {
              Alert.alert('Error', 'Failed to delete recipe.');
            }
          },
        },
      ],
    );
  };

  const getCalculatedQuantity = (baseQuantity: number) => {
    if (!recipe) return baseQuantity;
    return (baseQuantity / recipe.defaultServings) * servings;
  };

  const handleAddToShoppingList = async () => {
    if (!recipe) return;
    try {
      for (const ing of recipe.ingredients) {
        const qty = getCalculatedQuantity(ing.baseQuantity);
        await addShoppingListItem(ing.name, qty, ing.unit);
      }
      await insertCookingTask(recipe.id, servings);
      Alert.alert(
        'Added!',
        `Ingredients added to Shopping List & ${servings} serving(s) added to Cooking Queue!`,
        [
          { text: 'View Queue', onPress: () => navigation.navigate('Cooking Tasks') },
          { text: 'OK', style: 'cancel' },
        ]
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to add ingredients');
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────

  if (!recipe) {
    return (
      <View style={styles.centred}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Split instructions into numbered steps if they contain newlines; otherwise
  // show as a single paragraph.
  const instructionSteps: string[] = recipe.instructions
    ? recipe.instructions
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero block ─────────────────────────────────────────────────── */}
        <Card style={styles.heroCard}>
          <View style={styles.heroInner}>
            <IconChip
              icon={<Ionicons name="restaurant-outline" size={24} color={iconChipIconColor('clay')} />}
              accent="clay"
              size={48}
            />
            <View style={styles.heroTextBlock}>
              <Text style={styles.heroTitle}>{recipe.title}</Text>
              <Text style={styles.heroCategory}>{recipe.category}</Text>
            </View>
          </View>

          {/* ── Stat row ───────────────────────────────────────────────── */}
          <View style={styles.statRow}>
            <StatChip value={String(recipe.calories)} label="kcal" />
            <View style={styles.statDivider} />
            <StatChip value={`${recipe.protein}g`} label="Protein" />
            <View style={styles.statDivider} />
            <StatChip value={`${recipe.carbs}g`} label="Carbs" />
            <View style={styles.statDivider} />
            <StatChip value={`${recipe.fat}g`} label="Fat" />
            {recipe.prepTimeMinutes ? (
              <>
                <View style={styles.statDivider} />
                <StatChip value={`${recipe.prepTimeMinutes}`} label="min" />
              </>
            ) : null}
          </View>
        </Card>

        {/* ── Servings stepper ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SERVINGS TO COOK</Text>
          <Card style={styles.stepperCard}>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setServings(Math.max(1, servings - 1))}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Decrease servings"
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <Text
                style={styles.stepperValue}
                accessible={true}
                accessibilityLabel={`${servings} serving${servings !== 1 ? 's' : ''}`}
              >
                {servings}
              </Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setServings(servings + 1)}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Increase servings"
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>

        {/* ── Ingredients ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INGREDIENTS</Text>
          <Card style={styles.listCard}>
            {recipe.ingredients.map((ing, idx) => (
              <React.Fragment key={idx}>
                <Row
                  title={ing.name}
                  trailing={
                    <Text style={styles.qtyText}>
                      {getCalculatedQuantity(ing.baseQuantity)
                        .toFixed(1)
                        .replace(/\.0$/, '')}{' '}
                      {ing.unit}
                    </Text>
                  }
                  style={styles.ingredientRow}
                />
                {idx < recipe.ingredients.length - 1 && (
                  <View style={styles.rowDivider} />
                )}
              </React.Fragment>
            ))}
          </Card>
        </View>

        {/* ── Instructions ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INSTRUCTIONS</Text>
          <Card style={styles.methodCard}>
            {instructionSteps.length > 1 ? (
              instructionSteps.map((step, idx) => (
                <View key={idx} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{idx + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.bodyText}>{recipe.instructions}</Text>
            )}
          </Card>
        </View>

        {/* ── Freezer Tips ──────────────────────────────────────────────── */}
        {recipe.freezerTips ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FREEZER TIPS</Text>
            <Card style={styles.tipCard}>
              <View style={styles.tipInner}>
                <IconChip
                  icon={<Ionicons name="snow-outline" size={18} color={iconChipIconColor('sky')} />}
                  accent="sky"
                  size={36}
                />
                <Text style={styles.tipText}>{recipe.freezerTips}</Text>
              </View>
            </Card>
          </View>
        ) : null}

        {/* ── Action buttons ────────────────────────────────────────────── */}
        <View style={styles.actionsSection}>
          <Button
            title="Add to Shopping List"
            variant="primary"
            onPress={handleAddToShoppingList}
          />
          <Button
            title="View Cooking Queue"
            variant="ghost"
            onPress={() => navigation.navigate('Cooking Tasks')}
          />

          {/* Edit/Delete row — always show Edit; Delete only for non-seeded recipes */}
          <View style={styles.editDeleteRow}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={handleEdit}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Edit recipe"
            >
              <Ionicons name="create-outline" size={16} color={Colors.sageDeep} importantForAccessibility="no-hide-descendants" />
              <Text style={styles.editBtnText}>Edit Recipe</Text>
            </TouchableOpacity>

            {!isSeededRecipe(recipe.id) && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={handleDelete}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Delete recipe"
              >
                <Ionicons name="trash-outline" size={16} color={Colors.danger} importantForAccessibility="no-hide-descendants" />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  },
  loadingText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    color: Colors.textMuted,
  },

  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.xl,
  },

  // ── Hero card ─────────────────────────────────────────────────────────────
  heroCard: {
    backgroundColor: Colors.clayTint,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  heroTextBlock: {
    flex: 1,
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.clayDeep,
    letterSpacing: -0.5,
    lineHeight: Typography.sizes.xl * 1.2,
  },
  heroCategory: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.clay,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },

  // ── Stat row ──────────────────────────────────────────────────────────────
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  statChip: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.md,
    color: Colors.clayDeep,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs - 1,
    color: Colors.clay,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },

  // ── Section label ─────────────────────────────────────────────────────────
  sectionLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  section: {
    gap: 0,
  },

  // ── Servings stepper ──────────────────────────────────────────────────────
  stepperCard: {
    padding: Spacing.md,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxl,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.sageTint,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xl,
    color: Colors.sageDeep,
    lineHeight: Typography.sizes.xl,
  },
  stepperValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xxl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    minWidth: 32,
    textAlign: 'center',
  },

  // ── Ingredients list ──────────────────────────────────────────────────────
  listCard: {
    padding: 0,
    overflow: 'hidden',
  },
  ingredientRow: {
    borderRadius: 0,
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.lg,
  },
  qtyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },

  // ── Method / instructions ─────────────────────────────────────────────────
  methodCard: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: Colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepNumberText: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.bold,
  },
  stepText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.sm * 1.55,
    flex: 1,
  },
  bodyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.sm * 1.55,
  },

  // ── Freezer tips ──────────────────────────────────────────────────────────
  tipCard: {
    backgroundColor: Colors.skyTint,
    padding: Spacing.lg,
  },
  tipInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  tipText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.skyDeep,
    lineHeight: Typography.sizes.sm * 1.55,
    flex: 1,
  },

  // ── Action buttons ────────────────────────────────────────────────────────
  actionsSection: {
    gap: Spacing.md,
  },

  // ── Edit / Delete row ─────────────────────────────────────────────────────
  editDeleteRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'center',
    paddingTop: Spacing.xs,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  editBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  deleteBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.danger,
  },
});
