import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
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
import { installStress369 } from './src/db/devStress369';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import Button from './src/components/Button';
import { clearRescueCopies, exportRawDatabase } from './src/services/rescueExport';
import { Colors, Spacing, Typography } from './src/theme/tokens';
import {
  configureNotificationHandler,
  ensureAndroidChannel,
  reconcileScheduledNotifications,
} from './src/services/notifications';

const NO_RESET_NOTICE =
  "Clearing the app's storage in Android settings deletes all your data, so there is no reset button here.";

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = unknown (still loading), false = show onboarding, true = show navigator
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);

  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const initInFlight = useRef<Promise<void> | null>(null);

  const runInit = useCallback((): Promise<void> => {
    if (initInFlight.current) return initInFlight.current;
    const attempt = (async () => {
      try {
        await initDatabase();
        // Dev builds only: exposes globalThis.stress369().
        installStress369();
        await ensureAndroidChannel();
        await reconcileScheduledNotifications();
        const [onboardingComplete, weight] = await Promise.all([
          getOnboardingComplete(),
          getLatestBodyWeight(),
        ]);
        setLatestWeight(weight);
        setOnboardingDone(onboardingComplete);
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
    })().finally(() => {
      initInFlight.current = null;
    });
    initInFlight.current = attempt;
    return attempt;
  }, []);

  useEffect(() => {
    configureNotificationHandler();
    clearRescueCopies().catch(() => {});
    runInit();
  }, [runInit]);

  const retry = () => {
    if (initInFlight.current) return;
    setError(null);
    setSaveError(null);
    runInit();
  };

  const saveData = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await initInFlight.current;
      await exportRawDatabase();
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save your data.');
    } finally {
      setSaving(false);
    }
  };

  if (error || fontError) {
    const displayError = error ?? fontError?.message ?? 'Unknown font loading error';
    return (
      <ScrollView style={styles.failureScroll} contentContainerStyle={styles.failureContent}>
        <Text style={styles.errorText}>Failed to initialise app</Text>
        <Text style={styles.errorDetail} selectable>{displayError}</Text>
        {!fontError && <Button title="Retry" onPress={retry} style={styles.button} />}
        <Button
          title="Save data"
          variant="ghost"
          onPress={saveData}
          disabled={saving}
          style={styles.button}
        />
        {saveError && <Text style={styles.errorText}>{saveError}</Text>}
        <Text style={styles.errorDetail}>{NO_RESET_NOTICE}</Text>
      </ScrollView>
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
  failureScroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  failureContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing.xxl,
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
    paddingHorizontal: Spacing.xxl,
  },
  button: {
    alignSelf: 'stretch',
    marginHorizontal: Spacing.xxl,
  },
});
