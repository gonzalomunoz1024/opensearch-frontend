/* SPDX-License-Identifier: Apache-2.0 */

/* The arithmetic of leaflet.heat 0.2.0's _redraw, without a map. */

/**
 * _redraw's gathering, without a map: the points (on screen, with their intensity) put into cells
 * of half a radius, each cell at the weighted mean of its points, its weight capped by `max`.
 */
export function gatherHeat(
  points: Array<{ x: number; y: number; intensity: number }>,
  options: { radius: number; size: { x: number; y: number }; panePos: { x: number; y: number }; max: number; zoomFactor: number }
): Array<[number, number, number]> {
  const r = options.radius;
  const cellSize = r / 2;
  const grid: Array<Array<[number, number, number] | undefined> | undefined> = [];
  const offsetX = options.panePos.x % cellSize;
  const offsetY = options.panePos.y % cellSize;
  for (const p of points) {
    if (p.x < -r || p.y < -r || p.x > options.size.x + r || p.y > options.size.y + r) continue;
    const x = Math.floor((p.x - offsetX) / cellSize) + 2;
    const y = Math.floor((p.y - offsetY) / cellSize) + 2;
    const k = p.intensity * options.zoomFactor;
    const row = (grid[y] = grid[y] || []);
    const cell = row[x];
    if (!cell) row[x] = [p.x, p.y, k];
    else {
      cell[0] = (cell[0] * cell[2] + p.x * k) / (cell[2] + k);
      cell[1] = (cell[1] * cell[2] + p.y * k) / (cell[2] + k);
      cell[2] += k;
    }
  }
  const data: Array<[number, number, number]> = [];
  for (const row of grid) {
    if (!row) continue;
    for (const cell of row) if (cell) data.push([Math.round(cell[0]), Math.round(cell[1]), Math.min(cell[2], options.max)]);
  }
  return data;
}

/** How much a point weighs at this zoom: halved for each level below maxZoom, at most 12 */
export const heatZoomFactor = (maxZoom: number, zoom: number) => 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - zoom, 12)));
