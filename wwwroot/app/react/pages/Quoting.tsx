import { Card } from '../components/common/Card';

export default function Quoting() {
  return (
    <div className="h-full p-6 overflow-auto">
      <h1 className="text-2xl font-semibold text-text-primary mb-4">Quoting</h1>
      <Card>
        <p className="text-sm text-text-secondary">
          Quoting is scaffolded for the roadmap; the full build (CSV upload, rate cards,
          service-level modelling) lands after Stage 1 RunBuilder parity is signed off.
        </p>
      </Card>
    </div>
  );
}
