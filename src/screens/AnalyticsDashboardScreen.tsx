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

      // Helper to compute stats
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
        <Text style={styles.statLabel}>🚶 Walking Task</Text>
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${stats.walk}%`, backgroundColor: Colors.accent }]} />
        </View>
        <Text style={styles.statValue}>{stats.walk}%</Text>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statLabel}>🏋️ Gym Task</Text>
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${stats.gym}%`, backgroundColor: Colors.secondary }]} />
        </View>
        <Text style={styles.statValue}>{stats.gym}%</Text>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statLabel}>➕ Extra Workouts</Text>
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
    const minW = Math.min(...weights) - 2; // pad lower bound
    const maxW = Math.max(...weights) + 2; // pad upper bound
    const current = weights[weights.length - 1];
    
    // Using a simple View-based bar chart
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
                {/* Optional: Show label on first, last, and maybe midway */}
                {(i === 0 || i === weightHistory.length - 1) && (
                  <Text style={styles.barLabel}>
                    {pt.date.substring(8, 10)}/{pt.date.substring(5,7)}
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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor={Colors.accent} />}
      >
        {renderStatsCard('7-Day Rolling Stats', stats7Day)}
        {renderStatsCard('30-Day Rolling Stats', stats30Day)}
        {renderWeightChart()}
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: {
    fontSize: Typography.sizes.hero,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  datePill: {
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  datePillText: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statLabel: {
    width: 130,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
  },
  progressContainer: {
    flex: 1,
    height: 8,
    backgroundColor: Colors.background,
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
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  badgeContainer: {
    backgroundColor: Colors.accent + '20',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.accent + '50',
  },
  badgeText: {
    fontSize: Typography.sizes.xs,
    color: Colors.accent,
    fontWeight: Typography.weights.semibold,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  currentWeight: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.accent,
  },
  chartArea: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: 2,
    height: '100%',
  },
  bar: {
    width: '100%',
    maxWidth: 12,
    backgroundColor: Colors.accent,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barLabel: {
    position: 'absolute',
    bottom: -18,
    fontSize: Typography.sizes.xs - 2,
    color: Colors.textMuted,
  },
  chartMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    marginTop: 8,
  },
  chartMetaText: {
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
  }
});
