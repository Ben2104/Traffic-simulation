export default function DashboardPage() {
  return (
    <div className="grid grid-cols-[280px_1fr_320px] h-screen">
      <aside data-testid="incident-feed" className="border-r overflow-y-auto" />
      <main data-testid="map-view" className="relative" />
      <aside data-testid="incident-detail" className="border-l overflow-y-auto" />
    </div>
  );
}
