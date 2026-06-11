import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { fetchMealById, MealDetail } from '../api/mealdb';
import { useRoute } from '@react-navigation/native';
import { Card, Row, Pill } from '../components';

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

// ─── Loading / error states ───────────────────────────────────────────────────

function LoadingView() {
  return (
    <View style={styles.centred}>
      <ActivityIndicator size="large" color={Colors.sage} />
    </View>
  );
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.centred}>
      <Ionicons name="cloud-offline-outline" size={40} color={Colors.textMuted} />
      <Text style={styles.errorTitle}>Couldn&rsquo;t load this recipe</Text>
      <Text style={styles.errorSubtitle}>Check your connection and try again</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.78}>
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DiscoverDetailScreen() {
  const route = useRoute<any>();
  const { mealId } = route.params || {};

  const [meal, setMeal] = useState<MealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchMealById(id);
      setMeal(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mealId) load(mealId);
  }, [mealId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView onRetry={() => load(mealId)} />;
  if (!meal) {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorTitle}>Recipe not found</Text>
      </View>
    );
  }

  // Split instructions into paragraphs (TheMealDB uses \r\n or \n)
  const instructionSteps = meal.instructions
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image ──────────────────────────────────────────────────── */}
        {meal.thumb ? (
          <View style={styles.heroImageContainer}>
            <Image
              source={{ uri: meal.thumb }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          </View>
        ) : (
          <View style={[styles.heroImage, styles.heroImagePlaceholder]}>
            <Ionicons name="restaurant-outline" size={48} color={Colors.textMuted} />
          </View>
        )}

        {/* ── Title + category/area pills ─────────────────────────────────── */}
        <Card style={styles.heroCard}>
          <Text style={styles.heroTitle}>{meal.name}</Text>
          <View style={styles.pillRow}>
            {meal.category ? <Pill label={meal.category} accent="sage" /> : null}
            {meal.area ? <Pill label={meal.area} accent="clay" /> : null}
            {meal.tags.map((tag) => (
              <Pill key={tag} label={tag} accent="gold" />
            ))}
          </View>
        </Card>

        {/* ── Ingredients ─────────────────────────────────────────────────── */}
        {meal.ingredients.length > 0 && (
          <View style={styles.section}>
            <SectionLabel text="INGREDIENTS" />
            <Card style={styles.listCard}>
              {meal.ingredients.map((ing, idx) => (
                <React.Fragment key={idx}>
                  <Row
                    title={ing.ingredient}
                    trailing={
                      ing.measure ? (
                        <Text style={styles.measureText}>{ing.measure}</Text>
                      ) : null
                    }
                    style={styles.ingredientRow}
                  />
                  {idx < meal.ingredients.length - 1 && (
                    <View style={styles.rowDivider} />
                  )}
                </React.Fragment>
              ))}
            </Card>
          </View>
        )}

        {/* ── Instructions ────────────────────────────────────────────────── */}
        {instructionSteps.length > 0 && (
          <View style={styles.section}>
            <SectionLabel text="INSTRUCTIONS" />
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
                <Text style={styles.bodyText}>{meal.instructions}</Text>
              )}
            </Card>
          </View>
        )}

        {/* ── "Import coming soon" placeholder ───────────────────────────── */}
        <View style={styles.section}>
          <Card style={styles.importPlaceholderCard}>
            <View style={styles.importPlaceholderRow}>
              <Ionicons name="cloud-download-outline" size={20} color={Colors.textMuted} />
              <View style={styles.importPlaceholderText}>
                <Text style={styles.importPlaceholderTitle}>Import to my recipes</Text>
                <Text style={styles.importPlaceholderSubtitle}>Coming soon — import to your recipe library</Text>
              </View>
            </View>
          </Card>
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

  // ── Centred states ────────────────────────────────────────────────────────
  centred: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.md,
  },
  errorTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.lg,
    color: Colors.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: Typography.sizes.sm * 1.55,
  },
  retryBtn: {
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

  scrollContent: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },

  // ── Hero image ────────────────────────────────────────────────────────────
  heroImageContainer: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: Radius.lg,
  },
  heroImagePlaceholder: {
    backgroundColor: Colors.canvasSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },

  // ── Hero card ─────────────────────────────────────────────────────────────
  heroCard: {
    marginHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  heroTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    lineHeight: Typography.sizes.xl * 1.2,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
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
    paddingHorizontal: Spacing.lg,
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
  measureText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },

  // ── Instructions ──────────────────────────────────────────────────────────
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

  // ── Import placeholder ────────────────────────────────────────────────────
  importPlaceholderCard: {
    backgroundColor: Colors.canvasSunken,
    borderWidth: 1,
    borderColor: Colors.line2,
    padding: Spacing.lg,
    opacity: 0.6,
  },
  importPlaceholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  importPlaceholderText: {
    flex: 1,
    gap: Spacing.xs,
  },
  importPlaceholderTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },
  importPlaceholderSubtitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },
});
