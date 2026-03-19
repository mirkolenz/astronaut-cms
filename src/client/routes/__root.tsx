import { Component, type ErrorInfo, type ReactNode } from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Sidebar } from "@/client/components/layout/sidebar";
import { Header } from "@/client/components/layout/header";
import { AuthGuard } from "@/client/components/auth-guard";
import { PublishBar } from "@/client/components/publish-bar";
import { ToastContainer } from "@/client/components/toast";

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
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
          <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 shadow-sm dark:border-red-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {this.state.error.message}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RootLayout() {
  return (
    <ErrorBoundary>
      <AuthGuard>
        <div
          data-astronaut-cms
          className="flex h-screen overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100"
        >
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
              <Outlet />
            </main>
            <PublishBar />
          </div>
        </div>
        <ToastContainer />
      </AuthGuard>
    </ErrorBoundary>
  );
}
