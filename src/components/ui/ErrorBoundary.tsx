// src/components/ui/ErrorBoundary.tsx
// A small, self-healing error boundary. React tears the whole subtree down
// when a child throws during render; without a boundary that means a blank
// screen the user can only escape by reloading. This one catches the throw,
// shows a quiet inline notice, and — crucially — RESETS itself whenever any
// of `resetKeys` changes. Wrap it around a view driven by live data and pass
// that data as a reset key: a transient bad render (e.g. a momentarily
// inconsistent graph snapshot mid-edit) clears on the very next data tick
// instead of stranding the user on an empty canvas.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children:   ReactNode;
  /** Re-mount the children when any of these values change (shallow compare). */
  resetKeys?: unknown[];
  /** Optional custom fallback; defaults to a quiet inline notice. */
  fallback?:  ReactNode;
  /** Short label for the logged message (e.g. "graph canvas"). */
  label?:     string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep it in the console for debugging; don't crash the app over it.
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (!this.state.error) return;
    // Any change in the reset keys means the inputs that produced the bad
    // render have moved on — clear the error and let the children re-render.
    const a = prev.resetKeys ?? [];
    const b = this.props.resetKeys ?? [];
    if (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="tw:absolute tw:inset-0 tw:grid tw:place-items-center tw:text-ink-3 tw:p-6">
          <div className="tw:text-center tw:max-w-[360px]">
            <p className="tw:text-[14px] tw:text-ink-2 tw:m-0 tw:mb-2">
              The canvas hit a hiccup and is recovering…
            </p>
            <button
              className="tw:py-1.5 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:text-ink tw:bg-bg-3 tw:hover:border-ink-3"
              onClick={() => this.setState({ error: null })}
            >
              Reload it
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
