import * as THREE from "three";
import { sculpt } from "./studio-sculpture";
import { skinLimb } from "./studio-skin";

export type HorsePalette = { coat: string; navy: string; blue: string; cyan: string; coral: string };
export type HorsePose = { stride: number; running: number; airborne: number; crouch: number; turn: number; greeting: number };

/** A dimensional, articulated UNI candidate. Geometry is source authored. */
export function buildStudioHorse(palette: HorsePalette, mark: THREE.Texture) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const coat = new THREE.MeshPhysicalMaterial({ color: palette.coat, roughness: .62, metalness: 0, clearcoat: .08, clearcoatRoughness: .6 });
  const navy = new THREE.MeshPhysicalMaterial({ color: palette.navy, roughness: .55, clearcoat: .1 });
  const shoe = new THREE.MeshPhysicalMaterial({ color: palette.navy, roughness: .52, clearcoat: .12 });
  const iris = new THREE.MeshPhysicalMaterial({ color: palette.blue, roughness: .32, clearcoat: .4, metalness: 0 });
  const pupil = new THREE.MeshPhysicalMaterial({ color: palette.navy, roughness: .38, clearcoat: .2 });
  const mouth = new THREE.MeshStandardMaterial({ color: palette.navy, roughness: .6 });
  const tongue = new THREE.MeshStandardMaterial({ color: palette.coral, roughness: .65 });
  const hair = new THREE.MeshPhysicalMaterial({ roughness: .48, metalness: 0, clearcoat: .12, clearcoatRoughness: .5, vertexColors: true, emissive: palette.blue, emissiveIntensity: .22 });
  const glint = new THREE.MeshBasicMaterial({ color: palette.coat });
  const sphereGeometry = new THREE.SphereGeometry(1, 36, 28);

  const oval = (parent: THREE.Object3D, material: THREE.Material, pos: number[], scale: number[]) => {
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.position.set(pos[0]!, pos[1]!, pos[2]!); mesh.scale.set(scale[0]!, scale[1]!, scale[2]!);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const lathe = (parent: THREE.Object3D, material: THREE.Material, points: number[][], pos: number[], scale: number[]) => {
    const smooth = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(smooth.getPoints(32), 48), material);
    mesh.position.set(pos[0]!, pos[1]!, pos[2]!); mesh.scale.set(scale[0]!, scale[1]!, scale[2]!);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const stroke = (parent: THREE.Object3D, material: THREE.Material, points: number[][], radius: number) => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 24, radius, 8, false), material);
    parent.add(mesh); return mesh;
  };

  // Tufts are swept, tapered sculptural leaves, with a blue-to-cyan material.
  const tuft = (parent: THREE.Object3D, points: number[][], width: number, thickness: number) => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const count = 36, sides = 12, frames = path.computeFrenetFrames(count, false);
    const vertices: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
    const blue = new THREE.Color(palette.blue), cyan = new THREE.Color(palette.cyan);
    for (let row = 0; row <= count; row++) {
      const t = row / count, center = path.getPoint(t);
      const taper = Math.max(.015, Math.sin(Math.PI * Math.min(.98, t * .9 + .08)) * (1 - t) ** .4);
      const color = blue.clone().lerp(cyan, t * .8);
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const n = frames.normals[row]!.clone().multiplyScalar(Math.cos(angle));
        const b = frames.binormals[row]!.clone().multiplyScalar(Math.sin(angle));
        const point = center.clone().addScaledVector(n, width * taper).addScaledVector(b, thickness * taper);
        vertices.push(point.x, point.y, point.z);
        const normal = n.add(b).normalize(); normals.push(normal.x, normal.y, normal.z);
        colors.push(color.r, color.g, color.b);
        if (row < count && side < sides) {
          const a = row * (sides + 1) + side, d = a + sides + 1;
          indices.push(a, a + 1, d, d, a + 1, d + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, hair); mesh.castShadow = true; parent.add(mesh);
  };

  body.add(sculpt(coat, [
    { center: [0, 1.06, 0], radius: [.36, .42, .28] },
    { center: [0, 1.53, -.025], radius: [.30, .43, .18] },
    { center: [0, 1.94, .025], radius: [.23, .32, .22] },
  ], [0, 1.46, 0], [1.1, 1.9, .85]));
  lathe(body, navy, [[0, -.46], [.27, -.42], [.35, -.24], [.44, .18], [.41, .35], [.24, .43], [0, .42]],
    [0, 1.48, 0], [1, 1, .7]);

  // A shallow planar decal follows the vest and uses the official shared SVG.
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(.35, .25),
    new THREE.MeshBasicMaterial({ map: mark, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  emblem.position.set(0, 1.46, .303); body.add(emblem);

  const head = new THREE.Group(); head.position.set(0, 2.12, .04); body.add(head);
  head.add(sculpt(coat, [
    { center: [0, .42, -.015], radius: [.58, .68, .51] },
    { center: [0, .13, .45], radius: [.44, .32, .41] },
    { center: [0, -.085, .42], radius: [.36, .19, .34] },
  ], [0, .40, .18], [1.6, 1.8, 1.8],
    { center: [0, -.055, .80], radius: [.225, .13, .15] }));
  oval(head, mouth, [0, -.03, .773], [.23, .137, .041]);
  oval(head, tongue, [0, -.099, .81], [.12, .046, .019]);
  oval(head, coat, [0, .056, .81], [.17, .024, .012]);

  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const x = side * .315;
    const eye = oval(head, coat, [x, .48, .422], [.248, .286, .16]); eyes.push(eye);
    oval(head, iris, [x - side * .019, .472, .552], [.165, .194, .046]);
    oval(head, pupil, [x - side * .03, .47, .591], [.102, .142, .026]);
    oval(head, glint, [x - .042, .545, .62], [.044, .047, .013]);
    oval(head, glint, [x + .046, .402, .619], [.015, .019, .009]);
    stroke(head, navy, [[x - .19, .77, .365], [x, .815, .404], [x + .15, .75, .372]], .027);
    stroke(head, navy, [[x - .21, .59, .485], [x - .15, .728, .463], [x + .08, .75, .429], [x + .21, .59, .464]], .017);
    oval(head, mouth, [side * .175, .195, .843], [.041, .028, .013]);
    const ear = new THREE.Group(); ear.position.set(side * .45, 1.005, -.095); ear.rotation.z = -side * .17; head.add(ear);
    oval(ear, coat, [0, .09, 0], [.16, .37, .13]);
    oval(ear, navy, [0, .115, .095], [.105, .272, .043]);
  }

  const mane = new THREE.Group(); head.add(mane);
  const hairRoot = new THREE.MeshPhysicalMaterial({ color: palette.blue, roughness: .48, clearcoat: .12 });
  oval(mane, hairRoot, [.24, .53, -.38], [.23, .60, .16]);
  tuft(mane, [[-.30, .96, -.18], [-.06, 1.29, .13], [.30, 1.19, .37], [.23, .72, .54]], .32, .17);
  tuft(mane, [[-.08, 1.01, -.29], [.34, 1.15, -.12], [.67, .86, .04], [.81, .62, -.14]], .26, .12);
  tuft(mane, [[.20, .83, -.38], [.58, .72, -.17], [.83, .39, -.19], [1.00, .45, -.30]], .23, .105);
  tuft(mane, [[.28, .62, -.41], [.58, .29, -.15], [.86, .03, -.16], [.99, .17, -.40]], .23, .11);
  tuft(mane, [[.24, .35, -.48], [.51, .00, -.21], [.78, -.22, -.28], [.88, -.08, -.52]], .23, .10);
  tuft(mane, [[.07, .29, -.50], [.33, -.25, -.31], [.64, -.39, -.29], [.78, -.32, -.60]], .23, .105);

  const tail = new THREE.Group(); tail.position.set(0, 1.05, -.30); body.add(tail);
  for (let layer = 0; layer < 5; layer++) {
    const offset = layer * .07;
    tuft(tail, [[0, .12, -.03], [.28 + offset, .25, -.48], [.64 + offset, -.22, -.80],
      [.66 + offset, -.58, -.61], [.98 + offset, -.55, -.81]], .20, .14);
  }

  const arms: { upper: THREE.Bone; lower: THREE.Bone }[] = [];
  const legs: { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const arm = skinLimb(body, coat, [side * .42, 1.78, 0], .63, .38, [.12, .155, .15, .14, .125]);
    oval(arm.lower, shoe, [0, -.285, .025], [.158, .14, .155]); arms.push(arm);
    const leg = skinLimb(body, coat, [side * .225, .99, 0], .88, .44, [.16, .185, .142, .135, .12]);
    const foot = new THREE.Group(); foot.position.set(0, -.44, 0); leg.lower.add(foot);
    lathe(foot, shoe, [[0, -.08], [.12, -.08], [.19, -.05], [.20, .00], [.17, .15], [.11, .20], [0, .19]],
      [0, -.02, .06], [1, 1, 1.45]);
    legs.push({ ...leg, foot });
  }
  const poseLeg = (index: number, height: number, forward: number, pelvis: number) => {
    const leg = legs[index]!, upperLength = .44, lowerLength = .44;
    const down = .99 + pelvis - height - .08;
    const distance = Math.min(.879, Math.max(.08, Math.hypot(down, forward)));
    const opening = Math.acos(THREE.MathUtils.clamp((upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * upperLength * distance), -1, 1));
    const bend = Math.PI - Math.acos(THREE.MathUtils.clamp((upperLength * upperLength + lowerLength * lowerLength - distance * distance) / (2 * upperLength * lowerLength), -1, 1));
    leg.upper.rotation.x = -Math.atan2(forward, down) - opening;
    leg.lower.rotation.x = bend;
    leg.foot.rotation.x = -leg.upper.rotation.x - leg.lower.rotation.x;
  };

  return {
    root,
    pose(state: HorsePose) {
      const phase = state.stride, run = state.running;
      const bob = Math.cos(phase * 2) * .035 * run - state.crouch * .12;
      body.position.y = bob;
      body.rotation.set(-.10 * run - state.airborne * .18, 0, Math.sin(phase) * .025 * run - state.turn * .07);
      head.rotation.set(Math.cos(phase * 2) * .025 * run, -.09 + state.turn * .06, -.07);
      mane.rotation.z = Math.sin(phase + .7) * .03 * run;
      tail.rotation.set(Math.sin(phase - .4) * .09 * run, Math.sin(phase * .7) * .13 * run - state.turn * .3, .08);
      arms.forEach((arm, index) => {
        const wave = Math.sin(phase + index * Math.PI);
        arm.upper.rotation.x = wave * .68 * run - state.airborne * .55;
        arm.upper.rotation.z = (index ? -1 : 1) * (.10 + state.airborne * .16);
        arm.lower.rotation.x = -.32 - Math.max(0, -wave) * .72 * run;
        if (index === 0) { arm.upper.rotation.z += state.greeting * .9; arm.lower.rotation.x -= state.greeting * .65; }
      });
      legs.forEach((_, index) => {
        const cycle = ((phase / (Math.PI * 2) + index * .5) % 1 + 1) % 1;
        const stance = cycle < .6;
        const forward = stance ? .32 - cycle / .6 * .64 : -.32 + (cycle - .6) / .4 * .64;
        const lift = stance ? 0 : Math.sin((cycle - .6) / .4 * Math.PI) * .22;
        poseLeg(index, lift * run + state.airborne * (.22 + index * .10), forward * run, bob);
      });
      // All parts are volumetric; no portrait planes take part in the gait.
      eyes.forEach(eye => { eye.scale.y = .286; });
    },
  };
}
