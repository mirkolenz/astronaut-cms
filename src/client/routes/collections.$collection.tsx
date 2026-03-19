import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/collections/$collection")({
  component: CollectionLayout,
});

function CollectionLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Outlet />
    </div>
  );
}
