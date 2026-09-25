// Ambient TypeScript shim for `polygon-splitter` npm (v0.0.11).
// The package ships plain JS with no types (see package.json - no
// "types" or "typings" field). Live in a .d.ts file so TS treats it
// as ambient rather than trying to augment an untyped module (which
// fails with TS2665 when done from a .ts file).
declare module 'polygon-splitter' {
  type GeoJsonPolygonLike =
    | { type: 'Feature'; geometry: unknown }
    | { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  type GeoJsonLineLike =
    | { type: 'Feature'; geometry: unknown }
    | { type: 'LineString'; coordinates: unknown };
  interface SplitResult {
    type: 'Feature';
    geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  }
  const polygonSplitter: (
    polygon: GeoJsonPolygonLike,
    line: GeoJsonLineLike,
  ) => SplitResult;
  export default polygonSplitter;
}
