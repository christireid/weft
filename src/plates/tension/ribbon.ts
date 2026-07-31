import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Ribbon strip geometry for the filament (§2 Plate I).
 *
 * Two vertices per station, one either side of the centreline, joined as a
 * triangle strip. Every vertex carries only where it is (`aAlong`, 0→1) and
 * which side it is on (`aSide`, ±1) — the position, the width and the taper are
 * all computed in the vertex shader, because they change every frame and
 * uploading them would mean a buffer write per frame for a thread that already
 * has its shape described by a texture.
 *
 * `position` is present but unused: three requires the attribute to exist to
 * compute a bounding sphere, and its absence trips frustum culling. The mesh
 * sets `frustumCulled = false` for the same reason — the real geometry is a
 * function of a texture the CPU never reads, so any bounds three computes are
 * fiction.
 */
export function createRibbonGeometry(stations: number): BufferGeometry {
  const count = stations * 2;
  const along = new Float32Array(count);
  const side = new Float32Array(count);
  const position = new Float32Array(count * 3);

  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1);
    along[i * 2] = t;
    along[i * 2 + 1] = t;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    // A nominal x so the default bounding sphere is not degenerate.
    position[i * 6] = t * 2 - 1;
    position[i * 6 + 3] = t * 2 - 1;
  }

  // Two triangles per span, wound consistently so backface culling could be
  // enabled later without the ribbon disappearing.
  const indices = new Uint32Array((stations - 1) * 6);
  for (let i = 0; i < stations - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    indices[o] = a;
    indices[o + 1] = a + 1;
    indices[o + 2] = a + 2;
    indices[o + 3] = a + 1;
    indices[o + 4] = a + 3;
    indices[o + 5] = a + 2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aAlong', new BufferAttribute(along, 1));
  geometry.setAttribute('aSide', new BufferAttribute(side, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}
