import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import './styles/shell.css';
import './styles/sim.css';
import './styles/linking.css';
import './styles/chem.css';
import './styles/history.css';
import './styles/present.css';
import './styles/engines-a.css';
import './styles/engines-b.css';
import './styles/engines-c.css';

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

// The lesson demo harness (?lesson-demo=1) exists only in development: the import.meta.env.DEV guard is replaced by
// `false` in a production build, so the fixtures and the harness are not bundled.
async function pickPage(): Promise<ReactNode> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('lesson-demo')) {
    const { LessonDemo } = await import('./components/LessonDemo.tsx');
    return <LessonDemo />;
  }
  // Stage 8a dev-only engine harnesses (?engine-demo=a | b), one per web slice.
  const engineDemo = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('engine-demo') : null;
  if (engineDemo === 'a') {
    const { EngineDemoA } = await import('./components/EngineDemoA.tsx');
    return <EngineDemoA />;
  }
  if (engineDemo === 'b') {
    const { EngineDemoB } = await import('./components/EngineDemoB.tsx');
    return <EngineDemoB />;
  }
  return <App />;
}

void pickPage().then((page) => {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>{page}</ErrorBoundary>
    </StrictMode>,
  );
});
