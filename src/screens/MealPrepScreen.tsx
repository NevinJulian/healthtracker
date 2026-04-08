import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  LayoutAnimation,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROCERY_LIST, RECIPES, GroceryCategory, Recipe } from '../data/mealPrepData';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Accordion section ────────────────────────────────────────────────────────

function AccordionSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <View style={styles.accordion}>
      <TouchableOpacity style={styles.accordionHeader} onPress={toggle} activeOpacity={0.7}>
        <Text style={styles.accordionTitle}>{title}</Text>
        <Text style={styles.accordionChevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.accordionBody}>{children}</View>}
    </View>
  );
}

// ─── Grocery Card ─────────────────────────────────────────────────────────────

function GroceryCard({ category }: { category: GroceryCategory }) {
  return (
    <AccordionSection title={category.category}>
      {category.items.map((item, i) => (
        <View key={i} style={styles.groceryItem}>
          <View style={styles.groceryDot} />
          <Text style={styles.groceryItemText}>{item}</Text>
        </View>
      ))}
    </AccordionSection>
  );
}

// ─── Recipe Card ──────────────────────────────────────────────────────────────

function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <AccordionSection title={recipe.name}>
      {/* Macro pills */}
      <View style={styles.macroRow}>
        <View style={[styles.macroPill, { borderColor: Colors.warning }]}>
          <Text style={[styles.macroPillNumber, { color: Colors.warning }]}>
            {recipe.calories}
          </Text>
          <Text style={styles.macroPillLabel}> kcal</Text>
        </View>
        <View style={[styles.macroPill, { borderColor: Colors.accent }]}>
          <Text style={[styles.macroPillNumber, { color: Colors.accent }]}>
            {recipe.protein}g
          </Text>
          <Text style={styles.macroPillLabel}> protein</Text>
        </View>
        <View style={[styles.macroPill, { borderColor: Colors.secondary }]}>
          <Text style={[styles.macroPillNumber, { color: Colors.secondary }]}>
            {recipe.prepTime}
          </Text>
        </View>
      </View>

      {/* Ingredients */}
      <Text style={styles.recipeSubtitle}>Ingredients</Text>
      {recipe.ingredients.map((ing, i) => (
        <View key={i} style={styles.groceryItem}>
          <View style={[styles.groceryDot, { backgroundColor: Colors.accent }]} />
          <Text style={styles.groceryItemText}>{ing}</Text>
        </View>
      ))}

      {/* Instructions */}
      <Text style={styles.recipeSubtitle}>Instructions</Text>
      {recipe.instructions.map((step, i) => (
        <View key={i} style={styles.instructionRow}>
          <Text style={styles.instructionNumber}>{i + 1}</Text>
          <Text style={styles.instructionText}>{step}</Text>
        </View>
      ))}
    </AccordionSection>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MealPrepScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'grocery' | 'recipes'>('grocery');

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Meal Prep</Text>
        <Text style={styles.headerSubtitle}>Bi-weekly grocery list & 500-cal recipes</Text>

        {/* Tab switcher */}
        <View style={styles.tabSwitcher}>
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'grocery' && styles.tabPillActive]}
            onPress={() => setActiveTab('grocery')}
          >
            <Text style={[styles.tabPillText, activeTab === 'grocery' && styles.tabPillTextActive]}>
              🛒 Grocery
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'recipes' && styles.tabPillActive]}
            onPress={() => setActiveTab('recipes')}
          >
            <Text style={[styles.tabPillText, activeTab === 'recipes' && styles.tabPillTextActive]}>
              🍽️ Recipes
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'grocery'
          ? GROCERY_LIST.map((cat, i) => <GroceryCard key={i} category={cat} />)
          : RECIPES.map((recipe, i) => <RecipeCard key={i} recipe={recipe} />)}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header — paddingTop dynamically set via insets.top
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.xs,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
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
  tabPillActive: {
    backgroundColor: Colors.accent,
  },
  tabPillText: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.semibold,
  },
  tabPillTextActive: {
    color: Colors.background,
  },

  scrollView: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },

  // Accordion
  accordion: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
  },
  accordionTitle: {
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
    flex: 1,
  },
  accordionChevron: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  accordionBody: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.xs,
  },

  // Grocery
  groceryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: 3,
  },
  groceryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.textMuted,
    marginTop: 7,
  },
  groceryItemText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Recipe
  macroRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginVertical: Spacing.sm,
    flexWrap: 'wrap',
  },
  macroPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    backgroundColor: Colors.surface,
  },
  macroPillNumber: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
  },
  macroPillLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  recipeSubtitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
    marginBottom: 4,
  },
  instructionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: 3,
  },
  instructionNumber: {
    width: 20,
    fontSize: Typography.sizes.sm,
    color: Colors.accent,
    fontWeight: Typography.weights.bold,
    textAlign: 'center',
    marginTop: 1,
  },
  instructionText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
