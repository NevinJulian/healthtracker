import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { getRecipeById, Recipe, addShoppingListItem, insertCookingTask } from '../db/database';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Card, Row, IconChip, Button } from '../components';

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

  useEffect(() => {
    if (recipeId) {
      loadRecipe(recipeId);
    }
  }, [recipeId]);

  const loadRecipe = async (id: string) => {
    const data = await getRecipeById(id);
    if (data) {
      setRecipe(data);
      setServings(data.defaultServings);
    }
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
              icon={<Text style={styles.heroEmoji}>{'🍽'}</Text>}
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

        {/* ── Servings stepper (placeholder) ──────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SERVINGS TO COOK</Text>
          <View style={styles.stepperContainer}>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => setServings(Math.max(1, servings - 1))}
            >
              <Text style={styles.stepperButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{servings}</Text>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => setServings(servings + 1)}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Ingredients (placeholder) ────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INGREDIENTS</Text>
          {recipe.ingredients.map((ing, idx) => (
            <View key={idx} style={styles.ingredientRow}>
              <Text style={styles.ingredientName}>• {ing.name}</Text>
              <Text style={styles.ingredientAmount}>
                {getCalculatedQuantity(ing.baseQuantity).toFixed(1).replace(/\.0$/, '')} {ing.unit}
              </Text>
            </View>
          ))}
          <TouchableOpacity style={styles.addToCartButton} onPress={handleAddToShoppingList}>
            <Text style={styles.addToCartButtonText}>Add to Shopping List</Text>
          </TouchableOpacity>
        </View>

        {/* ── Instructions (placeholder) ───────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INSTRUCTIONS</Text>
          <Text style={styles.bodyText}>{recipe.instructions}</Text>
        </View>

        {recipe.freezerTips ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FREEZER TIPS</Text>
            <Text style={styles.bodyText}>{recipe.freezerTips}</Text>
          </View>
        ) : null}

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
  heroEmoji: {
    fontSize: 22,
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

  // ── Placeholder styles (will be replaced) ────────────────────────────────
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepperButton: {
    width: 40,
    height: 40,
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
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
    marginHorizontal: Spacing.xxl,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  ingredientName: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    flex: 1,
  },
  ingredientAmount: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },
  addToCartButton: {
    backgroundColor: Colors.sage,
    padding: Spacing.lg,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  addToCartButtonText: {
    fontFamily: Typography.title,
    color: Colors.surface,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  bodyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.sm * 1.55,
  },
});
