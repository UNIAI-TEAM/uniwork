import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type ScenePalette = { brand: string; paper: string; ink: string; mint: string; cyan: string; violet: string; pink: string };

/** A shared nucleus routes four work signals. The original brand mark stays a DOM overlay. */
export function buildSceneModel(palette: ScenePalette, screenSources: readonly string[], onScreenReady: () => void) {
  const root = new THREE.Group();
  const pearl = new THREE.MeshPhysicalMaterial({ color: palette.paper, roughness: .4, metalness: .15, clearcoat: .2 });
  const shell = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: .5, metalness: .25 });
  const frame = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(palette.paper).lerp(new THREE.Color(palette.ink), .12), roughness: .42, metalness: .5, clearcoat: .15 });
  const wire = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.ink).lerp(new THREE.Color(palette.paper), .5), transparent: true, opacity: .18, depthWrite: false });
  const box = (size: [number, number, number], material: THREE.Material, position: [number, number, number], parent: THREE.Object3D, radius = .08) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 3, Math.min(radius, Math.min(...size) * .45)), material);
    mesh.position.set(...position); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const tube = (points: THREE.Vector3[], radius: number, material: THREE.Material, parent: THREE.Object3D) => {
    const path = new THREE.CatmullRomCurve3(points);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(path, 48, radius, 6, false), material));
    return path;
  };

  // A single metal edge keeps the brand medallion tangible without a glowing halo.
  const nucleus = new THREE.Group(); root.add(nucleus);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.78, .88, .36, 64), shell);
  body.rotation.x = Math.PI / 2; body.castShadow = true; nucleus.add(body);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(.72, .76, .07, 64), pearl);
  face.rotation.x = Math.PI / 2; face.position.z = .22; nucleus.add(face);
  const innerEdge = new THREE.Mesh(new THREE.TorusGeometry(.78, .015, 10, 96), frame);
  innerEdge.position.z = .22; nucleus.add(innerEdge);

  // Two tilted signal rails give the same network different near and far planes.
  const rails: THREE.Group[] = [];
  [0, 1].forEach(index => {
    const rail = new THREE.Group(); rail.rotation.set(index ? .95 : 1.16, index ? -.32 : .26, index ? .34 : -.28);
    rail.scale.set(1.25, .92, 1); root.add(rail); rails.push(rail);
    const radius = index ? 2.14 : 2.26;
    rail.add(new THREE.Mesh(new THREE.TorusGeometry(radius, .012, 6, 120), wire));
  });

  const pickables: THREE.Object3D[] = [];
  const satellites: THREE.Group[] = [];
  const locations = [[-2.05, .65, .32], [2.03, .7, -.02], [-1.57, -.92, .55], [1.6, -.97, .45]] as const;
  const screenTextures: THREE.Texture[] = [];
  const screenLoader = new THREE.TextureLoader();
  let screensDisposed = false;
  const screenGeometry = () => {
    const width = .94, height = .68, radius = .035;
    const left = -width / 2, right = width / 2, bottom = -height / 2, top = height / 2;
    const shape = new THREE.Shape();
    shape.moveTo(left + radius, bottom);
    shape.lineTo(right - radius, bottom); shape.quadraticCurveTo(right, bottom, right, bottom + radius);
    shape.lineTo(right, top - radius); shape.quadraticCurveTo(right, top, right - radius, top);
    shape.lineTo(left + radius, top); shape.quadraticCurveTo(left, top, left, top - radius);
    shape.lineTo(left, bottom + radius); shape.quadraticCurveTo(left, bottom, left + radius, bottom);
    const geometry = new THREE.ShapeGeometry(shape);
    const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    for (let vertex = 0; vertex < positions.count; vertex++) {
      uv.setXY(vertex, positions.getX(vertex) / width + .5, positions.getY(vertex) / height + .5);
    }
    return geometry;
  };
  locations.forEach((location, index) => {
    const satellite = new THREE.Group(); satellite.position.set(location[0], location[1], location[2]); root.add(satellite); satellites.push(satellite);
    const tile = box([1.00, .76, .12], frame, [0, 0, 0], satellite, .06);
    tile.userData.index = index; pickables.push(tile);
    box([.96, .7, .02], shell, [0, 0, .072], satellite, .04);
    const texture = screenLoader.load(screenSources[index]!, loaded => {
      if (screensDisposed) { loaded.dispose(); return; }
      onScreenReady();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    screenTextures.push(texture);
    // Basic material preserves the captured app colours under the scene's lights.
    const screen = new THREE.Mesh(screenGeometry(), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.z = .083;
    screen.userData.index = index;
    satellite.add(screen); pickables.push(screen);
    tube([
      new THREE.Vector3(location[0] * .37, location[1] * .37, -.1),
      new THREE.Vector3(location[0] * .68, location[1] * .48, -.24),
      new THREE.Vector3(...location),
    ], .009, wire, root);
  });

  const targetScale = new THREE.Vector3();
  return {
    root, pickables,
    disposeScreens() {
      screensDisposed = true;
      screenTextures.forEach(texture => texture.dispose());
    },
    update(time: number, selected: number, pointer: THREE.Vector2) {
      nucleus.rotation.y = -root.rotation.y + pointer.x * .025;
      nucleus.rotation.x = pointer.y * .025;
      rails.forEach((rail, index) => { rail.rotation.z = (index ? .34 : -.28) + Math.sin(time * .24 + index) * .11; });
      satellites.forEach((satellite, index) => {
        const base = locations[index]!;
        satellite.position.y = base[1] + Math.sin(time * .85 + index * 1.6) * .11;
        satellite.rotation.set(-.06 + pointer.y * .04, (index % 2 ? -.2 : .2) + pointer.x * .07, Math.sin(time * .45 + index) * .06);
        satellite.scale.copy(targetScale.setScalar(index === selected ? 1.08 : .98));
      });
    },
  };
}
