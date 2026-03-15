import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/collections/$collection")({
  component: CollectionLayout,
});

function CollectionLayout() {
  return <Outlet />;
}
