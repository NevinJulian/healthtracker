/**
 * Weight trend chart and rate on the exported WeightTrendCard (no DB).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('../../db/database', () => ({}));

import { WeightTrendCard } from '../AnalyticsDashboardScreen';

type Pt = { date: string; weight: number };

const day = (n: number) => new Date(Date.UTC(2024, 1, n)).toISOString().slice(0, 10);

const daily = (count: number, firstDay = 1): Pt[] =>
  Array.from({ length: count }, (_, i) => ({
    date: day(firstDay + i),
    weight: 80 + (i % 3),
  }));

function layOut(utils: ReturnType<typeof render>, width = 300) {
  fireEvent(utils.getByTestId('weight-chart'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 80 } },
  });
}

describe('WeightTrendCard chart', () => {
  it('draws one dot per weigh-in and no line before layout', () => {
    const history = daily(10);
    const utils = render(<WeightTrendCard history30={history} history90={history} />);
    expect(utils.queryAllByTestId(/^weight-dot-/)).toHaveLength(10);
    expect(utils.queryAllByTestId(/^trend-seg-/)).toHaveLength(0);
  });

  it('draws segments between the trend values from the 5th weigh-in on', () => {
    const history = daily(10);
    const utils = render(<WeightTrendCard history30={history} history90={history} />);
    layOut(utils);
    expect(utils.queryAllByTestId(/^weight-dot-/)).toHaveLength(10);
    expect(utils.queryAllByTestId(/^trend-seg-/)).toHaveLength(5);
  });

  it('draws no line for fewer than 5 weigh-ins', () => {
    const history = daily(4);
    const utils = render(<WeightTrendCard history30={history} history90={history} />);
    layOut(utils);
    expect(utils.queryAllByTestId(/^weight-dot-/)).toHaveLength(4);
    expect(utils.queryAllByTestId(/^trend-seg-/)).toHaveLength(0);
  });

  it('places dots by calendar day, leaving gaps', () => {
    const history: Pt[] = [
      { date: day(1), weight: 80 },
      { date: day(2), weight: 81 },
      { date: day(10), weight: 82 },
    ];
    const utils = render(<WeightTrendCard history30={history} history90={history} />);
    const left = (i: number) =>
      parseFloat(
        String(StyleSheet.flatten(utils.getByTestId(`weight-dot-${i}`).props.style).left)
      );
    expect(left(0)).toBeCloseTo(0, 4);
    expect(left(1)).toBeCloseTo(100 / 9, 4);
    expect(left(2)).toBeCloseTo(100, 4);
  });

  it('cuts the 30 day line from the longer series instead of restarting it', () => {
    const history90 = daily(40);
    const history30 = history90.slice(10);
    const utils = render(<WeightTrendCard history30={history30} history90={history90} />);
    layOut(utils);
    expect(utils.queryAllByTestId(/^weight-dot-/)).toHaveLength(30);
    expect(utils.queryAllByTestId(/^trend-seg-/)).toHaveLength(29);

    fireEvent.press(utils.getByLabelText('Show 90 day history'));
    expect(utils.queryAllByTestId(/^weight-dot-/)).toHaveLength(40);
    expect(utils.queryAllByTestId(/^trend-seg-/)).toHaveLength(35);
  });

  it('keeps an implausible weight out of the dots and the line', () => {
    const history: Pt[] = [...daily(9), { date: day(10), weight: 9999 }];
    const utils = render(<WeightTrendCard history30={history} history90={history} />);
    layOut(utils);
    expect(utils.queryAllByTestId(/^weight-dot-/)).toHaveLength(9);
    expect(utils.queryAllByTestId(/^trend-seg-/)).toHaveLength(4);
  });
});

describe('WeightTrendCard rate', () => {
  const flat = (count: number, firstDay = 1): Pt[] =>
    Array.from({ length: count }, (_, i) => ({ date: day(firstDay + i), weight: 80 }));

  it('shows the kg/week rate once the last 14 days hold 5 weigh-ins', () => {
    const history = daily(10);
    const utils = render(
      <WeightTrendCard history30={history} history90={history} todayISO={day(10)} />
    );
    expect(utils.getByLabelText('Weight trend rate').props.children).toMatch(
      /^[+−]?\d+\.\d kg\/week$/
    );
  });

  it('shows an unsigned zero for a flat trend', () => {
    const history = flat(10);
    const utils = render(
      <WeightTrendCard history30={history} history90={history} todayISO={day(10)} />
    );
    expect(utils.getByText('0.0 kg/week')).toBeTruthy();
  });

  it('shows a dash alone with only 3 weigh-ins', () => {
    const history = daily(3);
    const utils = render(
      <WeightTrendCard history30={history} history90={history} todayISO={day(3)} />
    );
    expect(utils.getByLabelText('Weight trend rate').props.children).toBe('—');
  });

  it('shows a dash when the weigh-ins are older than 14 days', () => {
    const history = flat(10);
    const utils = render(
      <WeightTrendCard history30={history} history90={history} todayISO={day(28)} />
    );
    expect(utils.getByLabelText('Weight trend rate').props.children).toBe('—');
  });

  it('does not change when switching between 30d and 90d', () => {
    const history90 = flat(40);
    const history30 = history90.slice(10);
    const utils = render(
      <WeightTrendCard history30={history30} history90={history90} todayISO={day(30)} />
    );
    fireEvent.press(utils.getByLabelText('Show 90 day history'));
    expect(utils.getByText('0.0 kg/week')).toBeTruthy();
  });
});
