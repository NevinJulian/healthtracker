import React from 'react';

jest.mock('@react-navigation/drawer', () => ({
  createDrawerNavigator: () => ({ Navigator: 'DrawerNavigator', Screen: 'DrawerScreen' }),
}));
jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({ Navigator: 'StackNavigator', Screen: 'StackScreen' }),
}));

import AppNavigator from '../AppNavigator';

function drawerScreenNames(): string[] {
  const navigator = AppNavigator();
  return React.Children.toArray(navigator.props.children).map(
    (child) => (child as React.ReactElement<{ name: string }>).props.name
  );
}

describe('AppNavigator drawer', () => {
  it('lists the weekly review directly after Analytics', () => {
    const names = drawerScreenNames();
    expect(names.slice(0, 5)).toEqual(['Today', 'Schedule', 'Analytics', 'Weekly review', 'Meal Prep']);
  });

  it('registers each screen once', () => {
    const names = drawerScreenNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
