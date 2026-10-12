import * as THREE from "three";
import type { StudioPalette } from "./studio-world";

/** Layered atrium masses sit beyond the action route; low ramps can occlude the feet. */
export function buildStudioArchitecture(scene: THREE.Scene, palette: StudioPalette, route: THREE.CatmullRomCurve3) {
  const stone = new THREE.MeshPhysicalMaterial({ color: palette.paper, roughness: .5, clearcoat: .12 });
  const blue = new THREE.MeshPhysicalMaterial({ color: palette.blue, roughness: .36, clearcoat: .25 });
  const trim = new THREE.MeshStandardMaterial({ color: palette.cyan, roughness: .45 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, position: number[]) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(position[0]!, position[1]!, position[2]!);
    object.castShadow = object.receiveShadow = true; scene.add(object); return object;
  };
  const curve = (points: number[][], radius: number, material: THREE.Material) =>
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p as [number, number, number]))), 80, radius, 16), material, [0, 0, 0]);
  const arch = (x: number, y: number, z: number, scale: number, angle: number) => {
    const form = new THREE.Shape();
    form.moveTo(-2.3, 0); form.lineTo(-2.3, 3.5); form.absarc(0, 3.5, 2.3, Math.PI, 0, true);
    form.lineTo(2.3, 0); form.lineTo(1.72, 0); form.lineTo(1.72, 3.5);
    form.absarc(0, 3.5, 1.72, 0, Math.PI, false); form.lineTo(-1.72, 0); form.closePath();
    const portal = mesh(new THREE.ExtrudeGeometry(form, { depth: .9, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .065, bevelThickness: .065, curveSegments: 32 }), stone, [x, y, z]);
    portal.rotation.y = angle; portal.scale.setScalar(scale);
  };
  for (const level of [0, 4.8]) {
    arch(-9.2, level, -8, .92, .3); arch(-3.9, level, -12.2, .94, .05);
    arch(2.1, level, -12.5, .96, -.08); arch(8.4, level, -9.3, .95, -.32);
  }
  // Massive back-gallery slabs, rather than disconnected white portals.
  for (const height of [0, 4.7, 9.4]) {
    const arc = new THREE.Shape(); arc.absarc(0, 0, 14.6, Math.PI * 1.08, Math.PI * 1.92, false);
    arc.absarc(0, 0, 12.8, Math.PI * 1.92, Math.PI * 1.08, true); arc.closePath();
    const gallery = mesh(new THREE.ExtrudeGeometry(arc, { depth: .32, bevelEnabled: true, bevelSize: .06, bevelThickness: .04, bevelSegments: 2, curveSegments: 64 }), stone, [0, height, 0]);
    gallery.rotation.x = Math.PI / 2;
    const ribbon = mesh(new THREE.TorusGeometry(13.1, .065, 12, 96, Math.PI * .84), blue, [0, height + .05, 0]);
    ribbon.rotation.set(Math.PI / 2, 0, Math.PI * 1.08);
  }
  const roof = mesh(new THREE.TorusGeometry(10.8, .22, 16, 96), stone, [0, 7.6, -2]);
  roof.rotation.x = Math.PI / 2;
  for (let i = 0; i < 11; i++) {
    const theta = Math.PI + i / 10 * Math.PI;
    curve([[Math.cos(theta) * 10.8, 7.6, Math.sin(theta) * 10.8 - 2],
      [Math.cos(theta) * 6, 8.7, Math.sin(theta) * 6 - 2], [0, 9.3, -2]], .07, stone);
  }
  const rampShape = new THREE.Shape();
  rampShape.moveTo(-1.8, 0); rampShape.bezierCurveTo(-1.1, .10, -.6, .65, 0, .65);
  rampShape.bezierCurveTo(.65, .65, 1.3, .15, 1.8, 0); rampShape.closePath();
  const crossing = route.getPointAt(.30), tangent = route.getTangentAt(.30);
  const ramp = mesh(new THREE.ExtrudeGeometry(rampShape, { depth: 2.8, bevelEnabled: true, bevelSize: .05, bevelThickness: .05, bevelSegments: 3, curveSegments: 40 }), stone, [crossing.x, .025, crossing.z]);
  ramp.rotation.y = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
  // The blue inlay is attached to the same ramp transform.
  const inlay = new THREE.Mesh(new THREE.ExtrudeGeometry(rampShape, { depth: .045, bevelEnabled: false, curveSegments: 40 }), blue);
  inlay.position.z = 2.81; ramp.add(inlay);
  const nearInlay = inlay.clone(); nearInlay.position.z = -.055; ramp.add(nearInlay);
  const second = route.getPointAt(.695), direction = route.getTangentAt(.695);
  const hurdle = mesh(new THREE.BoxGeometry(1.8, .28, .40), blue, [second.x, .14, second.z]);
  hurdle.rotation.y = Math.atan2(direction.x, direction.z);
  for (const offset of [-.14, .14]) curve([[-12, .014, 5 + offset], [-3, .014, 3 + offset],
    [4, .014, -1 + offset], [9, .014, -9 + offset]], .025, trim);
}