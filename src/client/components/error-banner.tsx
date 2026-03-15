export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
      {children}
    </div>
  );
}
