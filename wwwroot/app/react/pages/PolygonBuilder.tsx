import { Card } from '../components/common/Card';

export default function PolygonBuilder() {
  return (
    <div className="h-full p-6 overflow-auto">
      <h1 className="text-2xl font-semibold text-text-primary mb-4">Polygon Builder</h1>
      <Card>
        <p className="text-sm text-text-secondary">
          Draw zip-boundary polygons for recurring route zones. Coming after Stage 1 parity.
        </p>
      </Card>
    </div>
  );
}
