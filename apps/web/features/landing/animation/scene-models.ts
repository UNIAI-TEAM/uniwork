import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type ScenePalette = { brand: string; paper: string; ink: string; mint: string };

/** The original mark is a stationary Logo overlay; geometry never redraws it. */
export function buildSceneModel(palette: ScenePalette) {
  const root = new THREE.Group();
  const porcelain = new THREE.MeshPhysicalMaterial({ color: palette.paper, roughness: .19, metalness: .08, clearcoat: .8, clearcoatRoughness: .22 });
  const cobalt = new THREE.MeshPhysicalMaterial({ color: palette.brand, roughness: .2, metalness: .25, clearcoat: .7 });
  const ink = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: .38 });
  const frost = new THREE.MeshPhysicalMaterial({ color: palette.mint, roughness: .22, metalness: .12, transparent: true, opacity: .38, depthWrite: false });
  const metal = new THREE.MeshPhysicalMaterial({ color: palette.paper, roughness: .23, metalness: .8 });
  const box = (size: [number, number, number], material: THREE.Material, position: [number, number, number], parent: THREE.Object3D, radius = .08) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 5, Math.min(radius, Math.min(...size) * .45)), material);
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const dot = (radius: number, material: THREE.Material, position: [number, number, number], parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    mesh.position.set(...position); parent.add(mesh); return mesh;
  };
  const line = (points: THREE.Vector3[], radius: number, material: THREE.Material, parent: THREE.Object3D) => {
    const path = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 64, radius, 8, false), material);
    parent.add(mesh); return path;
  };
  const medallion = new THREE.Group(); root.add(medallion);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.96, .96, .2, 96), porcelain);
  hub.rotation.x = Math.PI / 2; hub.castShadow = true; medallion.add(hub);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.97, .027, 16, 120), metal);
  rim.position.z = .04; medallion.add(rim);
  const backplate = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, .07, 96), frost);
  backplate.rotation.x = Math.PI / 2; backplate.position.z = -.22; medallion.add(backplate);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(2.13, .018, 12, 160), metal);
  rail.rotation.set(1.04, .14, -.28); rail.position.y = -.15; root.add(rail);
  const lowerRail = new THREE.Mesh(new THREE.TorusGeometry(2.22, .012, 12, 160), frost);
  lowerRail.rotation.copy(rail.rotation); lowerRail.position.y = -.27; root.add(lowerRail);
  const pickables: THREE.Object3D[] = [];
  const satellites: THREE.Group[] = [];
  const paths: THREE.CatmullRomCurve3[] = [];
  const signals: THREE.Mesh[] = [];
  const locations = [[-1.85, .58, .22], [1.77, .74, -.25], [.65, -1.28, .6]] as const;
  locations.forEach((location, index) => {
    const satellite = new THREE.Group(); satellite.position.set(location[0], location[1], location[2]); root.add(satellite); satellites.push(satellite);
    const surface = index === 1 ? cobalt : porcelain;
    const detail = index === 1 ? porcelain : cobalt;
    const tile = box([1.17, .94, .13], surface, [0, 0, 0], satellite, .08);
    tile.userData.index = index; pickables.push(tile);
    box([1.08, .85, .04], frost, [.04, -.055, -.105], satellite, .07);
    if (index === 0) {
      for (let row = 0; row < 3; row++) {
        const y = .25 - row * .23;
        box([.14, .14, .028], detail, [-.35, y, .095], satellite, .025);
        box([.51 - row * .065, .037, .028], row === 2 ? metal : ink, [.035, y, .095], satellite, .015);
      }
    } else if (index === 1) {
      for (let row = 0; row < 2; row++) {
        box([.66, .19, .035], detail, [row ? .10 : -.08, .17 - row * .31, .10], satellite, .065);
        [-.14, 0, .14].forEach(x => dot(.021, cobalt, [x + (row ? .10 : -.08), .17 - row * .31, .128], satellite));
      }
    } else {
      box([.19, .19, .03], detail, [-.31, .22, .09], satellite, .035);
      box([.4, .05, .03], ink, [.07, .22, .09], satellite, .018);
      box([.8, .045, .025], metal, [0, -.01, .09], satellite, .015);
      box([.56, .045, .025], metal, [-.12, -.18, .09], satellite, .015);
    }
    const connection = line([
      new THREE.Vector3(location[0] * .43, location[1] * .43, -.1),
      new THREE.Vector3(location[0] * .7, location[1] * .6 - .23, .1),
      new THREE.Vector3(...location),
    ], .013, frost, root);
    paths.push(connection); signals.push(dot(.045, cobalt, [0, 0, 0], root));
  });
  const selectionScale = new THREE.Vector3();
  return {
    root, pickables,
    update(time: number, selected: number, pointer: THREE.Vector2) {
      // The brand's support stays still while the work moves around it.
      medallion.rotation.y = -root.rotation.y;
      satellites.forEach((satellite, index) => {
        const base = locations[index]!;
        satellite.position.y = base[1] + Math.sin(time * .9 + index * 1.9) * .09;
        satellite.rotation.set(-.05 + pointer.y * .025, .12 + pointer.x * .035, Math.sin(time * .5 + index) * .045);
        satellite.scale.lerp(selectionScale.setScalar(index === selected ? 1.1 : .96), .1);
        signals[index]!.position.copy(paths[index]!.getPoint((time * .23 + index / 3) % 1));
        signals[index]!.scale.setScalar(index === selected ? 1.25 : .65);
      });
    },
  };
}
