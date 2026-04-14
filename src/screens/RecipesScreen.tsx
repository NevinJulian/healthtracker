import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { Colors, Typography } from '../theme/tokens';
import { getRecipes, Recipe } from '../db/database';
import { useNavigation } from '@react-navigation/native';

const CATEGORIES = ["All", "Fresh & Fridge", "Quick Cook", "Freezer Batch", "Freezer Sauce"];

export default function RecipesScreen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const navigation = useNavigation<any>();

  useEffect(() => {
    loadRecipes(activeCategory);
  }, [activeCategory]);

  const loadRecipes = async (category: string) => {
    const data = await getRecipes(category);
    setRecipes(data);
  };

  const renderRecipe = ({ item }: { item: Recipe }) => (
    <TouchableOpacity 
      style={styles.card} 
      onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
    >
      <Text style={styles.cardTitle}>{item.title}</Text>
      <View style={styles.macrosRow}>
        <Text style={styles.macroText}>🔥 {item.calories} kcal</Text>
        <Text style={styles.macroText}>🥩 {item.protein}g</Text>
        <Text style={styles.macroText}>🍚 {item.carbs}g</Text>
        <Text style={styles.macroText}>🥑 {item.fat}g</Text>
      </View>
      <Text style={styles.categoryBadge}>{item.category} • ⏱️ {item.prepTimeMinutes}m</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.headerTitle}>Recipe Library</Text>
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity 
              key={cat} 
              style={[styles.filterBadge, activeCategory === cat && styles.filterBadgeActive]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.filterText, activeCategory === cat && styles.filterTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={recipes}
        keyExtractor={item => item.id}
        renderItem={renderRecipe}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  filterBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterBadgeActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  filterText: {
    color: Colors.textSecondary,
    fontWeight: Typography.weights.medium,
  },
  filterTextActive: {
    color: Colors.background,
    fontWeight: Typography.weights.bold,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  macrosRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  macroText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
  },
  categoryBadge: {
    color: Colors.textMuted,
    fontSize: Typography.sizes.sm,
  }
});
