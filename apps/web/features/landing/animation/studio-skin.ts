import * as THREE from "three";

/** One continuous skin, weighted around the elbow/knee rather than separate balls. */
export function skinLimb(parent: THREE.Object3D, material: THREE.Material, position: number[], length: number, joint: number, widths: number[]) {
  const upper = new THREE.Bone(), lower = new THREE.Bone();
  upper.position.set(position[0]!, position[1]!, position[2]!); lower.position.y = -joint;
  upper.add(lower); parent.add(upper);
  const rows = 48, sides = 24, vertices: number[] = [], indices: number[] = [], weights: number[] = [], bones: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const segment = t * (widths.length - 1), index = Math.min(widths.length - 2, Math.floor(segment));
    const radius = THREE.MathUtils.lerp(widths[index]!, widths[index + 1]!, segment - index);
    const knee = THREE.MathUtils.smoothstep(t, joint / length - .13, joint / length + .13);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      vertices.push(Math.cos(angle) * radius, -length * t, Math.sin(angle) * radius * .94);
      bones.push(0, 1, 0, 0); weights.push(1 - knee, knee, 0, 0);
      if (row < rows && side < sides) {
        const a = row * (sides + 1) + side, d = a + sides + 1;
        indices.push(a, a + 1, d, d, a + 1, d + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(bones, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.position.copy(upper.position); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  parent.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([upper, lower]));
  return { upper, lower };
}