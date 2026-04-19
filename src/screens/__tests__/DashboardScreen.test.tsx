import React from 'react';
import { render } from '@testing-library/react-native';
import DashboardScreen from '../DashboardScreen';

describe('DashboardScreen', () => {
  it('renders the DashboardScreen predictably without crashing', () => {
    const { toJSON } = render(<DashboardScreen />);
    expect(toJSON()).toBeTruthy();
  });
});
