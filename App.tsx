import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { installStress369 } from './src/db/devStress369';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import RecoveryScreen, { formatErrorDetail } from './src/components/RecoveryScreen';
import { clearRescueCopies } from './src/services/rescueExport';
import { runAutoBackupIfDue } from './src/services/backup';
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
        const detail = formatErrorDetail(err);
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

  const showFailure = Boolean(error || fontError);
  const started = dbReady && fontsLoaded && !showFailure;

  useEffect(() => {
    if (!started) return;
    runAutoBackupIfDue().catch((err) => console.warn('[App] Auto-backup failed:', err));
  }, [started]);

  const retry = () => {
    if (initInFlight.current) return;
    setError(null);
    runInit();
  };

  if (showFailure) {
    const displayError = error ?? fontError?.message ?? 'Unknown font loading error';
    return (
      <RecoveryScreen
        title="Failed to initialise app"
        detail={displayError}
        onRetry={fontError ? undefined : retry}
        beforeSave={() => initInFlight.current ?? Promise.resolve()}
      />
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
      <AppErrorBoundary>
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
      </AppErrorBoundary>
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
});
