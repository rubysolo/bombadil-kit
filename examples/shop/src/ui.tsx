import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { Component, type ReactNode } from 'react';

export const Spinner = () => (
  <p role="status" aria-busy="true">
    Loading…
  </p>
);

export const describe = (error: FetchBaseQueryError | SerializedError | undefined) => {
  if (!error) return 'Something went wrong';
  if ('status' in error) {
    if (error.status === 404) return 'Not found';
    if (error.status === 422) return 'Please check the form';
    if (typeof error.status === 'number') return `The server answered ${error.status}`;
    return 'Network trouble: check your connection';
  }
  return error.message ?? 'Something went wrong';
};

export const ErrorNote = ({ error, retry }: { error: Parameters<typeof describe>[0]; retry?: () => void }) => (
  <div role="alert" className="error">
    {describe(error)}
    {retry && (
      <button type="button" onClick={retry}>
        Try again
      </button>
    )}
  </div>
);

export const money = (n: number) => `$${n.toFixed(2)}`;

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div data-testid="error-boundary-fallback" role="alert">
          This page broke. <a href="/">Back to the shop</a>
        </div>
      );
    return this.props.children;
  }
}
