'use client';

import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export default class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[app] Screen render failed', error, errorInfo);
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-lg font-semibold">This screen hit an error.</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            The app stayed active. You can retry this screen without being sent back to the home view.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retry screen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
