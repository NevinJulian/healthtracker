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
import { Ionicons } from '@expo/vector-icons';
import {
  DailyLogEntry,
  getRollingWindow,
  syncRollingSchedule,
  toISODate,
} from '../db/database';
import { dateKeyToLocalDate } from '../utils/dates';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  Card,
  Row,
  IconChip,
  Pill,
  Button,
  ScreenHeader,
} from '../components';
import { iconChipIconColor } from '../components/IconChip';

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

// Verdure accent mapping: complete=sage, partial=gold, pending/rest=sky
const BADGE_ACCENT: Record<BadgeStatus, 'sage' | 'gold' | 'sky'> = {
  full:    'sage',
  partial: 'gold',
  none:    'sky',
  rest:    'sky',
};

const BADGE_LABEL: Record<BadgeStatus, string> = {
  full:    'Complete',
  partial: 'Partial',
  none:    'Pending',
  rest:    'Rest',
};

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const BADGE_ICON: Record<BadgeStatus, IoniconsName> = {
  full:    'checkmark-circle-outline',
  partial: 'ellipse-outline',
  none:    'ellipse-outline',
  rest:    'moon-outline',
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function formatShortDate(iso: string): { day: string; date: string } {
  // Use dateKeyToLocalDate so the date is local midnight, not UTC midnight
  const d = dateKeyToLocalDate(iso);
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  };
}

function isFuture(iso: string): boolean {
  return iso > toISODate();
}

// ─── Day Row ──────────────────────────────────────────────────────────────────

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
  const future = isFuture(entry.date);
  const { day, date } = formatShortDate(entry.date);
  const accent = BADGE_ACCENT[status];

  // Date column rendered as Row's leading slot
  const dateColumn = (
    <View style={styles.dateColumn}>
      <Text style={[styles.dayAbbr, isToday && styles.dayAbbrToday]}>{day}</Text>
      <Text style={[styles.dateStr, isToday && styles.dateStrToday]}>{date}</Text>
      {isToday && <View style={styles.todayDot} />}
    </View>
  );

  // Status IconChip as Row's trailing slot
  const statusIconName: IoniconsName = future ? 'time-outline' : BADGE_ICON[status];
  const statusIconColor = future ? Colors.skyDeep : (
    accent === 'sage' ? Colors.sageDeep :
    accent === 'gold' ? Colors.goldDeep : Colors.skyDeep
  );
  const statusChip = (
    <IconChip
      icon={<Ionicons name={statusIconName} size={18} color={statusIconColor} />}
      accent={future ? 'sky' : accent}
      size={36}
    />
  );

  // Subtitle combines walking task + optional meal prep flag
  const subtitleParts = [entry.walking_task];
  if (entry.is_meal_prep_day) subtitleParts.push('Meal Prep');
  const subtitle = subtitleParts.join(' · ');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${day} ${date}${isToday ? ', today' : ''}, ${entry.hammer_task}, status: ${future ? 'upcoming' : BADGE_LABEL[status]}`}
    >
      <Row
        leading={dateColumn}
        title={entry.hammer_task}
        subtitle={subtitle}
        trailing={statusChip}
        style={[
          styles.dayRow,
          isToday && styles.dayRowToday,
          future && styles.dayRowFuture,
        ]}
      />
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
  const future = isFuture(entry.date);
  const accent = BADGE_ACCENT[status];

  // Small completion chip for trailing slot of each activity Row
  function CompletionChip({ done }: { done: boolean }) {
    return (
      <IconChip
        icon={
          <Ionicons
            name={done ? 'checkmark-circle-outline' : 'ellipse-outline'}
            size={16}
            color={iconChipIconColor(done ? 'sage' : 'sky')}
          />
        }
        accent={done ? 'sage' : 'sky'}
        size={32}
      />
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {/* Handle */}
          <View style={styles.modalHandle} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
            {/* Modal header */}
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalTitleBlock}>
                <Text style={styles.modalDayAbbr}>{day}</Text>
                <Text style={styles.modalDateLarge}>{date}</Text>
                {isToday && (
                  <Pill label="TODAY" accent="sage" style={styles.modalTodayPill} />
                )}
              </View>
              <Pill
                label={future ? 'Upcoming' : BADGE_LABEL[status]}
                accent={future ? 'sky' : accent}
              />
            </View>

            {/* Walking */}
            <View style={styles.modalSectionGap}>
              <Text style={styles.modalSectionLabel}>WALKING</Text>
              <Card style={styles.modalCard}>
                <Row
                  leading={
                    <IconChip
                      icon={<Ionicons name="walk-outline" size={18} color={iconChipIconColor('sky')} />}
                      accent="sky"
                      size={36}
                    />
                  }
                  title={entry.walking_task}
                  subtitle={future ? undefined : (entry.walk_completed ? 'Completed' : 'Not logged')}
                  trailing={!future ? <CompletionChip done={entry.walk_completed} /> : undefined}
                  style={styles.modalCardRow}
                />
              </Card>
            </View>

            {/* Hammer */}
            <View style={styles.modalSectionGap}>
              <Text style={styles.modalSectionLabel}>HAMMER MULTI-GYM</Text>
              <Card style={styles.modalCard}>
                <Row
                  leading={
                    <IconChip
                      icon={<Ionicons name="barbell-outline" size={18} color={iconChipIconColor('sage')} />}
                      accent="sage"
                      size={36}
                    />
                  }
                  title={entry.hammer_task}
                  subtitle={future ? undefined : (entry.hammer_completed ? 'Completed' : 'Not logged')}
                  trailing={!future ? <CompletionChip done={entry.hammer_completed} /> : undefined}
                  style={styles.modalCardRow}
                />
              </Card>
            </View>

            {/* Fasting — past/today only */}
            {!future && (
              <View style={styles.modalSectionGap}>
                <Text style={styles.modalSectionLabel}>INTERMITTENT FASTING</Text>
                <Card style={styles.modalCard}>
                  <Row
                    leading={
                      <IconChip
                        icon={<Ionicons name="time-outline" size={18} color={iconChipIconColor('gold')} />}
                        accent="gold"
                        size={36}
                      />
                    }
                    title="16:8 — eating window 12 pm → 8 pm"
                    subtitle={entry.fasting_completed ? 'Completed' : 'Not logged'}
                    trailing={<CompletionChip done={entry.fasting_completed} />}
                    style={styles.modalCardRow}
                  />
                </Card>
              </View>
            )}

            {/* Meal Prep */}
            {entry.is_meal_prep_day && (
              <View style={styles.modalSectionGap}>
                <Text style={styles.modalSectionLabel}>MEAL PREP</Text>
                <Card style={styles.modalCard}>
                  <Row
                    leading={
                      <IconChip
                        icon={<Ionicons name="nutrition-outline" size={18} color={iconChipIconColor('clay')} />}
                        accent="clay"
                        size={36}
                      />
                    }
                    title="Meal Prep Day"
                    subtitle="Check the Meal Prep tab for your grocery list and recipes."
                    style={styles.modalCardRow}
                  />
                </Card>
              </View>
            )}

            <View style={{ height: Spacing.md }} />
          </ScrollView>

          {/* Close button */}
          <View style={styles.modalFooter}>
            <Button title="Close" variant="ghost" onPress={onClose} />
          </View>
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
        <ActivityIndicator size="large" color={Colors.sage} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <View style={styles.headerBlock}>
        <ScreenHeader
          title="Rolling Schedule"
          subtitle="7-day training window"
          trailing={
            <View style={styles.statRow}>
              <Pill label={`${completedCount} done`} accent="sage" />
              <Pill label={`${pastEntries + 1} tracked`} accent="gold" />
              <Pill label={`${futureEntries} ahead`} accent="sky" />
            </View>
          }
        />
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

  // ── Header block ──────────────────────────────────────────────────────────
  headerBlock: {
    backgroundColor: Colors.surface,
    paddingTop: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },

  // ── List ──────────────────────────────────────────────────────────────────
  listContent: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
  },
  separator: { height: 0 },

  // ── Day row ───────────────────────────────────────────────────────────────
  dayRow: {
    borderRadius: Radius.md,
  },
  dayRowToday: {
    backgroundColor: Colors.sageTint,
    borderWidth: 1,
    borderColor: Colors.sage,
  },
  dayRowFuture: {
    opacity: 0.6,
  },

  // Date column (Row leading slot)
  dateColumn: {
    width: 44,
    alignItems: 'center',
    gap: 1,
  },
  dayAbbr: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    letterSpacing: 0.6,
  },
  dayAbbrToday: {
    color: Colors.sageDeep,
  },
  dateStr: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 15,
  },
  dateStrToday: {
    color: Colors.sageDeep,
  },
  todayDot: {
    width: 5,
    height: 5,
    borderRadius: Radius.full,
    backgroundColor: Colors.sage,
    marginTop: 2,
  },

  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(44,53,46,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 0,
    maxHeight: '85%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: Colors.line2,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  modalScroll: {
    paddingBottom: Spacing.md,
  },

  // Modal header
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xl,
  },
  modalTitleBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  modalDayAbbr: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  modalDateLarge: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.hero,
    color: Colors.textPrimary,
    letterSpacing: -1,
    lineHeight: Typography.sizes.hero * 1.1,
  },
  modalTodayPill: {
    marginTop: Spacing.xs,
  },

  // Section label + card
  modalSectionGap: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  modalSectionLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: Spacing.xs,
  },
  modalCard: {
    padding: 0,
    overflow: 'hidden',
  },
  modalCardRow: {
    borderRadius: Radius.md,
    minHeight: 52,
  },

  // Footer with close button
  modalFooter: {
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
});
