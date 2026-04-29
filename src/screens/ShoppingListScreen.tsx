import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Colors, Typography } from '../theme/tokens';
import { getShoppingListItems, toggleShoppingListItem, clearCompletedShoppingList, ShoppingListItem } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';

export default function ShoppingListScreen() {
  const [items, setItems] = useState<ShoppingListItem[]>([]);

  // Load items whenever the screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadItems();
    }, [])
  );

  const loadItems = async () => {
    const data = await getShoppingListItems();
    setItems(data);
  };

  const handleToggle = async (id: number, currentStatus: boolean) => {
    await toggleShoppingListItem(id, !currentStatus);
    loadItems(); // refresh list
  };

  const handleClearCompleted = () => {
    Alert.alert(
      "Clear Completed",
      "Are you sure you want to remove all completed items?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Clear", 
          style: "destructive", 
          onPress: async () => {
            await clearCompletedShoppingList();
            loadItems();
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: ShoppingListItem }) => (
    <TouchableOpacity 
      style={styles.itemRow} 
      onPress={() => handleToggle(item.id, item.is_checked)}
    >
      <View style={[styles.checkbox, item.is_checked && styles.checkboxChecked]}>
        {item.is_checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <View style={styles.itemDetails}>
        <Text style={[styles.itemName, item.is_checked && styles.textCrossed]}>
          {item.ingredient_name}
        </Text>
        <Text style={styles.itemAmount}>
          {item.total_quantity.toFixed(1).replace(/\.0$/, '')} {item.unit}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Shopping List</Text>
        {items.some(i => i.is_checked) && (
          <TouchableOpacity onPress={handleClearCompleted} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>Clear Completed</Text>
          </TouchableOpacity>
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Your shopping list is empty.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: Typography.sizes.headlineL,
    fontWeight: Typography.weights.bold,
    color: Colors.onSurface,
  },
  clearButton: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  clearButtonText: {
    color: Colors.error,
    fontWeight: Typography.weights.medium,
    fontSize: Typography.sizes.bodyS,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: Colors.onSurfaceVariant,
    fontSize: Typography.sizes.body,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: Colors.background,
    fontSize: 14,
    fontWeight: 'bold',
  },
  itemDetails: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemName: {
    color: Colors.onSurface,
    fontSize: Typography.sizes.body,
    flex: 1,
    marginRight: 8,
  },
  textCrossed: {
    textDecorationLine: 'line-through',
    color: Colors.outline,
  },
  itemAmount: {
    color: Colors.onSurfaceVariant,
    fontWeight: Typography.weights.semibold,
  }
});
