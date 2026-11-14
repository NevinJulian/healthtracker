import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  AppState,
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
import { navigationRef } from './src/navigation/navigationRef';
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
  subscribeToWeeklyReviewTaps,
  takeLaunchWeeklyReviewTap,
} from './src/services/notifications';

const WEEKLY_REVIEW_ROUTE = 'Weekly review';

interface TapState {
  /** The navigator has reported ready and is still mounted. */
  ready: boolean;
  /** The navigator is mounted. */
  mounted: boolean;
  /** A tap that arrived before the navigator was ready. */
  held: boolean;
  /** A tap may still be held. Closed for good by a startup failure, onboarding or a crashed navigator. */
  open: boolean;
}

function NavigatorLifecycle({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return null;
}

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

  const tapState = useRef<TapState>({ ready: false, mounted: false, held: false, open: true });
  const launchTapRead = useRef(false);

  const closeTaps = useCallback(() => {
    tapState.current.open = false;
    tapState.current.held = false;
  }, []);

  const openWeeklyReview = useCallback(() => {
    const taps = tapState.current;
    if (taps.ready) {
      navigationRef.navigate(WEEKLY_REVIEW_ROUTE);
    } else if (taps.open) {
      taps.held = true;
    }
  }, []);

  const handleNavigatorReady = useCallback(() => {
    const taps = tapState.current;
    taps.ready = true;
    if (taps.held) {
      taps.held = false;
      navigationRef.navigate(WEEKLY_REVIEW_ROUTE);
    }
  }, []);

  const handleNavigatorMount = useCallback(() => {
    tapState.current.mounted = true;
  }, []);

  const handleNavigatorUnmount = useCallback(() => {
    tapState.current.mounted = false;
    tapState.current.ready = false;
    closeTaps();
  }, [closeTaps]);

  const readLaunchTap = useCallback((): boolean => {
    if (launchTapRead.current) return false;
    launchTapRead.current = true;
    return takeLaunchWeeklyReviewTap();
  }, []);

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
        const launchTap = readLaunchTap();
        if (!onboardingComplete) {
          closeTaps();
        } else if (launchTap) {
          openWeeklyReview();
        }
        setLatestWeight(weight);
        setOnboardingDone(onboardingComplete);
        setDbReady(true);
      } catch (err: any) {
        readLaunchTap();
        closeTaps();
        console.error('[App] DB init failed:', err);
        const detail = formatErrorDetail(err);
        setError(detail || 'Unknown error during database initialisation');
      }
    })().finally(() => {
      initInFlight.current = null;
    });
    initInFlight.current = attempt;
    return attempt;
  }, [closeTaps, openWeeklyReview, readLaunchTap]);

  useEffect(() => {
    configureNotificationHandler();
    clearRescueCopies().catch(() => {});
    runInit();
  }, [runInit]);

  useEffect(() => subscribeToWeeklyReviewTaps(openWeeklyReview), [openWeeklyReview]);

  const showFailure = Boolean(error || fontError);
  const started = dbReady && fontsLoaded && !showFailure;
  const navigatorShown = started && onboardingDone !== false;

  useEffect(() => {
    if (navigatorShown && !tapState.current.mounted) closeTaps();
  }, [navigatorShown, closeTaps]);

  useEffect(() => {
    if (!started) return;
    const backUpIfDue = () => {
      runAutoBackupIfDue().catch((err) => console.warn('[App] Auto-backup failed:', err));
    };
    backUpIfDue();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') backUpIfDue();
    });
    return () => {
      subscription.remove();
    };
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
        <StatusBar barStyle="dark-content" />
        <OnboardingScreen
          onComplete={() => setOnboardingDone(true)}
          latestWeight={latestWeight}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppErrorBoundary>
        <NavigationContainer
          ref={navigationRef}
          onReady={handleNavigatorReady}
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
          <NavigatorLifecycle onMount={handleNavigatorMount} onUnmount={handleNavigatorUnmount} />
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
