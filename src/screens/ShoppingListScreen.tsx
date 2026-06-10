/**
 * ShoppingListScreen
 *
 * Verdure redesign: Unit 9 (#243)
 *
 * Behaviour-preserving restyle only. All DB queries and mutations are unchanged.
 * Items are grouped by inferred category (Produce, Protein, Dairy, Pantry, Drinks,
 * Other) for a cleaner browse experience per DESIGN.md §5.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getShoppingListItems,
  toggleShoppingListItem,
  clearCompletedShoppingList,
  ShoppingListItem,
} from '../db/database';
import {
  Card,
  IconChip,
  ProgressBar,
  Button,
  ScreenHeader,
} from '../components';

// ─── Category inference ───────────────────────────────────────────────────────

type CategoryKey = 'Produce' | 'Protein' | 'Dairy' | 'Pantry' | 'Drinks' | 'Other';

interface CategoryMeta {
  label: CategoryKey;
  /** Accent family for IconChip + header tint */
  accent: 'sage' | 'clay' | 'sky' | 'gold';
  /** Unicode symbol rendered inside the IconChip */
  icon: string;
}

const CATEGORIES: CategoryMeta[] = [
  { label: 'Produce',  accent: 'sage', icon: '🥦' },
  { label: 'Protein',  accent: 'clay', icon: '🥩' },
  { label: 'Dairy',    accent: 'sky',  icon: '🥛' },
  { label: 'Pantry',   accent: 'gold', icon: '🌾' },
  { label: 'Drinks',   accent: 'sky',  icon: '💧' },
  { label: 'Other',    accent: 'sage', icon: '🛒' },
];

const PRODUCE_KEYWORDS = [
  'broccoli', 'spinach', 'kale', 'lettuce', 'salad', 'avocado', 'tomato',
  'cucumber', 'pepper', 'courgette', 'zucchini', 'carrot', 'onion', 'garlic',
  'mushroom', 'celery', 'leek', 'asparagus', 'bean', 'pea', 'corn', 'potato',
  'sweet potato', 'beetroot', 'radish', 'cabbage', 'cauliflower', 'herb',
  'basil', 'parsley', 'coriander', 'mint', 'lime', 'lemon', 'orange', 'apple',
  'banana', 'berry', 'blueberry', 'strawberry', 'raspberry', 'mango', 'pineapple',
  'ginger', 'tenderstem', 'pak choi', 'bok choy', 'spring onion', 'shallot',
  'fennel', 'artichoke', 'fruit', 'vegetable', 'veg',
];

const PROTEIN_KEYWORDS = [
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'venison', 'salmon',
  'tuna', 'cod', 'haddock', 'mackerel', 'prawns', 'shrimp', 'egg', 'eggs',
  'tofu', 'tempeh', 'seitan', 'mince', 'steak', 'fillet', 'breast', 'thigh',
  'loin', 'ribs', 'sausage', 'bacon', 'ham', 'protein powder', 'whey',
];

const DAIRY_KEYWORDS = [
  'milk', 'cream', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan',
  'feta', 'brie', 'yogurt', 'yoghurt', 'greek yogurt', 'quark', 'cottage',
  'ricotta', 'cream cheese', 'sour cream', 'creme fraiche', 'ghee',
];

const DRINKS_KEYWORDS = [
  'water', 'juice', 'milk alternative', 'oat milk', 'almond milk', 'soy milk',
  'coconut water', 'tea', 'coffee', 'kombucha', 'sparkling', 'soda', 'broth',
  'stock',
];

const PANTRY_KEYWORDS = [
  'oil', 'olive oil', 'coconut oil', 'vinegar', 'sauce', 'paste', 'flour',
  'sugar', 'honey', 'syrup', 'salt', 'pepper', 'spice', 'herb', 'seasoning',
  'quinoa', 'rice', 'pasta', 'oat', 'lentil', 'chickpea', 'nut',
  'almond', 'cashew', 'walnut', 'seed', 'chia', 'flax', 'tahini', 'peanut',
  'canned', 'tinned', 'can of', 'tin of', 'tomato puree', 'stock cube',
  'breadcrumb', 'wrap', 'bread', 'tortilla', 'cracker', 'cereal', 'granola',
];

export function inferCategory(ingredientName: string): CategoryKey {
  const lower = ingredientName.toLowerCase();

  if (DRINKS_KEYWORDS.some((kw) => lower.includes(kw))) return 'Drinks';
  if (DAIRY_KEYWORDS.some((kw) => lower.includes(kw))) return 'Dairy';
  if (PROTEIN_KEYWORDS.some((kw) => lower.includes(kw))) return 'Protein';
  if (PRODUCE_KEYWORDS.some((kw) => lower.includes(kw))) return 'Produce';
  if (PANTRY_KEYWORDS.some((kw) => lower.includes(kw))) return 'Pantry';

  return 'Other';
}

function categoryMeta(key: CategoryKey): CategoryMeta {
  return CATEGORIES.find((c) => c.label === key) ?? CATEGORIES[CATEGORIES.length - 1];
}

// ─── Group items by category ──────────────────────────────────────────────────

interface CategoryGroup {
  meta: CategoryMeta;
  items: ShoppingListItem[];
}

export function groupByCategory(items: ShoppingListItem[]): CategoryGroup[] {
  const map = new Map<CategoryKey, ShoppingListItem[]>();

  for (const item of items) {
    const key = inferCategory(item.ingredient_name);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  // Preserve the canonical category order
  const result: CategoryGroup[] = [];
  for (const cat of CATEGORIES) {
    const grpItems = map.get(cat.label);
    if (grpItems && grpItems.length > 0) {
      result.push({ meta: cat, items: grpItems });
    }
  }
  return result;
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      style={[styles.checkbox, checked && styles.checkboxChecked]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      {checked && <Text style={styles.checkmark}>✓</Text>}
    </View>
  );
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ShoppingItemRow({
  item,
  onToggle,
}: {
  item: ShoppingListItem;
  onToggle: () => void;
}) {
  const qtyStr =
    `${item.total_quantity.toFixed(1).replace(/\.0$/, '')} ${item.unit}`.trim();

  return (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${item.is_checked ? 'Uncheck' : 'Check'} ${item.ingredient_name}`}
    >
      <Checkbox checked={item.is_checked} />
      <Text
        style={[styles.itemName, item.is_checked && styles.itemNameDone]}
        numberOfLines={2}
      >
        {item.ingredient_name}
      </Text>
      <Text style={styles.itemQty}>{qtyStr}</Text>
    </TouchableOpacity>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

function CategorySection({
  group,
  onToggle,
}: {
  group: CategoryGroup;
  onToggle: (id: number, current: boolean) => void;
}) {
  const { meta, items } = group;

  const iconNode = (
    <Text style={{ fontSize: 16 }}>{meta.icon}</Text>
  );

  return (
    <View style={styles.categorySection}>
      {/* Category header */}
      <View style={styles.categoryHeader}>
        <IconChip icon={iconNode} accent={meta.accent} size={28} />
        <Text style={styles.categoryLabel}>
          {meta.label.toUpperCase()}
        </Text>
      </View>

      {/* Items card */}
      <Card style={styles.itemsCard}>
        {items.map((item, idx) => (
          <View key={item.id}>
            {idx > 0 && <View style={styles.itemDivider} />}
            <ShoppingItemRow
              item={item}
              onToggle={() => onToggle(item.id, item.is_checked)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ShoppingListScreen() {
  const [items, setItems] = React.useState<ShoppingListItem[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      loadItems();
    }, [])
  );

  const loadItems = async () => {
    const data = await getShoppingListItems();
    setItems(data);
  };

  const handleToggle = async (id: number, currentStatus: boolean) => {
    await toggleShoppingListItem(id, !currentStatus);
    loadItems();
  };

  const handleClearCompleted = () => {
    Alert.alert(
      'Clear Completed',
      'Are you sure you want to remove all completed items?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearCompletedShoppingList();
            loadItems();
          },
        },
      ]
    );
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalCount = items.length;
  const checkedCount = items.filter((i) => i.is_checked).length;
  const progress = totalCount > 0 ? checkedCount / totalCount : 0;
  const hasCompleted = checkedCount > 0;
  const groups = groupByCategory(items);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Screen title + optional clear button */}
        <ScreenHeader
          title="Shopping"
          subtitle={
            totalCount === 0
              ? 'Your list is empty'
              : `${totalCount} item${totalCount !== 1 ? 's' : ''} · ${checkedCount} done`
          }
          trailing={
            hasCompleted ? (
              <Button
                title="Clear done"
                onPress={handleClearCompleted}
                variant="ghost"
                style={styles.clearBtn}
              />
            ) : undefined
          }
        />

        {/* Progress bar — only shown when there are items */}
        {totalCount > 0 && (
          <View style={styles.progressSection}>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressLabel}>PROGRESS</Text>
              <Text style={styles.progressValue}>
                {checkedCount}/{totalCount}
              </Text>
            </View>
            <ProgressBar progress={progress} height={6} />
          </View>
        )}

        {/* Empty state */}
        {totalCount === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Text style={styles.emptyIcon}>🛒</Text>
            </View>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptySubtitle}>
              Add a recipe to your meal plan and your shopping list will fill up automatically.
            </Text>
          </View>
        ) : (
          /* Category groups */
          groups.map((group) => (
            <CategorySection
              key={group.meta.label}
              group={group}
              onToggle={handleToggle}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },

  // ── Progress ────────────────────────────────────────────────────────────────
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

  // ── Category section ────────────────────────────────────────────────────────
  categorySection: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  categoryLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Items card ──────────────────────────────────────────────────────────────
  itemsCard: {
    padding: 0,
    overflow: 'hidden',
  },
  itemDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.lg,
  },

  // ── Item row ────────────────────────────────────────────────────────────────
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },

  // ── Checkbox ────────────────────────────────────────────────────────────────
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: 'rgba(44,53,46,0.15)', // line2 per DESIGN.md §2
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.sage,
    borderColor: Colors.sage,
  },
  checkmark: {
    color: Colors.surface,
    fontSize: 13,
    fontWeight: Typography.weights.bold,
    lineHeight: 16,
    includeFontPadding: false,
  },

  // ── Item text ───────────────────────────────────────────────────────────────
  itemName: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.sm * 1.4,
  },
  itemNameDone: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  itemQty: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.semibold,
    flexShrink: 0,
  },

  // ── Clear button ─────────────────────────────────────────────────────────────
  clearBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    minHeight: 36,
  },

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    backgroundColor: Colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyIcon: {
    fontSize: 32,
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
});
