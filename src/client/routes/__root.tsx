import { Component, type ErrorInfo, type ReactNode } from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppSidebar } from "@/client/components/layout/sidebar";
import { ErrorBanner } from "@/client/components/error-banner";
import { Header } from "@/client/components/layout/header";
import { PublishBar } from "@/client/components/publish-bar";
import { Toaster } from "@/client/components/toast";
import { Button } from "@/client/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/client/components/ui/sidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Astronaut CMS render error:", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <ErrorFallback error={this.state.error} onReset={() => this.setState({ error: null })} />
      );
    }

    return this.props.children;
  }
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <ErrorBanner
        className="max-w-md"
        title={t(($) => $.errors.somethingWentWrong)}
        action={
          <Button size="sm" onClick={onReset}>
            {t(($) => $.errors.tryAgain)}
          </Button>
        }
      >
        {error.message}
      </ErrorBanner>
    </div>
  );
}

function RootLayout() {
  // The sidebar writes its state to this cookie on every toggle, but only server rendering reads it back,
  // and the admin renders in the browser alone.
  const sidebarOpen = !document.cookie.split("; ").includes("sidebar_state=false");

  return (
    <ErrorBoundary>
      <SidebarProvider
        defaultOpen={sidebarOpen}
        data-astronaut-cms
        className="h-svh overflow-hidden text-foreground"
      >
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Header />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <Outlet />
          </div>
          <PublishBar />
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </ErrorBoundary>
  );
}
