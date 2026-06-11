import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { getRecipes, Recipe } from '../db/database';
import { useNavigation } from '@react-navigation/native';
import { Card, IconChip, ScreenHeader } from '../components';
import { iconChipIconColor } from '../components/IconChip';

// ─── Category → accent family mapping ────────────────────────────────────────

type AccentKey = 'clay' | 'sage' | 'gold' | 'sky';

const CATEGORY_ACCENT: Record<string, AccentKey> = {
  'All':            'sage',
  'Fresh & Fridge': 'sage',
  'Quick Cook':     'gold',
  'Freezer Batch':  'sky',
  'Freezer Sauce':  'clay',
};

function categoryAccent(category: string): AccentKey {
  return CATEGORY_ACCENT[category] ?? 'clay';
}

const ACCENT_IMG_BG: Record<AccentKey, string> = {
  sage: Colors.sageTint,
  clay: Colors.clayTint,
  gold: Colors.goldTint,
  sky:  Colors.skyTint,
};

const ACCENT_META_COLOR: Record<AccentKey, string> = {
  sage: Colors.sageDeep,
  clay: Colors.clayDeep,
  gold: Colors.goldDeep,
  sky:  Colors.skyDeep,
};

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORY_ICON: Record<string, IoniconsName> = {
  'All':            'restaurant-outline',
  'Fresh & Fridge': 'nutrition-outline',
  'Quick Cook':     'flash-outline',
  'Freezer Batch':  'snow-outline',
  'Freezer Sauce':  'flask-outline',
};

const CATEGORIES = ['All', 'Fresh & Fridge', 'Quick Cook', 'Freezer Batch', 'Freezer Sauce'];

// ─── Recipe Card ─────────────────────────────────────────────────────────────

function RecipeCard({
  item,
  onPress,
}: {
  item: Recipe;
  onPress: () => void;
}) {
  const accent = categoryAccent(item.category);
  const metaColor = ACCENT_META_COLOR[accent];
  const imgBg = ACCENT_IMG_BG[accent];
  const iconName: IoniconsName = CATEGORY_ICON[item.category] ?? 'restaurant-outline';

  return (
    <TouchableOpacity
      style={styles.cardWrapper}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <Card style={styles.recipeCard}>
        {/* Tinted icon band */}
        <View style={[styles.cardImgBand, { backgroundColor: imgBg }]}>
          <IconChip
            icon={<Ionicons name={iconName} size={22} color={iconChipIconColor(accent)} />}
            accent={accent}
            size={44}
          />
        </View>

        {/* Card body */}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.cardMeta, { color: metaColor }]} numberOfLines={1}>
            {item.calories} kcal · {item.protein}g protein
          </Text>
          <Text style={styles.cardTime}>
            {item.prepTimeMinutes} min
          </Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecipesScreen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const navigation = useNavigation<any>();

  useEffect(() => {
    loadRecipes(activeCategory);
  }, [activeCategory]);

  const loadRecipes = async (category: string) => {
    const data = await getRecipes(category);
    setRecipes(data);
  };

  // Client-side search filter on already-loaded recipes
  const filteredRecipes = searchQuery.trim()
    ? recipes.filter(r =>
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : recipes;

  const renderRecipe = ({ item }: { item: Recipe }) => (
    <RecipeCard
      item={item}
      onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
    />
  );

  return (
    <View style={styles.container}>
      {/* Screen header — Fraunces display title + New Recipe action */}
      <ScreenHeader
        title="Recipe Library"
        subtitle={`${filteredRecipes.length} recipe${filteredRecipes.length === 1 ? '' : 's'}`}
        style={styles.screenHeader}
        trailing={
          <TouchableOpacity
            style={styles.newRecipeBtn}
            onPress={() => navigation.navigate('RecipeEditor')}
            activeOpacity={0.75}
            accessibilityLabel="Create new recipe"
            accessibilityRole="button"
          >
            <Ionicons name="add-outline" size={20} color={Colors.surface} />
          </TouchableOpacity>
        }
      />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search recipes & ingredients"
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.chipsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {CATEGORIES.map(cat => {
            const isActive = cat === activeCategory;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setActiveCategory(cat)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Recipe grid */}
      <FlatList
        data={filteredRecipes}
        keyExtractor={item => item.id}
        renderItem={renderRecipe}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No recipes found.</Text>
          </View>
        }
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // ── Screen header ─────────────────────────────────────────────────────────
  screenHeader: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  newRecipeBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Search bar ────────────────────────────────────────────────────────────
  searchRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    padding: 0,
  },

  // ── Filter chips ──────────────────────────────────────────────────────────
  chipsContainer: {
    paddingBottom: Spacing.md,
  },
  chipsContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  chip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.sage,
    borderColor: Colors.sage,
  },
  chipText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.surface,
  },

  // ── Recipe grid ───────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  columnWrapper: {
    gap: Spacing.md,
  },
  cardWrapper: {
    flex: 1,
  },

  // ── Recipe card ───────────────────────────────────────────────────────────
  recipeCard: {
    padding: 0,
    overflow: 'hidden',
  },
  cardImgBand: {
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.sm * 1.22,
    letterSpacing: -0.2,
  },
  cardMeta: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs - 1,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.1,
  },
  cardTime: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs - 1,
    color: Colors.textMuted,
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyContainer: {
    paddingTop: Spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },
});
