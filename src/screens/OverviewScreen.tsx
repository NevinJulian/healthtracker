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
import {
  DailyLogEntry,
  getRollingWindow,
  syncRollingSchedule,
  toISODate,
} from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

type BadgeStatus = 'full' | 'partial' | 'none' | 'rest';

function getStatus(entry: DailyLogEntry, isToday: boolean): BadgeStatus {
  if (isToday && !entry.walk_completed && !entry.hammer_completed && !entry.fasting_completed) {
    // Today with nothing done yet — still "pending", not rest
  }
  const done = [
    entry.walk_completed,
    entry.hammer_completed,
    entry.fasting_completed,
  ].filter(Boolean).length;
  if (done === 3) return 'full';
  if (done > 0) return 'partial';
  return 'none';
}

const BADGE: Record<BadgeStatus, { emoji: string; color: string; label: string }> = {
  full:    { emoji: '✓', color: Colors.tertiary, label: 'Complete' },
  partial: { emoji: '◑', color: Colors.secondary, label: 'Partial' },
  none:    { emoji: '○', color: Colors.outline, label: 'Pending' },
  rest:    { emoji: 'z', color: Colors.onSurfaceVariant, label: 'Rest' },
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function formatShortDate(iso: string): { day: string; date: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  };
}

function isFuture(iso: string): boolean {
  return iso > toISODate();
}

// ─── Row component ────────────────────────────────────────────────────────────

function DayRow({
  entry,
  isToday,
  onPress,
}: {
  entry: DailyLogEntry;
  isToday: boolean;
  onPress: () => void;
}) {
  const status = getStatus(entry, isToday);
  const badge = BADGE[status];
  const future = isFuture(entry.date);
  const { day, date } = formatShortDate(entry.date);

  return (
    <TouchableOpacity
      style={[styles.row, isToday && styles.rowToday, future && styles.rowFuture]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Date pill */}
      <View style={styles.datePill}>
        <Text style={[styles.dayShort, isToday && styles.dayShortToday]}>{day}</Text>
        <Text style={[styles.dateNum, isToday && styles.dateNumToday]}>{date}</Text>
        {isToday && <View style={styles.todayDot} />}
      </View>

      {/* Summary */}
      <View style={styles.rowInfo}>
        <Text style={[styles.rowWalk, future && styles.rowTextFuture]} numberOfLines={1}>
          🚶 {entry.walking_task}
        </Text>
        <Text style={[styles.rowHammer, future && styles.rowTextFuture]} numberOfLines={1}>
          🏋️ {entry.hammer_task}
        </Text>
        {entry.is_meal_prep_day && (
          <Text style={styles.mealPrepTag}>🥗 Meal Prep</Text>
        )}
      </View>

      {/* Badge — future days show clock */}
      <View style={[styles.badge, { backgroundColor: badge.color + '22', borderColor: badge.color }]}>
        <Text style={styles.badgeEmoji}>{future ? '🕐' : badge.emoji}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Day Detail Modal ─────────────────────────────────────────────────────────

function DayDetailModal({
  entry,
  isToday,
  visible,
  onClose,
}: {
  entry: DailyLogEntry | null;
  isToday: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  if (!entry) return null;
  const { day, date } = formatShortDate(entry.date);
  const status = getStatus(entry, isToday);
  const badge = BADGE[status];
  const future = isFuture(entry.date);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalDayLabel}>{day}</Text>
                <Text style={styles.modalDateValue}>{date}</Text>
                {isToday && <Text style={styles.modalTodayTag}>TODAY</Text>}
              </View>
              <View style={[styles.modalBadge, { backgroundColor: badge.color + '22', borderColor: badge.color }]}>
                <Text style={[styles.modalBadgeText, { color: badge.color }]}>
                  {future ? '🕐 Upcoming' : `${badge.emoji} ${badge.label}`}
                </Text>
              </View>
            </View>

            {/* Walking */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>🚶 Walking</Text>
              <Text style={styles.modalSectionBody}>{entry.walking_task}</Text>
              {!future && (
                <Text style={[styles.modalStatus, { color: entry.walk_completed ? Colors.accent : Colors.textMuted }]}>
                  {entry.walk_completed ? '✓ Completed' : '○ Not logged'}
                </Text>
              )}
            </View>

            {/* Hammer */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>🏋️ Hammer Multi-Gym</Text>
              <Text style={styles.modalSectionBody}>{entry.hammer_task}</Text>
              {!future && (
                <Text style={[styles.modalStatus, { color: entry.hammer_completed ? Colors.accent : Colors.textMuted }]}>
                  {entry.hammer_completed ? '✓ Completed' : '○ Not logged'}
                </Text>
              )}
            </View>

            {/* Fasting */}
            {!future && (
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>⏱️ Intermittent Fasting</Text>
                <Text style={styles.modalSectionBody}>16:8 — eating window 12 pm → 8 pm</Text>
                <Text style={[styles.modalStatus, { color: entry.fasting_completed ? Colors.accent : Colors.textMuted }]}>
                  {entry.fasting_completed ? '✓ Completed' : '○ Not logged'}
                </Text>
              </View>
            )}

            {/* Meal Prep */}
            {entry.is_meal_prep_day && (
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OverviewScreen() {
  const [entries, setEntries] = useState<DailyLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DailyLogEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const listRef = useRef<FlatList>(null);
  const today = toISODate();

  useEffect(() => {
    (async () => {
      await syncRollingSchedule();
      const data = await getRollingWindow();
      setEntries(data);
      setLoading(false);

      // Scroll to today
      const todayIdx = data.findIndex((e) => e.date === today);
      if (todayIdx >= 0) {
        setTimeout(() => {
          listRef.current?.scrollToIndex({
            index: Math.max(0, todayIdx - 2),
            animated: true,
          });
        }, 300);
      }
    })();
  }, [today]);

  const completedCount = entries.filter(
    (e) => e.walk_completed && e.hammer_completed && e.fasting_completed
  ).length;

  const pastEntries = entries.filter((e) => e.date < today).length;
  const futureEntries = entries.filter((e) => e.date > today).length;

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 8 }]}>
        <Text style={styles.headerTitle}>Rolling Schedule</Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statNum}>{completedCount}</Text>
            <Text style={styles.statLabel}> done</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statNum}>{pastEntries + 1}</Text>
            <Text style={styles.statLabel}> tracked</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statNum}>{futureEntries}</Text>
            <Text style={styles.statLabel}> upcoming</Text>
          </View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={entries}
        keyExtractor={(item) => item.date}
        renderItem={({ item }) => (
          <DayRow
            entry={item}
            isToday={item.date === today}
            onPress={() => {
              setSelected(item);
              setModalVisible(true);
            }}
          />
        )}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onScrollToIndexFailed={() => {}}
        showsVerticalScrollIndicator={false}
      />

      <DayDetailModal
        entry={selected}
        isToday={selected?.date === today}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centred: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  header: {
    backgroundColor: Colors.surfaceLow,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: Typography.sizes.headlineL,
    color: Colors.onSurface,
    fontWeight: Typography.weights.extrabold,
    letterSpacing: -1,
  },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: Colors.surfaceHighest,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  statNum: {
    fontSize: Typography.sizes.body,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  statLabel: {
    fontSize: Typography.sizes.label,
    color: Colors.onSurfaceVariant,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  listContent: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xl },
  separator: { height: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
    backgroundColor: Colors.surfaceLow,
    borderRadius: Radius.lg,
  },
  rowToday: { backgroundColor: `${Colors.primary}14` },
  rowFuture: { opacity: 0.6 },

  datePill: { width: 52, alignItems: 'center', gap: 2 },
  dayShort: {
    fontSize: Typography.sizes.label,
    color: Colors.outline,
    fontWeight: Typography.weights.bold,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  dayShortToday: { color: Colors.primary },
  dateNum: {
    fontSize: Typography.sizes.body,
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.semibold,
    textAlign: 'center',
  },
  dateNumToday: { color: Colors.primary, fontWeight: Typography.weights.bold },
  todayDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: Colors.primary, marginTop: 2,
  },

  rowInfo: { flex: 1, gap: 2 },
  rowWalk: {
    fontSize: Typography.sizes.body,
    color: Colors.onSurface,
    fontWeight: Typography.weights.medium,
  },
  rowHammer: {
    fontSize: Typography.sizes.bodyS,
    color: Colors.onSurfaceVariant,
  },
  rowTextFuture: { color: Colors.outline },
  mealPrepTag: {
    fontSize: Typography.sizes.label,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 2,
  },

  badge: {
    width: 36, height: 36, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceHighest,
  },
  badgeEmoji: { fontSize: 14, color: Colors.onSurface },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surfaceLow,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: 32,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 40, height: 4, backgroundColor: Colors.surfaceHighest,
    borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: Spacing.xl,
  },
  modalDayLabel: {
    fontSize: Typography.sizes.label, color: Colors.outline,
    fontWeight: Typography.weights.bold, letterSpacing: 2,
    textTransform: 'uppercase',
  },
  modalDateValue: {
    fontSize: Typography.sizes.displayHero, color: Colors.onSurface,
    fontWeight: Typography.weights.black, letterSpacing: -2,
    lineHeight: 56,
  },
  modalTodayTag: {
    fontSize: Typography.sizes.label, color: Colors.primary,
    fontWeight: Typography.weights.bold, letterSpacing: 2,
    textTransform: 'uppercase',
  },
  modalBadge: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceHighest,
  },
  modalBadgeText: {
    fontSize: Typography.sizes.label, fontWeight: Typography.weights.bold,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  modalSection: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.xl, marginBottom: Spacing.sm, gap: 4,
  },
  modalMealPrep: { borderLeftWidth: 4, borderLeftColor: Colors.primary },
  modalSectionTitle: {
    fontSize: Typography.sizes.label, color: Colors.outline,
    fontWeight: Typography.weights.bold,
    textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4,
  },
  modalSectionBody: {
    fontSize: Typography.sizes.body, color: Colors.onSurface, lineHeight: 22,
  },
  modalStatus: {
    fontSize: Typography.sizes.bodyS, fontWeight: Typography.weights.semibold, marginTop: 4,
  },
  modalClose: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingVertical: Spacing.md, alignItems: 'center',
    marginTop: Spacing.xl,
  },
  modalCloseText: {
    color: Colors.onPrimary, fontSize: Typography.sizes.label,
    fontWeight: Typography.weights.bold, letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});


