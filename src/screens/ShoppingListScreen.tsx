/**
 * ShoppingListScreen
 *
 * Items are grouped into aisle sections (see data/aisles.ts), sorted by name inside
 * each, with checked items last.
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
import { Ionicons } from '@expo/vector-icons';
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
import { iconChipIconColor } from '../components/IconChip';
import { Aisle, AisleGroup, groupByAisle } from '../data/aisles';
import { formatQuantity } from '../data/formatQuantity';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface AisleMeta {
  accent: 'sage' | 'clay' | 'sky' | 'gold';
  icon: IoniconsName;
}

const AISLE_META: Record<Aisle, AisleMeta> = {
  Produce: { accent: 'sage', icon: 'leaf-outline' },
  'Meat and fish': { accent: 'clay', icon: 'fish-outline' },
  'Dairy and eggs': { accent: 'sky', icon: 'water-outline' },
  Bakery: { accent: 'gold', icon: 'pizza-outline' },
  Pantry: { accent: 'sage', icon: 'basket-outline' },
  'Tins and jars': { accent: 'clay', icon: 'archive-outline' },
  Frozen: { accent: 'sky', icon: 'snow-outline' },
  'Spices and oils': { accent: 'gold', icon: 'flame-outline' },
  Drinks: { accent: 'sage', icon: 'cafe-outline' },
  Other: { accent: 'clay', icon: 'cart-outline' },
};

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
    `${formatQuantity(item.total_quantity)} ${item.unit}`.trim();

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
  group: AisleGroup;
  onToggle: (id: number, current: boolean) => void;
}) {
  const { aisle, items } = group;
  const meta = AISLE_META[aisle];

  const iconNode = (
    <Ionicons name={meta.icon} size={14} color={iconChipIconColor(meta.accent)} />
  );

  return (
    <View style={styles.categorySection}>
      <View style={styles.categoryHeader}>
        <IconChip icon={iconNode} accent={meta.accent} size={28} />
        <Text style={styles.categoryLabel}>{aisle}</Text>
      </View>

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
  const groups = groupByAisle(items);

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
              <Ionicons name="cart-outline" size={32} color={Colors.sageDeep} />
            </View>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptySubtitle}>
              Add a recipe to your meal plan and your shopping list will fill up automatically.
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <CategorySection
              key={group.aisle}
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
