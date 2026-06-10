import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { getBioForceLibrary, BioForceExercise } from '../db/database';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import Button from './Button';
import Pill from './Pill';

export interface BioForceModalProps {
  isVisible: boolean;
  onClose: () => void;
  onAddWorkout: (workout: {
    id: string;
    name: string;
    muscle_group: string;
    sets: string;
    reps: string;
    completed: boolean;
  }) => void;
}

// ─── Difficulty helpers ───────────────────────────────────────────────────────

/** Returns the Verdure tint bg colour for a difficulty level. */
function difficultyTint(diff: string): string {
  if (diff === 'Beginner') return Colors.sageTint;
  if (diff === 'Intermediate') return Colors.goldTint;
  return Colors.clayTint;
}

/** Returns the Verdure deep-shade text colour for a difficulty level. */
function difficultyDeep(diff: string): string {
  if (diff === 'Beginner') return Colors.sageDeep;
  if (diff === 'Intermediate') return Colors.goldDeep;
  return Colors.clayDeep;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BioForceModal({ isVisible, onClose, onAddWorkout }: BioForceModalProps) {
  const [library, setLibrary] = useState<BioForceExercise[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Filters
  const [selMuscleGroups, setSelMuscleGroups] = useState<string[]>([]);
  const [selDifficulties, setSelDifficulties] = useState<string[]>([]);
  const [selAttachments, setSelAttachments] = useState<string[]>([]);

  const [sortBy, setSortBy] = useState<'A-Z' | 'EasyFirst' | 'HardFirst' | 'MuscleGroup'>('A-Z');
  const [selectedEx, setSelectedEx] = useState<BioForceExercise | null>(null);

  // Load library
  useEffect(() => {
    if (isVisible && library.length === 0) {
      getBioForceLibrary().then(setLibrary).catch(console.error);
    }
  }, [isVisible, library.length]);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Derived filter options
  const allMuscleGroups = useMemo(
    () => Array.from(new Set(library.map(e => e.muscleGroup))).sort(),
    [library],
  );
  const allDifficulties = ['Beginner', 'Intermediate', 'Advanced'];

  // Filtered & Sorted List
  const filteredList = useMemo(() => {
    let list = library;

    if (debouncedSearch) {
      const lower = debouncedSearch.toLowerCase();
      list = list.filter(
        e =>
          e.title.toLowerCase().includes(lower) ||
          e.description.toLowerCase().includes(lower) ||
          e.muscleGroup.toLowerCase().includes(lower),
      );
    }

    if (selMuscleGroups.length > 0) {
      list = list.filter(e => selMuscleGroups.includes(e.muscleGroup));
    }
    if (selDifficulties.length > 0) {
      list = list.filter(e => selDifficulties.includes(e.difficulty));
    }
    if (selAttachments.length > 0) {
      list = list.filter(e => selAttachments.includes(e.attachment));
    }

    list = [...list].sort((a, b) => {
      if (sortBy === 'A-Z') return a.title.localeCompare(b.title);
      if (sortBy === 'MuscleGroup') return a.muscleGroup.localeCompare(b.muscleGroup);

      const diffVal = (d: string) => (d === 'Beginner' ? 1 : d === 'Intermediate' ? 2 : 3);
      if (sortBy === 'EasyFirst') return diffVal(a.difficulty) - diffVal(b.difficulty);
      if (sortBy === 'HardFirst') return diffVal(b.difficulty) - diffVal(a.difficulty);
      return 0;
    });

    return list;
  }, [library, debouncedSearch, selMuscleGroups, selDifficulties, selAttachments, sortBy]);

  const toggleFilter = (list: string[], setList: (l: string[]) => void, val: string) => {
    if (list.includes(val)) setList(list.filter(i => i !== val));
    else setList([...list, val]);
  };

  const handleWatchVideo = (url: string) => {
    if (url) Linking.openURL(url).catch(console.error);
  };

  const handleAdd = () => {
    if (selectedEx) {
      onAddWorkout({
        id: `bio-${selectedEx.id}-${Date.now()}`,
        name: selectedEx.title,
        muscle_group: selectedEx.muscleGroup,
        sets: selectedEx.sets || '3',
        reps: selectedEx.reps || '10',
        completed: false,
      });
      setSelectedEx(null);
      onClose();
    }
  };

  // ─── 1) Details Panel ──────────────────────────────────────────────────────

  if (selectedEx) {
    return (
      <Modal visible={isVisible} animationType="slide" transparent={true}>
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.flex}
          >
            <View style={styles.overlay}>
              <View style={styles.sheet}>
                {/* Drag handle */}
                <View style={styles.dragHandle} />

                {/* Header */}
                <View style={styles.header}>
                  <TouchableOpacity onPress={() => setSelectedEx(null)} hitSlop={styles.hitSlop}>
                    <Text style={styles.backBtn}>← Back</Text>
                  </TouchableOpacity>
                  <Text style={styles.selectedTitle} numberOfLines={1}>
                    {selectedEx.title}
                  </Text>
                </View>

                <ScrollView contentContainerStyle={styles.detailScroll}>
                  {/* Quick Stats Grid */}
                  <View style={styles.statsGrid}>
                    <View style={styles.statCell}>
                      <Text style={styles.statLabel}>MUSCLE</Text>
                      <Text style={styles.statValue}>{selectedEx.muscleGroup}</Text>
                    </View>
                    <View style={[styles.statCell, styles.statCellBorderLeft]}>
                      <Text style={styles.statLabel}>DIFFICULTY</Text>
                      <Text
                        style={[styles.statValue, { color: difficultyDeep(selectedEx.difficulty) }]}
                      >
                        {selectedEx.difficulty}
                      </Text>
                    </View>
                    <View style={[styles.statCell, styles.statCellBorderTop]}>
                      <Text style={styles.statLabel}>REC. SETS</Text>
                      <Text style={styles.statValue}>{selectedEx.sets}</Text>
                    </View>
                    <View style={[styles.statCell, styles.statCellBorderLeft, styles.statCellBorderTop]}>
                      <Text style={styles.statLabel}>REC. REPS</Text>
                      <Text style={styles.statValue}>{selectedEx.reps}</Text>
                    </View>
                    <View style={[styles.statCell, styles.statCellBorderTop]}>
                      <Text style={styles.statLabel}>ATTACHMENT</Text>
                      <Text style={styles.statValue}>{selectedEx.attachment}</Text>
                    </View>
                    <View style={[styles.statCell, styles.statCellBorderLeft, styles.statCellBorderTop]}>
                      <Text style={styles.statLabel}>POSITION</Text>
                      <Text style={styles.statValue}>{selectedEx.cablePosition}</Text>
                    </View>
                  </View>

                  {/* Video Button */}
                  {selectedEx.videoId ? (
                    <TouchableOpacity
                      style={styles.videoButton}
                      onPress={() =>
                        handleWatchVideo(
                          `https://www.youtube.com/watch?v=${selectedEx.videoId}`,
                        )
                      }
                      activeOpacity={0.75}
                    >
                      <View style={styles.playIconContainer}>
                        <Text style={styles.playIcon}>▶</Text>
                      </View>
                      <Text style={styles.videoText}>Watch Tutorial</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.videoButton, styles.videoButtonEmpty]}>
                      <Text style={styles.videoTextMuted}>No Video Available</Text>
                    </View>
                  )}

                  {/* Description */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Description</Text>
                    <Text style={styles.bodyText}>{selectedEx.description}</Text>
                  </View>

                  {/* Muscles Engaged */}
                  {(selectedEx.primaryMuscles.length > 0 ||
                    selectedEx.secondaryMuscles.length > 0) && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Muscles Engaged</Text>
                      <Text style={styles.bodyText}>
                        <Text style={styles.bodyTextBold}>Primary: </Text>
                        {selectedEx.primaryMuscles.join(', ') || 'None'}
                      </Text>
                      <Text style={styles.bodyText}>
                        <Text style={styles.bodyTextBold}>Secondary: </Text>
                        {selectedEx.secondaryMuscles.join(', ') || 'None'}
                      </Text>
                    </View>
                  )}

                  {/* Pro Tips */}
                  {selectedEx.tips && selectedEx.tips.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Pro Tips</Text>
                      {selectedEx.tips.map((t, i) => (
                        <Text key={i} style={styles.bodyText}>
                          • {t}
                        </Text>
                      ))}
                    </View>
                  )}
                </ScrollView>

                {/* Add button */}
                <View style={styles.addPanel}>
                  <Button
                    title="Add to Today's Checklist"
                    variant="primary"
                    onPress={handleAdd}
                  />
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  // ─── 2) Main List Panel ────────────────────────────────────────────────────

  return (
    <Modal visible={isVisible} animationType="slide" transparent={true}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {/* Drag handle */}
            <View style={styles.dragHandle} />

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Bio Force Library</Text>
              <TouchableOpacity onPress={onClose} hitSlop={styles.hitSlop}>
                <Text style={styles.closeBtn}>Close</Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search 113+ exercises..."
                placeholderTextColor={Colors.textMuted}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearch('')}
                  style={styles.clearSearch}
                  hitSlop={styles.hitSlop}
                >
                  <Text style={styles.clearSearchText}>×</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Filter chips */}
            <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterScroll}
              >
                {allDifficulties.map(diff => {
                  const active = selDifficulties.includes(diff);
                  return (
                    <TouchableOpacity
                      key={diff}
                      style={[
                        styles.chip,
                        active && {
                          backgroundColor: difficultyTint(diff),
                          borderColor: difficultyDeep(diff),
                        },
                      ]}
                      onPress={() => toggleFilter(selDifficulties, setSelDifficulties, diff)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && { color: difficultyDeep(diff) },
                        ]}
                      >
                        {diff}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {allMuscleGroups.map(grp => {
                  const active = selMuscleGroups.includes(grp);
                  return (
                    <TouchableOpacity
                      key={grp}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleFilter(selMuscleGroups, setSelMuscleGroups, grp)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {grp}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Results count */}
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {filteredList.length} exercise{filteredList.length !== 1 ? 's' : ''} found
              </Text>
            </View>

            {/* Exercise list */}
            <ScrollView contentContainerStyle={styles.listContent}>
              {filteredList.map(ex => (
                <TouchableOpacity
                  key={ex.id}
                  style={styles.card}
                  onPress={() => setSelectedEx(ex)}
                  activeOpacity={0.75}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{ex.title}</Text>
                  </View>
                  <View style={styles.cardBadges}>
                    <Pill label={ex.difficulty} accent={difficultyAccent(ex.difficulty)} />
                    <Text style={styles.badgeSeparator}>•</Text>
                    <Text style={styles.badgeMuscle}>{ex.muscleGroup}</Text>
                    <Text style={styles.badgeSeparator}>•</Text>
                    <Text style={styles.badgeAttachment}>{ex.attachment}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {filteredList.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>
                    No exercises match your search filters.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** Maps difficulty string to a Verdure accent family for the Pill component. */
function difficultyAccent(diff: string): 'sage' | 'gold' | 'clay' {
  if (diff === 'Beginner') return 'sage';
  if (diff === 'Intermediate') return 'gold';
  return 'clay';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Layout scaffolding
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  // Pine-tinted overlay scrim (DESIGN.md §2 — not pure black)
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(44,53,46,0.45)',
    justifyContent: 'flex-end',
  },
  // Bottom sheet surface
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  // Drag handle
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.line2,
    alignSelf: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },

  // Header row
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  title: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  closeBtn: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },

  // Search bar
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    position: 'relative',
  },
  searchInput: {
    backgroundColor: Colors.canvasSunken,
    color: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingRight: Spacing.xxl + Spacing.md,
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    borderWidth: 1,
    borderColor: Colors.line2,
  },
  clearSearch: {
    position: 'absolute',
    right: Spacing.lg + Spacing.sm,
    top: Spacing.md + Spacing.md,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.line2,
    borderRadius: Radius.full,
  },
  clearSearchText: {
    fontFamily: Typography.title,
    color: Colors.textSecondary,
    fontWeight: Typography.weights.bold,
    lineHeight: 18,
  },

  // Filter chips
  filterScroll: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.line2,
    backgroundColor: Colors.canvasSunken,
    marginRight: Spacing.sm,
  },
  chipActive: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.sageDeep,
  },
  chipText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontWeight: Typography.weights.medium,
  },
  chipTextActive: {
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },

  // Results count
  resultsHeader: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  resultsCount: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Exercise list
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xxl + Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  cardHeader: {
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },
  cardBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  badgeSeparator: {
    fontFamily: Typography.body,
    color: Colors.textMuted,
    fontSize: Typography.sizes.xs,
    marginHorizontal: Spacing.xs,
  },
  badgeMuscle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.medium,
  },
  badgeAttachment: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
  },

  // Empty state
  emptyState: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
  },
  emptyStateText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },

  // ─── Details Panel ─────────────────────────────────────────────────────────

  detailScroll: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },

  // Back button + title
  backBtn: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
    minWidth: 60,
  },
  selectedTitle: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.lg,
    color: Colors.textPrimary,
    letterSpacing: -0.4,
    flex: 1,
    textAlign: 'center',
    marginRight: 60, // offset balances back button width
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: Colors.canvasSunken,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  statCell: {
    flex: 1,
    minWidth: '50%',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  statCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.line,
  },
  statCellBorderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  statLabel: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs - 1,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  statValue: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },

  // Video button / placeholder
  videoButton: {
    height: 160,
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.md,
    marginBottom: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  videoButtonEmpty: {
    backgroundColor: Colors.canvasSunken,
  },
  playIconContainer: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  playIcon: {
    color: Colors.surface,
    fontSize: Typography.sizes.lg,
    marginLeft: Spacing.xs, // visual balance for play triangle
  },
  videoText: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    color: Colors.sageDeep,
    fontWeight: Typography.weights.semibold,
  },
  videoTextMuted: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
  },

  // Section blocks
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
    marginBottom: Spacing.sm,
  },
  bodyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: Typography.sizes.sm * 1.55,
    marginBottom: Spacing.xs,
  },
  bodyTextBold: {
    fontFamily: Typography.title,
    color: Colors.textPrimary,
    fontWeight: Typography.weights.semibold,
  },

  // Add-to-checklist panel
  addPanel: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.xl,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    backgroundColor: Colors.surface,
  },

  // Hit slop for small touch targets
  hitSlop: {
    top: 8,
    bottom: 8,
    left: 8,
    right: 8,
  } as const,
});
