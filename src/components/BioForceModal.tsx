import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  const allMuscleGroups = useMemo(() => Array.from(new Set(library.map(e => e.muscleGroup))).sort(), [library]);
  const allAttachments = useMemo(() => Array.from(new Set(library.map(e => e.attachment))).sort(), [library]);
  const allDifficulties = ['Beginner', 'Intermediate', 'Advanced'];

  // Filtered & Sorted List
  const filteredList = useMemo(() => {
    let list = library;

    if (debouncedSearch) {
      const lower = debouncedSearch.toLowerCase();
      list = list.filter(e => 
        e.title.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower) ||
        e.muscleGroup.toLowerCase().includes(lower)
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
      
      const diffVal = (d: string) => d === 'Beginner' ? 1 : d === 'Intermediate' ? 2 : 3;
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

  const getDifficultyColor = (diff: string) => {
    if (diff === 'Beginner') return '#22C55E';
    if (diff === 'Intermediate') return '#F59E0B';
    return '#EF4444';
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
        completed: false
      });
      setSelectedEx(null);
      onClose();
    }
  };

  // 1) Details Panel
  if (selectedEx) {
    return (
      <Modal visible={isVisible} animationType="slide" transparent={true}>
        <SafeAreaView style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
          <View style={styles.detailsContainer}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setSelectedEx(null)}>
                <Text style={styles.backBtn}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.selectedTitle} numberOfLines={1}>{selectedEx.title}</Text>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {/* Quick Stats Row */}
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Muscle</Text>
                  <Text style={styles.statValue}>{selectedEx.muscleGroup}</Text>
                </View>
                <View style={[styles.statBox, { borderLeftWidth: 1, borderColor: '#334155' }]}>
                  <Text style={styles.statLabel}>Difficulty</Text>
                  <Text style={[styles.statValue, { color: getDifficultyColor(selectedEx.difficulty) }]}>
                    {selectedEx.difficulty}
                  </Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={[styles.statBox, { borderTopWidth: 1, borderColor: '#334155' }]}>
                  <Text style={styles.statLabel}>Rec. Sets</Text>
                  <Text style={styles.statValue}>{selectedEx.sets}</Text>
                </View>
                <View style={[styles.statBox, { borderLeftWidth: 1, borderTopWidth: 1, borderColor: '#334155' }]}>
                  <Text style={styles.statLabel}>Rec. Reps</Text>
                  <Text style={styles.statValue}>{selectedEx.reps}</Text>
                </View>
              </View>
              
              <View style={styles.statsRow}>
                <View style={[styles.statBox, { borderTopWidth: 1, borderColor: '#334155' }]}>
                  <Text style={styles.statLabel}>Attachment</Text>
                  <Text style={styles.statValue}>{selectedEx.attachment}</Text>
                </View>
                <View style={[styles.statBox, { borderLeftWidth: 1, borderTopWidth: 1, borderColor: '#334155' }]}>
                  <Text style={styles.statLabel}>Position</Text>
                  <Text style={styles.statValue}>{selectedEx.cablePosition}</Text>
                </View>
              </View>

              {/* Video Button */}
              {selectedEx.videoId ? (
                <TouchableOpacity 
                  style={styles.videoThumbnail} 
                  onPress={() => handleWatchVideo(`https://www.youtube.com/watch?v=${selectedEx.videoId}`)}
                >
                  <View style={styles.playIconContainer}>
                    <Text style={styles.playIcon}>▶</Text>
                  </View>
                  <Text style={styles.videoText}>Watch Tutorial</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.videoThumbnail, { backgroundColor: '#1E293B' }]}>
                  <Text style={styles.videoText}>No Video Available</Text>
                </View>
              )}

              {/* Descriptions & Details */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Description</Text>
                <Text style={styles.bodyText}>{selectedEx.description}</Text>
              </View>

              {(selectedEx.primaryMuscles.length > 0 || selectedEx.secondaryMuscles.length > 0) && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Muscles Engaged</Text>
                  <Text style={styles.bodyText}>
                    <Text style={{ fontWeight: 'bold', color: '#CBD5E1' }}>Primary: </Text>
                    {selectedEx.primaryMuscles.join(', ') || 'None'}
                  </Text>
                  <Text style={styles.bodyText}>
                    <Text style={{ fontWeight: 'bold', color: '#CBD5E1' }}>Secondary: </Text>
                    {selectedEx.secondaryMuscles.join(', ') || 'None'}
                  </Text>
                </View>
              )}

              {selectedEx.tips && selectedEx.tips.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Pro Tips</Text>
                  {selectedEx.tips.map((t, i) => (
                    <Text key={i} style={styles.bodyText}>• {t}</Text>
                  ))}
                </View>
              )}

            </ScrollView>

            <View style={styles.addPanel}>
              <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
                <Text style={styles.addButtonText}>Add to Today's Checklist</Text>
              </TouchableOpacity>
            </View>

          </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  // 2) Main List Panel
  return (
    <Modal visible={isVisible} animationType="slide" transparent={true}>
      <SafeAreaView style={styles.modalBg}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Bio Force Library</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeBtn}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search 113+ exercises..."
              placeholderTextColor="#64748B"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} style={styles.clearSearch}>
                <Text style={styles.clearSearchText}>×</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Filters Top Bar */}
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              
              {/* Difficulities */}
              {allDifficulties.map(diff => {
                const active = selDifficulties.includes(diff);
                return (
                  <TouchableOpacity 
                    key={diff} 
                    style={[styles.chip, active && { backgroundColor: getDifficultyColor(diff) + '40', borderColor: getDifficultyColor(diff) }]}
                    onPress={() => toggleFilter(selDifficulties, setSelDifficulties, diff)}
                  >
                    <Text style={[styles.chipText, active && { color: getDifficultyColor(diff) }]}>{diff}</Text>
                  </TouchableOpacity>
                );
              })}

              {/* Muscles Dropdown equivalent via horizontal scroll */}
              {allMuscleGroups.map(grp => {
                const active = selMuscleGroups.includes(grp);
                return (
                  <TouchableOpacity 
                    key={grp} 
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => toggleFilter(selMuscleGroups, setSelMuscleGroups, grp)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{grp}</Text>
                  </TouchableOpacity>
                );
              })}

            </ScrollView>
          </View>

          <View style={styles.resultsHeader}>
            <Text style={styles.resultsCount}>{filteredList.length} Exercises found</Text>
          </View>

          {/* List */}
          <ScrollView contentContainerStyle={styles.listContent}>
            {filteredList.map(ex => (
              <TouchableOpacity key={ex.id} style={styles.card} onPress={() => setSelectedEx(ex)}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{ex.title}</Text>
                </View>
                <View style={styles.cardBadges}>
                  <Text style={[styles.badgeText, { color: getDifficultyColor(ex.difficulty) }]}>{ex.difficulty}</Text>
                  <Text style={styles.badgeTextSeparator}>•</Text>
                  <Text style={styles.badgeTextMuscle}>{ex.muscleGroup}</Text>
                  <Text style={styles.badgeTextSeparator}>•</Text>
                  <Text style={styles.badgeTextAttachment}>{ex.attachment}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {filteredList.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No exercises match your search filters.</Text>
              </View>
            )}
          </ScrollView>

        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBg: {
    flex: 1,
    backgroundColor: '#0F172A', // Dark Slate
  },
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeBtn: {
    color: '#3B82F6', // Blue
    fontSize: 16,
    fontWeight: '600',
  },
  // Search
  searchWrap: {
    padding: 16,
    paddingBottom: 8,
    position: 'relative'
  },
  searchInput: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  clearSearch: {
    position: 'absolute',
    right: 28,
    top: 26,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#334155',
    borderRadius: 12,
  },
  clearSearchText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    lineHeight: 18,
  },
  // Filters
  filterScroll: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    marginRight: 8, // Using gap in ScrollView is sometimes tricky, use margin
  },
  chipActive: {
    backgroundColor: '#3B82F640', // 25% opacity blue
    borderColor: '#3B82F6',
  },
  chipText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#60A5FA',
  },
  resultsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resultsCount: {
    color: '#94A3B8',
    fontSize: 14,
  },
  // List
  listContent: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  cardBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  badgeTextMuscle: {
    color: '#3B82F6', // Blue
    fontSize: 13,
    fontWeight: '500',
  },
  badgeTextAttachment: {
    color: '#94A3B8', // Slate
    fontSize: 13,
  },
  badgeTextSeparator: {
    color: '#475569',
    marginHorizontal: 6,
    fontSize: 10,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    textAlign: 'center',
  },
  
  // Details Panel
  detailsContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  backBtn: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
    width: 60,
  },
  selectedTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginRight: 60, // offset for back btn
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    marginHorizontal: -16, // Bleed to edges
    paddingHorizontal: 16,
  },
  statBox: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statLabel: {
    color: '#64748B',
    fontSize: 12,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statValue: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: 'bold',
  },
  videoThumbnail: {
    height: 160,
    backgroundColor: '#000000',
    borderRadius: 12,
    marginVertical: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  playIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EF4444', // YouTube red
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  playIcon: {
    color: '#FFFFFF',
    fontSize: 20,
    marginLeft: 4, // Visual balance for play triangle
  },
  videoText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  bodyText: {
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  addPanel: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  addButton: {
    backgroundColor: '#F97316', // Orange
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
