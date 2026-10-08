import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import LoadErrorView from '../LoadErrorView';

describe('LoadErrorView', () => {
  it('screen variant shows the title, subtext and a Retry button', () => {
    const onRetry = jest.fn();
    const { getByText, getByLabelText } = render(
      <LoadErrorView variant="screen" title="Couldn't load things" onRetry={onRetry} />
    );
    expect(getByText("Couldn't load things")).toBeTruthy();
    expect(getByText('Your data is safe. Try again.')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('banner variant shows the refresh message and a Retry button', () => {
    const onRetry = jest.fn();
    const { getByText, getByLabelText, queryByText } = render(
      <LoadErrorView variant="banner" onRetry={onRetry} />
    );
    expect(getByText("Couldn't refresh. Showing the last loaded data.")).toBeTruthy();
    expect(queryByText('Your data is safe. Try again.')).toBeNull();
    fireEvent.press(getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
