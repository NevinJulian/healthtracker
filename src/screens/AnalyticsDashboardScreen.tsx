/**
 * AnalyticsDashboardScreen
 *
 * Verdure redesign: Unit 10 (#245)
 *
 * Behaviour-preserving restyle only. All DB queries and metric calculations
 * are unchanged. Presentation updated to the Verdure calm-wellness system
 * per design/verdure/DESIGN.md and code.html §7 Analytics board.
 *
 * Layout:
 *   - ScreenHeader (Fraunces title, "Last 30 days" subtitle)
 *   - Metric cards row: Weight delta | Workout count | Fasting streak
 *   - Weight trend card: flat View-based chart (sage line, sageTint area, sageDeep dot)
 *   - Consistency grid: 7-col rounded dot grid (sage/gold/canvasSunken) + legend
 *   - 7-day / 30-day rolling stats with ProgressBar rows
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { getRollingWindow, getWeightHistory, toISODate } from '../db/database';
import { Card, ProgressBar, ScreenHeader, Pill } from '../components';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RollingStats {
  walk: number;   // completion %
  gym: number;    // completion %
  extra: number;  // absolute count
  total: number;  // days in window
  fasting: number; // completion %
}

type DotState = 'complete' | 'partial' | 'missed';

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  microLabel,
  bigNumber,
  subLabel,
}: {
  microLabel: string;
  bigNumber: string;
  subLabel: string;
}) {
  return (
    <Card style={styles.metricCard}>
      <Text style={styles.metricMicroLabel}>{microLabel}</Text>
      <Text style={styles.metricBigNumber}>{bigNumber}</Text>
      <Text style={styles.metricSubLabel}>{subLabel}</Text>
    </Card>
  );
}

// ─── Weight trend (flat View-based chart recoloured to Verdure) ───────────────

function WeightTrendCard({
  history,
}: {
  history: { date: string; weight: number }[];
}) {
  if (history.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardSectionTitle}>Body weight</Text>
        </View>
        <Text style={styles.emptyText}>No weight data logged yet.</Text>
      </Card>
    );
  }

  const weights = history.map((w) => w.weight);
  const minW = Math.min(...weights) - 2;
  const maxW = Math.max(...weights) + 2;
  const current = weights[weights.length - 1];
  const range = maxW - minW;

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardSectionTitle}>Body weight</Text>
        <Text style={styles.currentWeightLabel}>{current.toFixed(1)} kg</Text>
      </View>

      {/* Flat chart: sage-tint filled area + sage line + sageDeep last dot */}
      <View style={styles.chartContainer}>
        {/* Area fill layer */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.areaFill}>
            {history.map((pt, i) => {
              const heightPct = Math.max(4, ((pt.weight - minW) / range) * 100);
              return (
                <View
                  key={`area-${i}`}
                  style={[
                    styles.areaBar,
                    { height: `${heightPct}%` },
                  ]}
                />
              );
            })}
          </View>
        </View>

        {/* Line + dot layer */}
        <View style={styles.lineLayer}>
          {history.map((pt, i) => {
            const heightPct = Math.max(4, ((pt.weight - minW) / range) * 100);
            const isLast = i === history.length - 1;
            return (
              <View
                key={`bar-${i}`}
                style={styles.barColumn}
              >
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${heightPct}%`,
                      backgroundColor: isLast
                        ? Colors.sageDeep
                        : Colors.sage,
                    },
                    isLast && styles.barLast,
                  ]}
                />
                {(i === 0 || isLast) && (
                  <Text style={styles.barDateLabel}>
                    {pt.date.substring(8, 10)}/{pt.date.substring(5, 7)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.chartMeta}>
        <Text style={styles.chartMetaText}>
          Min {(minW + 2).toFixed(1)} kg
        </Text>
        <Text style={styles.chartMetaText}>
          Max {(maxW - 2).toFixed(1)} kg
        </Text>
      </View>
    </Card>
  );
}

// ─── Consistency dot grid ─────────────────────────────────────────────────────

function ConsistencyGrid({ dots }: { dots: DotState[] }) {
  const DOT_COLORS: Record<DotState, string> = {
    complete: Colors.sage,
    partial: Colors.gold,
    missed: Colors.canvasSunken,
  };

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardSectionTitle}>Consistency</Text>
        <Text style={styles.cardSectionTrailing}>Last 14 days</Text>
      </View>

      <View style={styles.dotGrid}>
        {dots.map((state, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: DOT_COLORS[state] }]}
          />
        ))}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.sage }]} />
          <Text style={styles.legendLabel}>Complete</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.gold }]} />
          <Text style={styles.legendLabel}>Partial</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.canvasSunken }]} />
          <Text style={styles.legendLabel}>Missed</Text>
        </View>
      </View>
    </Card>
  );
}

// ─── Rolling stats card ───────────────────────────────────────────────────────

function RollingStatsCard({
  title,
  stats,
}: {
  title: string;
  stats: RollingStats;
}) {
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.cardSectionTitle} numberOfLines={1}>
        {title}
      </Text>

      {/* Walk */}
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Walking</Text>
        <ProgressBar
          progress={stats.walk / 100}
          height={7}
          style={styles.statBar}
        />
        <Pill label={`${stats.walk}%`} accent="sage" />
      </View>

      {/* Gym */}
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Gym</Text>
        <ProgressBar
          progress={stats.gym / 100}
          height={7}
          style={styles.statBar}
        />
        <Pill label={`${stats.gym}%`} accent="sage" />
      </View>

      {/* Fasting */}
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Fasting</Text>
        <ProgressBar
          progress={stats.fasting / 100}
          height={7}
          style={styles.statBar}
        />
        <Pill label={`${stats.fasting}%`} accent="sky" />
      </View>

      {/* Extra workouts count */}
      <View style={[styles.statRow, { marginBottom: 0 }]}>
        <Text style={styles.statLabel}>Extra workouts</Text>
        <View style={styles.statBarSpacer} />
        <Pill label={`${stats.extra} done`} accent="clay" />
      </View>
    </Card>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AnalyticsDashboardScreen() {
  const [loading, setLoading] = useState(false);
  const [stats7Day, setStats7Day] = useState<RollingStats>({
    walk: 0, gym: 0, extra: 0, total: 0, fasting: 0,
  });
  const [stats30Day, setStats30Day] = useState<RollingStats>({
    walk: 0, gym: 0, extra: 0, total: 0, fasting: 0,
  });
  const [weightHistory, setWeightHistory] = useState<{ date: string; weight: number }[]>([]);
  const [consistencyDots, setConsistencyDots] = useState<DotState[]>([]);

  // Metrics derived from 30-day window
  const [weightDelta, setWeightDelta] = useState<number | null>(null);
  const [workoutCount30, setWorkoutCount30] = useState(0);
  const [fastingStreak, setFastingStreak] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const logs = await getRollingWindow();
      const weightData = await getWeightHistory(30);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const computeStats = (days: number): RollingStats => {
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffIso = toISODate(cutoff);
        const todayIso = toISODate(today);

        const relevant = logs.filter(
          (l) => l.date >= cutoffIso && l.date <= todayIso
        );
        const total = relevant.length;
        if (total === 0) return { walk: 0, gym: 0, extra: 0, total: 0, fasting: 0 };

        const walkCount = relevant.filter((l) => l.walk_completed).length;
        const gymCount = relevant.filter((l) => l.hammer_completed).length;
        const fastingCount = relevant.filter((l) => l.fasting_completed).length;
        const extraCount = relevant.reduce(
          (sum, l) =>
            sum + (l.additional_workouts?.filter((aw) => aw.completed).length ?? 0),
          0
        );

        return {
          walk: Math.round((walkCount / total) * 100),
          gym: Math.round((gymCount / total) * 100),
          fasting: Math.round((fastingCount / total) * 100),
          extra: extraCount,
          total,
        };
      };

      const s7 = computeStats(7);
      const s30 = computeStats(30);
      setStats7Day(s7);
      setStats30Day(s30);
      setWeightHistory(weightData);

      // ── Metric card values ──────────────────────────────────────────────────

      // Weight delta (first vs last in 30-day window)
      if (weightData.length >= 2) {
        const delta = weightData[weightData.length - 1].weight - weightData[0].weight;
        setWeightDelta(delta);
      } else {
        setWeightDelta(null);
      }

      // Total workouts (gym sessions + extra) in 30 days
      const gymDays30 = s30.total > 0 ? Math.round((s30.gym / 100) * s30.total) : 0;
      setWorkoutCount30(gymDays30 + s30.extra);

      // Fasting streak — consecutive days from today going back
      const todayIso = toISODate(today);
      const sortedDesc = [...logs]
        .filter((l) => l.date <= todayIso)
        .sort((a, b) => (a.date > b.date ? -1 : 1));
      let streak = 0;
      for (const l of sortedDesc) {
        if (l.fasting_completed) streak++;
        else break;
      }
      setFastingStreak(streak);

      // ── Consistency dots (last 14 days) ────────────────────────────────────
      const dots: DotState[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const iso = toISODate(d);
        const log = logs.find((l) => l.date === iso);
        if (!log) {
          dots.push('missed');
        } else {
          const allComplete =
            log.walk_completed && log.hammer_completed;
          const anyComplete =
            log.walk_completed || log.hammer_completed;
          if (allComplete) dots.push('complete');
          else if (anyComplete) dots.push('partial');
          else dots.push('missed');
        }
      }
      setConsistencyDots(dots);
    } catch (err) {
      console.error('Failed to load analytics', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Format weight delta for metric card
  const weightDeltaStr =
    weightDelta === null
      ? '—'
      : weightDelta > 0
      ? `+${weightDelta.toFixed(1)}`
      : weightDelta.toFixed(1);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadData}
            tintColor={Colors.sage}
          />
        }
      >
        <ScreenHeader title="Progress" subtitle="Last 30 days" />

        {/* Metric cards row */}
        <View style={styles.metricsRow}>
          <MetricCard
            microLabel="Weight"
            bigNumber={weightDeltaStr}
            subLabel="kg this month"
          />
          <MetricCard
            microLabel="Workouts"
            bigNumber={String(workoutCount30)}
            subLabel={`of ${stats30Day.total} days`}
          />
          <MetricCard
            microLabel="Fasting"
            bigNumber={String(fastingStreak)}
            subLabel="day streak"
          />
        </View>

        {/* Weight trend */}
        <WeightTrendCard history={weightHistory} />

        {/* Consistency grid */}
        <ConsistencyGrid dots={consistencyDots} />

        {/* Rolling stats */}
        <RollingStatsCard title="7-Day Rolling Stats" stats={stats7Day} />
        <RollingStatsCard title="30-Day Rolling Stats" stats={stats30Day} />

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },

  // ── Metric cards ────────────────────────────────────────────────────────────
  metricsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  metricCard: {
    flex: 1,
    padding: Spacing.md,
  },
  metricMicroLabel: {
    fontFamily: Typography.label,
    fontSize: 8,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  metricBigNumber: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.semibold,
    color: Colors.textPrimary,
    lineHeight: Typography.sizes.xl * 1.1,
  },
  metricSubLabel: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.sageDeep,
    marginTop: Spacing.xs,
  },

  // ── Shared card layout ───────────────────────────────────────────────────────
  sectionCard: {
    marginHorizontal: Spacing.lg,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  cardSectionTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  cardSectionTrailing: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.textMuted,
  },

  // ── Weight chart ─────────────────────────────────────────────────────────────
  currentWeightLabel: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
    color: Colors.sageDeep,
  },
  chartContainer: {
    height: 80,
    marginBottom: Spacing.sm,
  },
  areaFill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: '100%',
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    opacity: 0.5,
  },
  areaBar: {
    flex: 1,
    backgroundColor: Colors.sageTint,
  },
  lineLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
    marginHorizontal: 1,
  },
  bar: {
    width: '80%',
    maxWidth: 10,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barLast: {
    width: 10,
    maxWidth: 10,
  },
  barDateLabel: {
    position: 'absolute',
    bottom: -16,
    fontFamily: Typography.body,
    fontSize: 9,
    color: Colors.textMuted,
  },
  chartMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
  },
  chartMetaText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  emptyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },

  // ── Consistency grid ─────────────────────────────────────────────────────────
  dotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm - 2,
    marginBottom: Spacing.md,
  },
  dot: {
    width: 32,
    aspectRatio: 1,
    borderRadius: Radius.sm - 4,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendSwatch: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  legendLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.textSecondary,
  },

  // ── Rolling stats card ────────────────────────────────────────────────────────
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  statLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    width: 90,
  },
  statBar: {
    flex: 1,
  },
  statBarSpacer: {
    flex: 1,
  },
});
