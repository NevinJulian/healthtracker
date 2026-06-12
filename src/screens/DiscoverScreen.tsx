import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { searchMeals, MealSummary } from '../api/mealdb';
import { useNavigation } from '@react-navigation/native';
import { Card, Pill, ScreenHeader } from '../components';

// ─── Meal result card ─────────────────────────────────────────────────────────

function MealCard({ item, onPress }: { item: MealSummary; onPress: () => void }) {
  const a11yLabel = [item.name, item.category, item.area].filter(Boolean).join(', ');
  return (
    <TouchableOpacity
      style={styles.cardWrapper}
      onPress={onPress}
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <Card style={styles.mealCard}>
        {/* Thumbnail */}
        <View style={styles.thumbContainer}>
          {item.thumb ? (
            <Image
              source={{ uri: item.thumb }}
              style={styles.thumb}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="restaurant-outline" size={28} color={Colors.textMuted} />
            </View>
          )}
        </View>

        {/* Card body */}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.name}
          </Text>
          <View style={styles.pillRow}>
            {item.category ? (
              <Pill label={item.category} accent="sage" />
            ) : null}
            {item.area ? (
              <Pill label={item.area} accent="clay" />
            ) : null}
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

// ─── Empty / prompt state ─────────────────────────────────────────────────────

function EmptyPrompt({ query, hasError }: { query: string; hasError: boolean }) {
  if (hasError) return null; // error state rendered separately
  if (!query.trim()) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="compass-outline" size={40} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Discover recipes</Text>
        <Text style={styles.emptySubtitle}>Search thousands of recipes from around the world</Text>
      </View>
    );
  }
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="search-outline" size={36} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>No recipes found</Text>
      <Text style={styles.emptySubtitle}>
        No results for &ldquo;{query}&rdquo; — try a different search term
      </Text>
    </View>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="cloud-offline-outline" size={40} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>Couldn&rsquo;t reach the recipe service</Text>
      <Text style={styles.emptySubtitle}>Check your connection and try again</Text>
      <TouchableOpacity
        style={styles.retryBtn}
        onPress={onRetry}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel="Retry search"
      >
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type SearchState = 'idle' | 'loading' | 'results' | 'error';

export default function DiscoverScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MealSummary[]>([]);
  const [state, setState] = useState<SearchState>('idle');
  const navigation = useNavigation<any>();

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const meals = await searchMeals(trimmed);
      setResults(meals);
      setState('results');
    } catch {
      setState('error');
    }
  };

  const handleSubmit = () => runSearch(query);

  const handleRetry = () => runSearch(query);

  const renderItem = ({ item }: { item: MealSummary }) => (
    <MealCard
      item={item}
      onPress={() => navigation.navigate('DiscoverDetail', { mealId: item.id })}
    />
  );

  const showEmpty = state === 'results' && results.length === 0;
  const showList  = state === 'results' && results.length > 0;
  const showIdle  = state === 'idle';

  return (
    <View style={styles.container}>
      {/* Screen header */}
      <ScreenHeader
        title="Discover"
        subtitle="Browse recipes online"
        style={styles.screenHeader}
      />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search recipes (e.g. chicken, pasta…)"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSubmit}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.trim().length > 0 && (
            <TouchableOpacity onPress={handleSubmit} activeOpacity={0.75}>
              <View style={styles.searchBtn}>
                <Text style={styles.searchBtnText}>Search</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Loading */}
      {state === 'loading' && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.sage} />
        </View>
      )}

      {/* Error */}
      {state === 'error' && <ErrorState onRetry={handleRetry} />}

      {/* Idle prompt or empty results */}
      {(showIdle || showEmpty) && (
        <EmptyPrompt query={query} hasError={false} />
      )}

      {/* Results list */}
      {showList && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  screenHeader: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
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
  searchBtn: {
    backgroundColor: Colors.sage,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  searchBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.surface,
  },

  // ── Loading ───────────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Results list ──────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    paddingTop: Spacing.xs,
  },
  separator: {
    height: Spacing.md,
  },

  // ── Meal card ─────────────────────────────────────────────────────────────
  cardWrapper: {
    // full-width single column
  },
  mealCard: {
    padding: 0,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbContainer: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    margin: Spacing.md,
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: Radius.md,
  },
  thumbPlaceholder: {
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingRight: Spacing.md,
    gap: Spacing.sm,
  },
  cardTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.sm * 1.3,
    letterSpacing: -0.2,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },

  // ── Empty / prompt ────────────────────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.lg,
    color: Colors.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: Typography.sizes.sm * 1.55,
  },

  // ── Retry button ──────────────────────────────────────────────────────────
  retryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.sage,
    borderRadius: 13,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.surface,
  },
});
