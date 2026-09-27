import { Component, type ErrorInfo, type ReactNode } from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@client/components/layout/sidebar";
import { Header } from "@client/components/layout/header";
import { AuthGuard } from "@client/components/auth-guard";
import { PublishBar } from "@client/components/publish-bar";
import { Toaster } from "@client/components/toast";
import { ChatPanel } from "@client/components/ai/chat-panel";
import { Button } from "@client/components/ui/button";
import { TooltipProvider } from "@client/components/ui/tooltip";

export const Route = createRootRoute({
  component: RootLayout,
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Astronaut CMS render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-destructive">
          {t($ => $.errors.somethingWentWrong)}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message}
        </p>
        <Button className="mt-4" onClick={onReset}>
          {t($ => $.errors.tryAgain)}
        </Button>
      </div>
    </div>
  );
}

function RootLayout() {
  return (
    <ErrorBoundary>
      <AuthGuard>
        <TooltipProvider>
          <div
            data-astronaut-cms
            className="flex h-screen overflow-hidden bg-background text-foreground"
          >
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
                <Outlet />
              </main>
              <PublishBar />
            </div>
            {/* `contents` keeps the panel's <aside> a direct flex child; the hook
                lets styles.css lay it out without editing the generated ChatPanel. */}
            <div data-cms-ai-panel className="contents">
              <ChatPanel />
            </div>
          </div>
          <Toaster />
        </TooltipProvider>
      </AuthGuard>
    </ErrorBoundary>
  );
}
