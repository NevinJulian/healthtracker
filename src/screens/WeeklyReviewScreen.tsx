import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import Card from '../components/Card';
import LoadErrorView from '../components/LoadErrorView';
import ScreenHeader from '../components/ScreenHeader';
import {
  getConsumedMacrosByDay,
  getDailyLogsBetween,
  getNutritionGoals,
  getWeightHistory,
  getWorkoutSetsBetween,
} from '../db/database';
import { Colors, Spacing, Typography } from '../theme/tokens';
import { todayKey } from '../utils/dates';
import { ewmaTrend, plausibleWeights, weightRatePerWeek } from './analyticsHelpers';
import {
  buildWeeklyReview,
  reviewWindows,
  type ReviewRow,
  type ReviewSection,
  type WeeklyReview,
} from './weeklyReviewHelpers';

const FIRST_DATE_KEY = '0000-01-01';
const INTAKE_LOOKBACK_DAYS = 14;
const WEIGHT_LOOKBACK_DAYS = 90;

function ReviewRowView({ row }: { row: ReviewRow }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{row.label}</Text>
      <View style={styles.rowFigures}>
        <Text style={styles.rowValue}>{row.value}</Text>
        {row.previous !== null && <Text style={styles.rowPrevious}>{`Previous: ${row.previous}`}</Text>}
        {row.change !== null && <Text style={styles.rowChange}>{row.change}</Text>}
      </View>
    </View>
  );
}

function ReviewSectionCard({ section }: { section: ReviewSection }) {
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>{section.title}</Text>
      {section.emptyText !== null ? (
        <Text style={styles.emptyText}>{section.emptyText}</Text>
      ) : (
        section.rows.map((row) => <ReviewRowView key={row.label} row={row} />)
      )}
    </Card>
  );
}

export default function WeeklyReviewScreen() {
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<'initial' | 'refresh' | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    runIdRef.current += 1;
    const myRunId = runIdRef.current;
    const isCurrent = () => mountedRef.current && runIdRef.current === myRunId;

    setLoading(true);
    setLoadError(null);
    try {
      const today = todayKey();
      const windows = reviewWindows(today);
      const [logs, sets, intake, goals, weights] = await Promise.all([
        getDailyLogsBetween(windows.previous.from, today),
        getWorkoutSetsBetween(FIRST_DATE_KEY, today),
        getConsumedMacrosByDay(INTAKE_LOOKBACK_DAYS),
        getNutritionGoals(),
        getWeightHistory(WEIGHT_LOOKBACK_DAYS),
      ]);
      const rate = weightRatePerWeek(ewmaTrend(plausibleWeights(weights).valid), today);
      const built = buildWeeklyReview({
        today,
        logs,
        sets,
        intake,
        goals,
        weightRatePerWeek: rate,
      });
      if (isCurrent()) {
        setReview(built);
        hasLoadedOnceRef.current = true;
      }
    } catch (err) {
      console.error('Failed to load the weekly review', err);
      if (isCurrent()) setLoadError(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      return () => {
        runIdRef.current += 1;
      };
    }, [loadData])
  );

  if (loadError === 'initial') {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Weekly review" />
        <LoadErrorView variant="screen" title="Couldn't load your weekly review" onRetry={loadData} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadData} tintColor={Colors.sage} />
        }
      >
        <ScreenHeader
          title="Weekly review"
          subtitle={review ? `Last 7 days · ${review.ranges.current}` : undefined}
        />
        {review && (
          <Text style={styles.previousRange}>{`Previous 7 days · ${review.ranges.previous}`}</Text>
        )}

        {loadError === 'refresh' && <LoadErrorView variant="banner" onRetry={loadData} />}

        {review?.nothingLogged && (
          <Card style={styles.card}>
            <Text style={styles.emptyText}>Nothing logged in these 7 days.</Text>
          </Card>
        )}
        {review?.sections.map((section) => (
          <ReviewSectionCard key={section.title} section={section} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  previousRange: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    marginHorizontal: Spacing.lg,
  },
  card: {
    marginHorizontal: Spacing.lg,
  },
  cardTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
  },
  rowFigures: {
    alignItems: 'flex-end',
  },
  rowValue: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  rowPrevious: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  rowChange: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textPrimary,
  },
  emptyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});
