import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import { getRollingWindow, getWeightHistory, toISODate } from '../db/database';

export default function AnalyticsDashboardScreen() {
  const [loading, setLoading] = useState(false);
  const [stats7Day, setStats7Day] = useState({ walk: 0, gym: 0, extra: 0 });
  const [stats30Day, setStats30Day] = useState({ walk: 0, gym: 0, extra: 0 });
  const [weightHistory, setWeightHistory] = useState<{date: string, weight: number}[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const logs = await getRollingWindow();
      const weightData = await getWeightHistory(30);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const computeStats = (days: number) => {
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffIso = toISODate(cutoff);

        const relevantLogs = logs.filter(l => l.date >= cutoffIso && l.date <= toISODate(today));
        const total = relevantLogs.length;

        if (total === 0) return { walk: 0, gym: 0, extra: 0 };

        const walkCount = relevantLogs.filter(l => l.walk_completed).length;
        const gymCount = relevantLogs.filter(l => l.hammer_completed).length;
        const extraCount = relevantLogs.reduce((sum, l) =>
          sum + (l.additional_workouts?.filter(aw => aw.completed).length || 0), 0);

        return {
          walk: Math.round((walkCount / total) * 100),
          gym: Math.round((gymCount / total) * 100),
          extra: extraCount
        };
      };

      setStats7Day(computeStats(7));
      setStats30Day(computeStats(30));
      setWeightHistory(weightData);
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

  const renderStatsCard = (title: string, stats: { walk: number, gym: number, extra: number }) => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>

      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Walking</Text>
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${stats.walk}%`, backgroundColor: Colors.primary }]} />
        </View>
        <Text style={styles.statValue}>{stats.walk}%</Text>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Gym</Text>
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${stats.gym}%`, backgroundColor: Colors.secondary }]} />
        </View>
        <Text style={styles.statValue}>{stats.gym}%</Text>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Extra Workouts</Text>
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>{stats.extra} completed</Text>
        </View>
      </View>
    </View>
  );

  const renderWeightChart = () => {
    if (weightHistory.length === 0) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Weight Trend (30 Days)</Text>
          <Text style={styles.emptyText}>No weight data logged yet.</Text>
        </View>
      );
    }

    const weights = weightHistory.map(w => w.weight);
    const minW = Math.min(...weights) - 2;
    const maxW = Math.max(...weights) + 2;
    const current = weights[weights.length - 1];

    return (
      <View style={styles.card}>
        <View style={styles.chartHeader}>
          <Text style={styles.cardTitle}>Weight Trend (30 Days)</Text>
          <Text style={styles.currentWeight}>{current.toFixed(1)} kg</Text>
        </View>

        <View style={styles.chartArea}>
          {weightHistory.map((pt, i) => {
            const heightPct = Math.max(5, ((pt.weight - minW) / (maxW - minW)) * 100);
            return (
              <View key={i} style={styles.barContainer}>
                <View style={[styles.bar, { height: `${heightPct}%` }]} />
                {(i === 0 || i === weightHistory.length - 1) && (
                  <Text style={styles.barLabel}>
                    {pt.date.substring(8, 10)}/{pt.date.substring(5, 7)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.chartMeta}>
          <Text style={styles.chartMetaText}>Min: {(minW + 2).toFixed(1)} kg</Text>
          <Text style={styles.chartMetaText}>Max: {(maxW - 2).toFixed(1)} kg</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: 8 }]}>
        <Text style={styles.title}>Analytics</Text>
        <View style={styles.datePill}>
          <Text style={styles.datePillText}>Last 30 Days</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor={Colors.primary} />}
      >
        {renderStatsCard('7-Day Rolling Stats', stats7Day)}
        {renderStatsCard('30-Day Rolling Stats', stats30Day)}
        {renderWeightChart()}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surfaceLow,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: {
    fontSize: Typography.sizes.headlineL,
    fontWeight: Typography.weights.extrabold,
    color: Colors.onSurface,
    letterSpacing: -1,
  },
  datePill: {
    backgroundColor: Colors.surfaceHighest,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  datePillText: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.hero,
    gap: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surfaceLow,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
  },
  cardTitle: {
    fontSize: Typography.sizes.titleL,
    fontWeight: Typography.weights.bold,
    color: Colors.onSurface,
    marginBottom: Spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statLabel: {
    width: 110,
    fontSize: Typography.sizes.label,
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  progressContainer: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.surfaceHighest,
    borderRadius: Radius.full,
    marginRight: Spacing.sm,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: Radius.full,
  },
  statValue: {
    width: 40,
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.onSurface,
    textAlign: 'right',
  },
  badgeContainer: {
    backgroundColor: `${Colors.primary}1a`,
    paddingHorizontal: Spacing.md,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  badgeText: {
    fontSize: Typography.sizes.label,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  emptyText: {
    fontSize: Typography.sizes.body,
    color: Colors.outline,
    fontStyle: 'italic',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  currentWeight: {
    fontSize: Typography.sizes.headlineL,
    fontWeight: Typography.weights.black,
    color: Colors.primary,
    letterSpacing: -1,
  },
  chartArea: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: 1,
    height: '100%',
  },
  bar: {
    width: '100%',
    maxWidth: 10,
    backgroundColor: Colors.primary,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    opacity: 0.85,
  },
  barLabel: {
    position: 'absolute',
    bottom: -18,
    fontSize: 8,
    color: Colors.outline,
  },
  chartMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    marginTop: 8,
  },
  chartMetaText: {
    fontSize: Typography.sizes.label,
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.medium,
    letterSpacing: 1,
    textTransform: 'uppercase',
  }
});
