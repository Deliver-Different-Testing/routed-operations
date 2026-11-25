import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_FILTERS } from '../../lib/polygonFilters';
import { PolygonFilterBar } from './PolygonFilterBar';

const polygons = [
  { polygonId: 1, name: 'AD Deep East', layer: 'AD' },
  { polygonId: 2, name: 'MC8 Otahuhu', layer: null },
];

describe('PolygonFilterBar zoom button (review C9, mock wording)', () => {
  it('says Zoom to all when no filter is set, so nobody thinks results are narrowed', () => {
    render(<PolygonFilterBar polygons={polygons} filters={{ ...DEFAULT_FILTERS }} onChange={vi.fn()}
      matchCount={2} onZoomToResults={vi.fn()} zipShortLower="postcode" />);
    expect(screen.getByRole('button', { name: 'Zoom to all' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom to results' })).toBeNull();
  });

  it('says Zoom to results once a filter narrows the list', () => {
    render(<PolygonFilterBar polygons={polygons} filters={{ ...DEFAULT_FILTERS, search: 'deep' }} onChange={vi.fn()}
      matchCount={1} onZoomToResults={vi.fn()} zipShortLower="postcode" />);
    expect(screen.getByRole('button', { name: 'Zoom to results' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom to all' })).toBeNull();
  });
});
