import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('@expo-google-fonts/fraunces', () => ({ Fraunces_600SemiBold: 'Fraunces_600SemiBold' }));
jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({
  PlusJakartaSans_500Medium: 'a',
  PlusJakartaSans_600SemiBold: 'b',
  PlusJakartaSans_700Bold: 'c',
}));
jest.mock('../db/database', () => ({
  initDatabase: jest.fn(),
  getOnboardingComplete: jest.fn(),
  getLatestBodyWeight: jest.fn(),
}));
jest.mock('../services/rescueExport', () => ({
  exportRawDatabase: jest.fn(),
  hasRescueWal: jest.fn(() => Promise.resolve(false)),
  clearRescueCopies: jest.fn(() => Promise.resolve()),
}));
jest.mock('../services/backup', () => ({
  runAutoBackupIfDue: jest.fn(() => Promise.resolve()),
  listAutoBackups: jest.fn(() => Promise.resolve([])),
  shareFile: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../db/devStress369', () => ({ installStress369: jest.fn() }));
jest.mock('../services/notifications', () => ({
  configureNotificationHandler: jest.fn(),
  ensureAndroidChannel: jest.fn(() => Promise.resolve()),
  reconcileScheduledNotifications: jest.fn(() => Promise.resolve()),
  subscribeToWeeklyReviewTaps: jest.fn(),
  takeLaunchWeeklyReviewTap: jest.fn(),
}));
jest.mock('../navigation/navigationRef', () => ({
  navigationRef: { navigate: jest.fn() },
}));

let mockOnReady: (() => void) | undefined;
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    NavigationContainer: R.forwardRef((props: { onReady?: () => void; children: React.ReactNode }) => {
      mockOnReady = props.onReady;
      return R.createElement(R.Fragment, null, props.children);
    }),
  };
});

const mockNavigator = { crash: false };
jest.mock('../navigation/AppNavigator', () => {
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    default: () => {
      if (mockNavigator.crash) throw new Error('screen exploded');
      return <T>NAVIGATOR</T>;
    },
  };
});
jest.mock('../screens/OnboardingScreen', () => {
  const { Text: T } = require('react-native');
  return { __esModule: true, default: () => <T>ONBOARDING</T> };
});

import { useFonts } from 'expo-font';
import { initDatabase, getOnboardingComplete, getLatestBodyWeight } from '../db/database';
import { subscribeToWeeklyReviewTaps, takeLaunchWeeklyReviewTap } from '../services/notifications';
import { navigationRef } from '../navigation/navigationRef';
import App from '../../App';
import { COLD_RENDER_WAIT } from '../testUtils/coldRenderWait';

const init = initDatabase as jest.Mock;
const subscribe = subscribeToWeeklyReviewTaps as jest.Mock;
const takeLaunchTap = takeLaunchWeeklyReviewTap as jest.Mock;
const navigate = navigationRef.navigate as unknown as jest.Mock;
const unsubscribe = jest.fn();

function tap() {
  expect(subscribe).toHaveBeenCalled();
  const listener = subscribe.mock.calls[0][0] as () => void;
  act(() => {
    listener();
  });
}

function navigatorReady() {
  act(() => {
    mockOnReady?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnReady = undefined;
  mockNavigator.crash = false;
  init.mockReset().mockResolvedValue(undefined);
  subscribe.mockReset().mockReturnValue(unsubscribe);
  takeLaunchTap.mockReset().mockReturnValue(false);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (useFonts as jest.Mock).mockReturnValue([true, null]);
  (getOnboardingComplete as jest.Mock).mockResolvedValue(true);
  (getLatestBodyWeight as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('App weekly review tap', () => {
  it('opens the weekly review once for a tap while the navigator is ready', async () => {
    render(<App />);
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);
    navigatorReady();

    tap();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Weekly review');
  });

  it('holds a tap that arrives before the navigator is ready and opens it once on ready', async () => {
    render(<App />);
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);

    tap();
    expect(navigate).not.toHaveBeenCalled();

    navigatorReady();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Weekly review');

    navigatorReady();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('opens the weekly review for a launch tap only after the navigator is ready, once', async () => {
    takeLaunchTap.mockReturnValue(true);
    render(<App />);
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);
    expect(navigate).not.toHaveBeenCalled();

    navigatorReady();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Weekly review');

    navigatorReady();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('reads the launch tap once, after startup has completed', async () => {
    let finishInit: () => void = () => {};
    init.mockReturnValue(new Promise<void>((resolve) => { finishInit = resolve; }));
    render(<App />);
    await act(async () => {});
    expect(takeLaunchTap).not.toHaveBeenCalled();

    await act(async () => { finishInit(); });
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);
    expect(takeLaunchTap).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when the app was not opened from the notification', async () => {
    render(<App />);
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);
    navigatorReady();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('subscribes once on mount and removes the listener on unmount', async () => {
    const { unmount } = render(<App />);
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('never navigates for a tap during a startup failure, including after Retry', async () => {
    takeLaunchTap.mockReturnValue(true);
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValue(undefined);
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);

    tap();
    fireEvent.press(retry);
    await screen.findByText('NAVIGATOR');
    navigatorReady();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('never navigates for a tap while onboarding is shown', async () => {
    takeLaunchTap.mockReturnValue(true);
    (getOnboardingComplete as jest.Mock).mockResolvedValue(false);
    render(<App />);
    await screen.findByText('ONBOARDING', undefined, COLD_RENDER_WAIT);

    tap();

    expect(navigate).not.toHaveBeenCalled();
    expect(mockOnReady).toBeUndefined();
  });

  it('never navigates for a launch tap when the navigator crashes, including after Retry', async () => {
    takeLaunchTap.mockReturnValue(true);
    mockNavigator.crash = true;
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);

    mockNavigator.crash = false;
    fireEvent.press(retry);
    await screen.findByText('NAVIGATOR');
    navigatorReady();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('never navigates for a tap while the recovery screen is shown, including after Retry', async () => {
    mockNavigator.crash = true;
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);

    tap();
    mockNavigator.crash = false;
    fireEvent.press(retry);
    await screen.findByText('NAVIGATOR');
    navigatorReady();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the weekly review for a tap after the navigator has recovered and is ready', async () => {
    mockNavigator.crash = true;
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
    mockNavigator.crash = false;
    fireEvent.press(retry);
    await screen.findByText('NAVIGATOR');
    navigatorReady();

    tap();

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('Weekly review');
  });
});
