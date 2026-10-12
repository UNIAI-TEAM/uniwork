import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
type Volume = { center: number[]; radius: number[] };

/** Fuse organic volumes into one closed, smooth surface at asset-build time. */
export function sculpt(material: THREE.Material, volumes: Volume[], center: number[], size: number[], cut?: Volume) {
  const resolution = 58, field = new MarchingCubes(resolution, material, false, false, 24000);
  field.isolation = 0;
  const distance = (x: number, y: number, z: number, volume: Volume) => {
    const dx = x - volume.center[0]!, dy = y - volume.center[1]!, dz = z - volume.center[2]!;
    const [rx, ry, rz] = volume.radius as [number, number, number];
    const normalized = Math.hypot(dx / rx, dy / ry, dz / rz);
    const gradient = Math.hypot(dx / (rx * rx), dy / (ry * ry), dz / (rz * rz));
    return gradient > .0001 ? normalized * (normalized - 1) / gradient : -Math.min(rx, ry, rz);
  };
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const px = center[0]! + (x / resolution - .5) * size[0]!;
    const py = center[1]! + (y / resolution - .5) * size[1]!;
    const pz = center[2]! + (z / resolution - .5) * size[2]!;
    let d = Infinity;
    for (const volume of volumes) {
      const next = distance(px, py, pz, volume), blend = .16;
      const h = THREE.MathUtils.clamp(.5 + .5 * (next - d) / blend, 0, 1);
      d = THREE.MathUtils.lerp(next, d, h) - blend * h * (1 - h);
      if (!Number.isFinite(d)) d = next;
    }
    if (cut) d = Math.max(d, -distance(px, py, pz, cut));
    field.field[x + y * resolution + z * resolution * resolution] = -d;
  }
  field.update();
  const geometry = field.geometry.clone();
  geometry.scale(size[0]! / 2, size[1]! / 2, size[2]! / 2);
  geometry.translate(center[0]!, center[1]!, center[2]!);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true; field.geometry.dispose(); return mesh;
}