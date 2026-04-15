import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { Colors, Typography } from '../theme/tokens';
import { getRecipeById, Recipe, addShoppingListItem } from '../db/database';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export default function RecipeDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { recipeId } = route.params || {};

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [servings, setServings] = useState<number>(1);

  useEffect(() => {
    if (recipeId) {
      loadRecipe(recipeId);
    }
  }, [recipeId]);

  const loadRecipe = async (id: string) => {
    const data = await getRecipeById(id);
    if (data) {
      setRecipe(data);
      setServings(data.defaultServings);
    }
  };

  const getCalculatedQuantity = (baseQuantity: number) => {
    if (!recipe) return baseQuantity;
    return (baseQuantity / recipe.defaultServings) * servings;
  };

  const handleAddToShoppingList = async () => {
    if (!recipe) return;
    try {
      for (const ing of recipe.ingredients) {
        const qty = getCalculatedQuantity(ing.baseQuantity);
        await addShoppingListItem(ing.name, qty, ing.unit);
      }
      Alert.alert("Success", "Ingredients added to Shopping List!");
    } catch (e) {
      Alert.alert("Error", "Failed to add ingredients");
    }
  };

  if (!recipe) return <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}><Text>Loading...</Text></SafeAreaView>;

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{recipe.title}</Text>
      </View>
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.macrosContainer}>
          <View style={styles.macroBox}>
            <Text style={styles.macroValue}>{recipe.calories}</Text>
            <Text style={styles.macroLabel}>kcal</Text>
          </View>
          <View style={styles.macroBox}>
            <Text style={styles.macroValue}>{recipe.protein}g</Text>
            <Text style={styles.macroLabel}>Protein</Text>
          </View>
          <View style={styles.macroBox}>
            <Text style={styles.macroValue}>{recipe.carbs}g</Text>
            <Text style={styles.macroLabel}>Carbs</Text>
          </View>
          <View style={styles.macroBox}>
            <Text style={styles.macroValue}>{recipe.fat}g</Text>
            <Text style={styles.macroLabel}>Fat</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Servings to Cook</Text>
          <View style={styles.stepperContainer}>
            <TouchableOpacity 
              style={styles.stepperButton} 
              onPress={() => setServings(Math.max(1, servings - 1))}
            >
              <Text style={styles.stepperButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{servings}</Text>
            <TouchableOpacity 
              style={styles.stepperButton} 
              onPress={() => setServings(servings + 1)}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ingredients</Text>
          {recipe.ingredients.map((ing, idx) => (
            <View key={idx} style={styles.ingredientRow}>
              <Text style={styles.ingredientName}>• {ing.name}</Text>
              <Text style={styles.ingredientAmount}>
                {getCalculatedQuantity(ing.baseQuantity).toFixed(1).replace(/\.0$/, '')} {ing.unit}
              </Text>
            </View>
          ))}
          <TouchableOpacity style={styles.addToCartButton} onPress={handleAddToShoppingList}>
            <Text style={styles.addToCartButtonText}>🛒 Add to Shopping List</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Text style={styles.bodyText}>{recipe.instructions}</Text>
        </View>

        {recipe.freezerTips ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Freezer Tips</Text>
            <Text style={styles.bodyText}>{recipe.freezerTips}</Text>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    marginRight: 16,
  },
  backButtonText: {
    color: Colors.accent,
    fontSize: Typography.sizes.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  macrosContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  macroBox: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  macroValue: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  macroLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepperButton: {
    width: 40,
    height: 40,
    backgroundColor: Colors.border,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    fontSize: Typography.sizes.xl,
    color: Colors.textPrimary,
    lineHeight: 24,
  },
  stepperValue: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    marginHorizontal: 32,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ingredientName: {
    color: Colors.textPrimary,
    flex: 1,
    fontSize: Typography.sizes.md,
  },
  ingredientAmount: {
    color: Colors.textSecondary,
    fontWeight: Typography.weights.semibold,
    fontSize: Typography.sizes.md,
  },
  addToCartButton: {
    backgroundColor: Colors.accent,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  addToCartButtonText: {
    color: Colors.background,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
  },
  bodyText: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.md,
    lineHeight: 24,
  }
});
