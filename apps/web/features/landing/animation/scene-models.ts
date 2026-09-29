import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type ScenePalette = { brand: string; paper: string; ink: string; mint: string; cyan: string; violet: string; pink: string };

/** A shared nucleus routes four work signals. The original brand mark stays a DOM overlay. */
export function buildSceneModel(palette: ScenePalette) {
  const root = new THREE.Group();
  const hues = [palette.brand, palette.cyan, palette.violet, palette.pink];
  const pearl = new THREE.MeshPhysicalMaterial({ color: palette.paper, roughness: .18, metalness: .45, clearcoat: 1, iridescence: .85, iridescenceIOR: 1.45, iridescenceThicknessRange: [160, 420] });
  const shell = new THREE.MeshPhysicalMaterial({ color: palette.ink, roughness: .35, metalness: .25, clearcoat: 1, iridescence: 1, iridescenceThicknessRange: [180, 520] });
  const lights = hues.map(color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .8, metalness: .3, roughness: .23 }));
  const glass = hues.map(color => new THREE.MeshPhysicalMaterial({ color, metalness: .35, roughness: .12, clearcoat: 1, iridescence: .8, iridescenceThicknessRange: [100, 400], transparent: true, opacity: .8 }));
  const white = new THREE.MeshBasicMaterial({ color: palette.paper });
  const wire = new THREE.MeshBasicMaterial({ color: palette.cyan, transparent: true, opacity: .27, depthWrite: false });
  const box = (size: [number, number, number], material: THREE.Material, position: [number, number, number], parent: THREE.Object3D, radius = .08) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 3, Math.min(radius, Math.min(...size) * .45)), material);
    mesh.position.set(...position); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const sphere = (radius: number, material: THREE.Material, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
    parent.add(mesh); return mesh;
  };
  const tube = (points: THREE.Vector3[], radius: number, material: THREE.Material, parent: THREE.Object3D) => {
    const path = new THREE.CatmullRomCurve3(points);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(path, 48, radius, 6, false), material));
    return path;
  };

  // The iris has real thickness and a reflective edge, rather than a flat white disc.
  const nucleus = new THREE.Group(); root.add(nucleus);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.78, .88, .36, 64), shell);
  body.rotation.x = Math.PI / 2; body.castShadow = true; nucleus.add(body);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(.72, .76, .07, 64), pearl);
  face.rotation.x = Math.PI / 2; face.position.z = .22; nucleus.add(face);
  const innerEdge = new THREE.Mesh(new THREE.TorusGeometry(.78, .033, 10, 96), lights[1]);
  innerEdge.position.z = .22; nucleus.add(innerEdge);
  const iris = new THREE.Group(); nucleus.add(iris);
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(.96, .067, 12, 40, Math.PI * .43), lights[i]);
    arc.rotation.z = i * Math.PI / 2; arc.position.z = .04; iris.add(arc);
    const fin = box([.12, .26, .13], shell, [Math.cos(i * Math.PI / 2 + .6) * 1.02, Math.sin(i * Math.PI / 2 + .6) * 1.02, -.08], nucleus, .035);
    fin.rotation.z = i * Math.PI / 2 + .6;
  }
  const rear = new THREE.Mesh(new THREE.TorusGeometry(1.12, .025, 8, 96), lights[3]);
  rear.position.z = -.18; nucleus.add(rear);

  // Two tilted signal rails give the same network different near and far planes.
  const rails: THREE.Group[] = [];
  const railPackets: { mesh: THREE.Mesh; angle: number; radius: number; rail: number }[] = [];
  [0, 1].forEach(index => {
    const rail = new THREE.Group(); rail.rotation.set(index ? .95 : 1.16, index ? -.32 : .26, index ? .34 : -.28);
    rail.scale.set(1.25, .92, 1); root.add(rail); rails.push(rail);
    const radius = index ? 2.14 : 2.26;
    rail.add(new THREE.Mesh(new THREE.TorusGeometry(radius, .012, 6, 120), wire));
    const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, .025, 8, 64, Math.PI * .82), lights[index ? 3 : 1]);
    arc.rotation.z = index ? Math.PI : -.5; rail.add(arc);
    for (let p = 0; p < 3; p++) {
      const mesh = sphere(p === 0 ? .062 : .032, lights[index ? 3 : 1]!, rail);
      railPackets.push({ mesh, angle: p * .16, radius, rail: index });
    }
  });

  const pickables: THREE.Object3D[] = [];
  const satellites: THREE.Group[] = [];
  const paths: THREE.CatmullRomCurve3[] = [];
  const signals: THREE.Mesh[][] = [];
  const locations = [[-2.05, .65, .32], [2.03, .7, -.02], [-1.57, -.92, .55], [1.6, -.97, .45]] as const;
  const satelliteMaterials: THREE.MeshPhysicalMaterial[] = [];
  locations.forEach((location, index) => {
    const satellite = new THREE.Group(); satellite.position.set(location[0], location[1], location[2]); root.add(satellite); satellites.push(satellite);
    const material = glass[index]!; satelliteMaterials.push(material);
    const tile = box([1.08, .82, .18], material, [0, 0, 0], satellite, .09);
    tile.userData.index = index; pickables.push(tile);
    box([.96, .7, .05], shell, [0, 0, .1], satellite, .06);
    box([.32, .025, .035], lights[index]!, [-.24, .31, .15], satellite, .008);
    if (index === 0) {
      for (let row = 0; row < 3; row++) {
        const y = .17 - row * .18;
        box([.105, .105, .03], lights[row]!, [-.3, y, .16], satellite, .02);
        box([.42 - row * .05, .025, .02], white, [.05, y, .16], satellite, .008);
      }
    } else if (index === 1) {
      for (let row = 0; row < 2; row++) {
        const bubble = box([.62, .16, .035], row ? lights[1]! : pearl, [row ? .08 : -.08, .14 - row * .25, .17], satellite, .05);
        bubble.rotation.z = row ? .035 : -.035;
      }
      box([.26, .025, .02], white, [.12, -.27, .15], satellite, .008);
    } else if (index === 2) {
      box([.47, .3, .035], lights[2]!, [-.13, .02, .17], satellite, .055);
      const camera = new THREE.Mesh(new THREE.CylinderGeometry(.09, .15, .16, 3), lights[1]);
      camera.rotation.z = -Math.PI / 2; camera.position.set(.24, .02, .17); satellite.add(camera);
      box([.49, .022, .022], white, [-.07, -.25, .17], satellite, .006);
    } else {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.2), lights[3]);
      crystal.position.set(-.18, .04, .23); crystal.rotation.set(.2, .3, .5); satellite.add(crystal);
      box([.26, .03, .03], white, [.16, .13, .17], satellite, .01);
      box([.2, .03, .03], lights[1]!, [.13, -.04, .17], satellite, .01);
      box([.4, .024, .024], lights[3]!, [-.08, -.23, .17], satellite, .008);
    }
    const path = tube([
      new THREE.Vector3(location[0] * .37, location[1] * .37, -.1),
      new THREE.Vector3(location[0] * .68, location[1] * .48, -.24),
      new THREE.Vector3(...location),
    ], .012, lights[index]!, root);
    paths.push(path);
    signals.push([sphere(.055, lights[index]!, root), sphere(.027, lights[index]!, root)]);
  });

  const targetScale = new THREE.Vector3();
  return {
    root, pickables,
    update(time: number, selected: number, pointer: THREE.Vector2) {
      nucleus.rotation.y = -root.rotation.y + pointer.x * .025;
      nucleus.rotation.x = pointer.y * .025;
      iris.rotation.z = time * .13;
      rails.forEach((rail, index) => { rail.rotation.z = (index ? .34 : -.28) + Math.sin(time * .24 + index) * .11; });
      railPackets.forEach(({ mesh, angle, radius, rail }) => {
        const phase = time * (rail ? -.28 : .32) + angle + (rail ? 1.8 : -.4);
        mesh.position.set(Math.cos(phase) * radius, Math.sin(phase) * radius, 0);
      });
      satellites.forEach((satellite, index) => {
        const base = locations[index]!;
        satellite.position.y = base[1] + Math.sin(time * .85 + index * 1.6) * .11;
        satellite.rotation.set(-.06 + pointer.y * .04, (index % 2 ? -.2 : .2) + pointer.x * .07, Math.sin(time * .45 + index) * .06);
        satellite.scale.copy(targetScale.setScalar(index === selected ? 1.08 : .98));
        satelliteMaterials[index]!.iridescenceThicknessRange = [140 + Math.sin(time * .6 + index) * 45, 440];
        signals[index]!.forEach((signal, packet) => {
          signal.position.copy(paths[index]!.getPoint((time * .22 + index / 4 + packet * .09) % 1));
          signal.scale.setScalar(index === selected ? 1.3 : .8);
        });
      });
    },
  };
}
