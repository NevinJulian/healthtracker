import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllDays, getTodayDayNumber, DayWithLog } from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeStatus = 'full' | 'partial' | 'none' | 'rest';

function getStatus(day: DayWithLog): BadgeStatus {
  if (day.is_rest_day) return 'rest';
  const log = day.log;
  if (!log) return 'none';
  const completed = [log.walk_completed, log.workout_completed, log.fasting_completed].filter(
    Boolean
  ).length;
  if (completed === 3) return 'full';
  if (completed > 0) return 'partial';
  return 'none';
}

const BADGE_CONFIG: Record<BadgeStatus, { color: string; emoji: string; label: string }> = {
  full:    { color: Colors.badgeComplete, emoji: '✅', label: 'Complete' },
  partial: { color: Colors.badgePartial,  emoji: '🟡', label: 'Partial' },
  none:    { color: Colors.badgeNone,     emoji: '⬜', label: 'Pending' },
  rest:    { color: Colors.badgeRest,     emoji: '💤', label: 'Rest' },
};

// ─── Day Row ──────────────────────────────────────────────────────────────────

function DayRow({
  day,
  isToday,
  onPress,
}: {
  day: DayWithLog;
  isToday: boolean;
  onPress: () => void;
}) {
  const status = getStatus(day);
  const badge = BADGE_CONFIG[status];

  return (
    <TouchableOpacity
      style={[styles.dayRow, isToday && styles.dayRowToday]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Day number + today indicator */}
      <View style={styles.dayNumberContainer}>
        <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>
          {day.day_number}
        </Text>
        {isToday && <View style={styles.todayDot} />}
      </View>

      {/* Tasks summary */}
      <View style={styles.dayInfo}>
        <Text style={styles.dayWalk} numberOfLines={1}>
          {day.walking_task}
        </Text>
        {!day.is_rest_day && (
          <Text style={styles.dayWorkout} numberOfLines={1}>
            {day.workout_description}
          </Text>
        )}
        {day.is_meal_prep_day && (
          <Text style={styles.mealPrepTag}>🥗 Meal Prep</Text>
        )}
      </View>

      {/* Badge */}
      <View style={[styles.badge, { backgroundColor: badge.color + '20', borderColor: badge.color }]}>
        <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Day Detail Modal ─────────────────────────────────────────────────────────

function DayDetailModal({
  day,
  visible,
  onClose,
}: {
  day: DayWithLog | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!day) return null;
  const status = getStatus(day);
  const badge = BADGE_CONFIG[status];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {/* Handle */}
          <View style={styles.modalHandle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalDayLabel}>DAY</Text>
                <Text style={styles.modalDayNumber}>{day.day_number}</Text>
              </View>
              <View
                style={[
                  styles.modalBadge,
                  { backgroundColor: badge.color + '20', borderColor: badge.color },
                ]}
              >
                <Text style={[styles.modalBadgeText, { color: badge.color }]}>
                  {badge.emoji} {badge.label}
                </Text>
              </View>
            </View>

            {/* Target weight */}
            {day.target_weight != null && (
              <View style={styles.modalWeightRow}>
                <Text style={styles.modalWeightLabel}>🎯 Target weight</Text>
                <Text style={styles.modalWeightValue}>{day.target_weight} kg</Text>
              </View>
            )}

            {/* Walking */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>🚶 Walking Pad</Text>
              <Text style={styles.modalSectionBody}>{day.walking_task}</Text>
              <Text style={[styles.modalStatus, { color: day.log?.walk_completed ? Colors.success : Colors.textMuted }]}>
                {day.log?.walk_completed ? '✓ Completed' : '○ Not logged'}
              </Text>
            </View>

            {/* Workout */}
            {!day.is_rest_day && (
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>🏋️ Training</Text>
                <Text style={styles.modalSectionBody}>{day.workout_description}</Text>
                <Text style={[styles.modalStatus, { color: day.log?.workout_completed ? Colors.success : Colors.textMuted }]}>
                  {day.log?.workout_completed ? '✓ Completed' : '○ Not logged'}
                </Text>
              </View>
            )}

            {/* Fasting */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>⏱️ Intermittent Fasting</Text>
              <Text style={styles.modalSectionBody}>16:8 — eating window 12 pm → 8 pm</Text>
              <Text style={[styles.modalStatus, { color: day.log?.fasting_completed ? Colors.success : Colors.textMuted }]}>
                {day.log?.fasting_completed ? '✓ Completed' : '○ Not logged'}
              </Text>
            </View>

            {/* Meal Prep */}
            {day.is_meal_prep_day && (
              <View style={[styles.modalSection, styles.modalMealPrep]}>
                <Text style={styles.modalSectionTitle}>🥗 Meal Prep Day</Text>
                <Text style={styles.modalSectionBody}>
                  Check the Meal Prep tab for your grocery list and recipes.
                </Text>
              </View>
            )}

            <View style={{ height: 32 }} />
          </ScrollView>

          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Overview Screen ──────────────────────────────────────────────────────────

export default function OverviewScreen() {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<DayWithLog[]>([]);
  const [todayDayNumber, setTodayDayNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayWithLog | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    (async () => {
      const [allDays, todayDN] = await Promise.all([getAllDays(), getTodayDayNumber()]);
      setDays(allDays);
      setTodayDayNumber(todayDN);
      setLoading(false);
      // Scroll to today
      setTimeout(() => {
        const idx = todayDN - 1;
        listRef.current?.scrollToIndex({ index: Math.max(0, idx - 2), animated: true });
      }, 300);
    })();
  }, []);

  const completedCount = days.filter((d) => getStatus(d) === 'full').length;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.overviewHeader, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.overviewTitle}>90-Day Overview</Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statNumber}>{completedCount}</Text>
            <Text style={styles.statLabel}> days done</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statNumber}>{90 - completedCount}</Text>
            <Text style={styles.statLabel}> remaining</Text>
          </View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={days}
        keyExtractor={(item) => String(item.day_number)}
        renderItem={({ item }) => (
          <DayRow
            day={item}
            isToday={item.day_number === todayDayNumber}
            onPress={() => {
              setSelectedDay(item);
              setModalVisible(true);
            }}
          />
        )}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={() => {}}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <DayDetailModal
        day={selectedDay}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Overview header — paddingTop applied dynamically via insets.top
  overviewHeader: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  overviewTitle: {
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.bold,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statNumber: {
    fontSize: Typography.sizes.md,
    color: Colors.accent,
    fontWeight: Typography.weights.bold,
  },
  statLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
  },

  // List
  listContent: {
    paddingVertical: Spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 80,
  },

  // Day Row
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  dayRowToday: {
    backgroundColor: Colors.accentGlow,
  },
  dayNumberContainer: {
    width: 44,
    alignItems: 'center',
  },
  dayNumber: {
    fontSize: Typography.sizes.xl,
    color: Colors.textMuted,
    fontWeight: Typography.weights.bold,
    textAlign: 'center',
  },
  dayNumberToday: {
    color: Colors.accent,
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
    marginTop: 2,
  },
  dayInfo: {
    flex: 1,
    gap: 2,
  },
  dayWalk: {
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.medium,
  },
  dayWorkout: {
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  mealPrepTag: {
    fontSize: Typography.sizes.xs,
    color: Colors.accent,
    fontWeight: Typography.weights.semibold,
    marginTop: 2,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  badgeEmoji: {
    fontSize: 16,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 24,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  modalDayLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.semibold,
    letterSpacing: 1.2,
  },
  modalDayNumber: {
    fontSize: Typography.sizes.hero,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.black,
  },
  modalBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  modalBadgeText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  modalWeightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.secondaryGlow,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.secondary,
  },
  modalWeightLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
  },
  modalWeightValue: {
    color: Colors.secondary,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
  },
  modalSection: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: 4,
  },
  modalMealPrep: {
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  modalSectionTitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontWeight: Typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  modalSectionBody: {
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  modalStatus: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    marginTop: 4,
  },
  modalClose: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCloseText: {
    color: Colors.textPrimary,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
  },
});
