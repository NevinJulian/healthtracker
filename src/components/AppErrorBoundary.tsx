import React from 'react';
import RecoveryScreen, { formatErrorDetail } from './RecoveryScreen';

interface State {
  detail: string | null;
  attempt: number;
}

export default class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { detail: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { detail: formatErrorDetail(error) || 'Unknown error while rendering the app' };
  }

  componentDidCatch(error: unknown) {
    console.error('[App] render failed:', error);
  }

  private retry = () => {
    this.setState((s) => ({ detail: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.detail !== null) {
      return (
        <RecoveryScreen
          title="Something went wrong"
          detail={this.state.detail}
          onRetry={this.retry}
        />
      );
    }
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
