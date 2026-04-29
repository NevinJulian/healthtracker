import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/database';
import AppNavigator from './src/navigation/AppNavigator';
import { Colors, Typography } from './src/theme/tokens';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        setDbReady(true);
      } catch (err: any) {
        console.error('[App] DB init failed:', err);
        const stackLines = (err?.stack as string | undefined)
          ?.split('\n')
          .slice(0, 8)
          .join('\n');
        const detail = [err?.message, stackLines].filter(Boolean).join('\n\n');
        setError(detail || 'Unknown error during database initialisation');
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={styles.splash}>
        <Text style={styles.errorText}>Failed to initialise database</Text>
        <Text style={styles.errorDetail} selectable>{error}</Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.splashText}>Loading your tracker…</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={Colors.surfaceLowest} />
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: Colors.primary,
            background: Colors.background,
            card: Colors.surfaceLow,
            text: Colors.onSurface,
            border: `${Colors.outlineVariant}26`,
            notification: Colors.primary,
          },
          fonts: {
            regular: { fontFamily: 'System', fontWeight: '400' },
            medium: { fontFamily: 'System', fontWeight: '500' },
            bold: { fontFamily: 'System', fontWeight: '700' },
            heavy: { fontFamily: 'System', fontWeight: '900' },
          },
        }}
      >
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  splashText: {
    color: Colors.onSurfaceVariant,
    fontSize: Typography.sizes.body,
  },
  errorText: {
    color: Colors.error,
    fontSize: Typography.sizes.titleL,
    fontWeight: Typography.weights.bold,
  },
  errorDetail: {
    color: Colors.onSurfaceVariant,
    fontSize: Typography.sizes.bodyS,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
