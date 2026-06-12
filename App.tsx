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
import { useFonts } from 'expo-font';
import {
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { initDatabase, getOnboardingComplete, getLatestBodyWeight } from './src/db/database';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { Colors, Typography } from './src/theme/tokens';
import {
  configureNotificationHandler,
  ensureAndroidChannel,
  reconcileScheduledNotifications,
} from './src/services/notifications';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = unknown (still loading), false = show onboarding, true = show navigator
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);

  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    // Configure the foreground notification handler immediately (synchronous).
    configureNotificationHandler();

    (async () => {
      try {
        await initDatabase();
        // Ensure the Android notification channel exists and reconcile any
        // persisted reminder settings with the OS scheduler. Both are
        // fire-and-forget: failures are logged but must not block startup.
        await ensureAndroidChannel();
        await reconcileScheduledNotifications();
        // Read onboarding state and latest weight after DB is ready.
        const [onboardingComplete, weight] = await Promise.all([
          getOnboardingComplete(),
          getLatestBodyWeight(),
        ]);
        setLatestWeight(weight);
        setOnboardingDone(onboardingComplete);
        setDbReady(true);
      } catch (err: any) {
        console.error('[App] DB init failed:', err);
        // Build a readable detail string: message + first 8 stack lines  (#34)
        const stackLines = (err?.stack as string | undefined)
          ?.split('\n')
          .slice(0, 8)
          .join('\n');
        const detail = [err?.message, stackLines].filter(Boolean).join('\n\n');
        setError(detail || 'Unknown error during database initialisation');
      }
    })();
  }, []);

  if (error || fontError) {
    const displayError = error ?? fontError?.message ?? 'Unknown font loading error';
    return (
      <View style={styles.splash}>
        <Text style={styles.errorText}>Failed to initialise app</Text>
        <Text style={styles.errorDetail} selectable>{displayError}</Text>
      </View>
    );
  }

  if (!dbReady || !fontsLoaded) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.splashText}>Loading your tracker…</Text>
      </View>
    );
  }

  // If onboarding has not been completed (first launch), render the onboarding
  // screen outside the navigator so it owns the full screen including safe-area.
  if (onboardingDone === false) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
        <OnboardingScreen
          onComplete={() => setOnboardingDone(true)}
          latestWeight={latestWeight}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={Colors.surface} />
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: Colors.accent,
            background: Colors.background,
            card: Colors.surface,
            text: Colors.textPrimary,
            border: Colors.border,
            notification: Colors.accent,
          },
          fonts: {
            regular: { fontFamily: Typography.body, fontWeight: '400' },
            medium: { fontFamily: Typography.title, fontWeight: '500' },
            bold: { fontFamily: Typography.title, fontWeight: '700' },
            heavy: { fontFamily: Typography.label, fontWeight: '900' },
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
    color: Colors.textSecondary,
    fontSize: Typography.sizes.md,
  },
  errorText: {
    color: Colors.danger,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
  },
  errorDetail: {
    color: Colors.textSecondary,
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
