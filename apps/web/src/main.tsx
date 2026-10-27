import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

interface BoundaryState { failed: boolean }

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="fatal" role="alert">
          <h1>Something went wrong in the workspace.</h1>
          <p>Reload the page. Your runs are stored on the server and nothing was lost.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
