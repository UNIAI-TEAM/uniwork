import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { buildStudioHorse } from "./studio-horse";
import { buildStudioArchitecture } from "./studio-architecture";

export type StudioPalette = { floor: string; paper: string; coat: string; ink: string; blue: string; cyan: string; coral: string };

/** One spatial scene shared by the entire landing, sampled by native scroll. */
export function createStudioWorld(host: HTMLElement, palette: StudioPalette, svg: string, onFailure: (failed: boolean) => void) {
  let compact = innerWidth < 768;
  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.2 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true"); host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.floor); scene.fog = new THREE.Fog(palette.floor, 16, 40);
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 70);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const lighting = pmrem.fromScene(environment, .04); scene.environment = lighting.texture; scene.environmentIntensity = .55;
  environment.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(palette.coat, palette.blue, 1.05));
  const key = new THREE.DirectionalLight(palette.coat, 2.5);
  key.position.set(-6, 10, 8); key.castShadow = true;
  key.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 32 }); key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -.0002; key.shadow.normalBias = .035; key.shadow.radius = 3; scene.add(key);
  const rim = new THREE.DirectionalLight(palette.cyan, 1.7); rim.position.set(7, 5, -6); scene.add(rim);
  const sun = new THREE.SpotLight(palette.coat, 85, 30, .75, .5, 2);
  sun.position.set(-2, 8, -.5); sun.target.position.set(0, 0, -3);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(palette.paper, .8); fill.position.set(1, 3, 10); scene.add(fill);

  let mirror: Reflector | undefined;
  if (!compact) {
    mirror = new Reflector(new THREE.PlaneGeometry(45, 45), { color: new THREE.Color(palette.floor), textureWidth: 768, textureHeight: 768, clipBias: .003 });
    mirror.rotation.x = -Math.PI / 2; mirror.position.y = -.014; scene.add(mirror);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(45, 45),
    new THREE.MeshPhysicalMaterial({ color: palette.floor, roughness: .42, metalness: .025, clearcoat: .18, transparent: !!mirror, opacity: mirror ? .94 : 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  const mark = new THREE.TextureLoader().load("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), () => draw());
  mark.colorSpace = THREE.SRGBColorSpace;
  const horse = buildStudioHorse({ coat: palette.coat, navy: palette.ink, blue: palette.blue, cyan: palette.cyan, coral: palette.coral }, mark);
  scene.add(horse.root);
  const envelope = new THREE.Box3().setFromObject(horse.root).expandByScalar(.20);
  const corners: THREE.Vector3[] = [];
  for (const x of [envelope.min.x, envelope.max.x]) for (const y of [envelope.min.y, envelope.max.y])
    for (const z of [envelope.min.z, envelope.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const shadowCanvas = document.createElement("canvas"); shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext("2d")!;
  const gradient = shadowContext.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, palette.ink); gradient.addColorStop(1, "transparent");
  shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 128, 128);
  const shadowMap = new THREE.CanvasTexture(shadowCanvas);
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, opacity: .26, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.78, 48), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .015; shadow.scale.set(1, .65, 1); scene.add(shadow);

  const route = new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.3, 0, 1.8), new THREE.Vector3(3.4, 0, -.4), new THREE.Vector3(.5, 0, -1.1),
    new THREE.Vector3(-3.3, 0, 1.1), new THREE.Vector3(-1.3, 0, 3.6), new THREE.Vector3(3.9, 0, 2.0),
    new THREE.Vector3(1.8, 0, -2.3), new THREE.Vector3(-2.4, 0, -1.2), new THREE.Vector3(.9, 0, 1.0),
  ]);
  buildStudioArchitecture(scene, palette, route);
  const distance = route.getLength();
  let disposed = false, lost = false, paused = false, frame = 0, last = 0, current = 0, target = 0;
  let viewportWidth = innerWidth, viewportHeight = innerHeight;
  let milestones: number[] = [], sceneProgress = 0;
  const routeProgress = (progress: number) => {
    if (!compact || milestones.length !== 3) return progress;
    const from = [0, ...milestones, 1], to = [0, .30, .695, 1, 1];
    for (let i = 1; i < from.length; i++) if (progress <= from[i]!)
      return THREE.MathUtils.lerp(to[i - 1]!, to[i]!, THREE.MathUtils.clamp((progress - from[i - 1]!) / Math.max(.0001, from[i]! - from[i - 1]!), 0, 1));
    return 1;
  };
  const smoothstep = (a: number, b: number, p: number) => THREE.MathUtils.smoothstep(p, a, b);
  const jump = (p: number, a: number, b: number) => {
    const t = THREE.MathUtils.clamp((p - a) / (b - a), 0, 1);
    return p > a && p < b ? Math.sin(t * Math.PI) : 0;
  };
  const draw = () => {
    if (disposed || lost || document.hidden) return;
    const p = paused ? sceneProgress : routeProgress(current); sceneProgress = p;
    const point = route.getPointAt(p), tangent = route.getTangentAt(p);
    const air = Math.max(jump(p, .255, .345), jump(p, .665, .725));
    const preparation = jump(p, .235, .255);
    const landing = jump(p, .345, .375) + jump(p, .725, .755);
    const running = smoothstep(.0, .015, p) * (1 - smoothstep(.91, 1, p));
    const heading = Math.atan2(tangent.x, tangent.z);
    const facing = p < .015 ? THREE.MathUtils.lerp(.35, heading, p / .015) : heading;
    horse.root.position.copy(point); horse.root.position.y = air * 1.65;
    horse.root.rotation.y = facing;
    horse.pose({ stride: p * distance / 1.06 * Math.PI * 2, running, airborne: air, crouch: preparation + landing * .65, turn: tangent.x, greeting: smoothstep(.96, 1, p) });
    shadow.position.set(point.x, .017, point.z); shadow.scale.setScalar(1 - air * .32); shadowMaterial.opacity = .26 * (1 - air * .62);
    const orbit = .48 + Math.sin(p * Math.PI * 2) * .8;
    const phone = viewportWidth < 768;
    const framing = (phone ? 15.8 : viewportWidth < 1100 ? 13.5 : 11.8) + air;
    const focus = new THREE.Vector3(point.x, (phone ? 3.6 : 1.70) + air * .95, point.z);
    camera.position.set(focus.x + Math.sin(orbit) * framing, (phone ? 5 : 3.1) + air * .5 + Math.sin(p * Math.PI) * .6,
      focus.z + Math.cos(orbit) * framing);
    camera.lookAt(focus);
    camera.zoom = 1;
    if (phone) camera.clearViewOffset();
    else {
      const windowWidth = Math.min(520, Math.max(330, viewportWidth * .36));
      const center = viewportWidth - windowWidth / 2 - 12;
      camera.setViewOffset(viewportWidth, viewportHeight, viewportWidth / 2 - center, 0, viewportWidth, viewportHeight);
      horse.root.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const preview = corners.map(corner => corner.clone().applyMatrix4(horse.root.matrixWorld).project(camera));
      const extent = Math.max(...preview.map(v => Math.abs((v.x + 1) * viewportWidth / 2 - center)));
      // Fit a conservative actor envelope inside the responsive scene window.
      camera.zoom = Math.min(1, (windowWidth / 2 - 24) / Math.max(1, extent));
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    host.dataset.rendered = "true"; host.dataset.pose = current.toFixed(5); host.dataset.scenePose = p.toFixed(5);
    const projected = corners.map(corner => corner.clone().applyMatrix4(horse.root.matrixWorld).project(camera));
    host.dataset.characterLeft = Math.min(...projected.map(v => (v.x + 1) * viewportWidth / 2)).toFixed(1);
    host.dataset.characterRight = Math.max(...projected.map(v => (v.x + 1) * viewportWidth / 2)).toFixed(1);
    host.dataset.characterTop = Math.min(...projected.map(v => (1 - v.y) * viewportHeight / 2)).toFixed(1);
    host.dataset.characterBottom = Math.max(...projected.map(v => (1 - v.y) * viewportHeight / 2)).toFixed(1);
    host.dataset.action = air > .02 ? "jump" : landing > .01 ? "land" : running > .1 ? "run" : "idle";
  };
  const tick = (now: number) => {
    frame = 0; if (disposed || lost || document.hidden || paused) return;
    const dt = last ? Math.min(.05, (now - last) / 1000) : .016; last = now;
    current += (target - current) * (1 - Math.exp(-dt * 18));
    if (Math.abs(target - current) < .00002) current = target;
    draw();
    host.dataset.running = String(current !== target);
    if (current !== target) frame = requestAnimationFrame(tick); else last = 0;
  };
  const request = () => {
    if (disposed || lost || document.hidden || paused) return;
    if (!frame) { host.dataset.running = "true"; frame = requestAnimationFrame(tick); }
  };
  const resize = () => {
    viewportWidth = innerWidth; viewportHeight = innerHeight;
    const nextCompact = viewportWidth < 768;
    renderer.setPixelRatio(Math.min(devicePixelRatio, nextCompact ? 1.2 : 1.5));
    if (nextCompact !== compact) {
      compact = nextCompact;
      key.shadow.map?.dispose(); key.shadow.map = null;
      key.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048); key.shadow.needsUpdate = true;
      if (compact && mirror) { scene.remove(mirror); mirror.geometry.dispose(); mirror.dispose(); mirror = undefined; }
      if (!compact && !mirror) {
        mirror = new Reflector(new THREE.PlaneGeometry(45, 45), { color: new THREE.Color(palette.floor), textureWidth: 768, textureHeight: 768, clipBias: .003 });
        mirror.rotation.x = -Math.PI / 2; mirror.position.y = -.014; scene.add(mirror);
      }
      floor.material.transparent = !!mirror; floor.material.opacity = mirror ? .94 : 1; floor.material.needsUpdate = true;
    }
    renderer.setSize(viewportWidth, viewportHeight, false);
    camera.aspect = viewportWidth / viewportHeight; camera.updateProjectionMatrix(); draw();
  };
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; host.dataset.running = "false"; } else request(); };
  const contextLost = (e: Event) => { e.preventDefault(); lost = true; host.dataset.rendered = "false"; onFailure(true); cancelAnimationFrame(frame); host.dataset.running = "false"; };
  const contextRestored = () => { lost = false; onFailure(false); resize(); request(); };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", resize);

  resize(); draw();
  return {
    setState(next: { progress: number; paused: boolean; milestones?: number[] }) {
      milestones = next.milestones ?? milestones;
      const wasPaused = paused; paused = next.paused; target = THREE.MathUtils.clamp(next.progress, 0, 1);
      host.dataset.motion = paused ? "paused" : "scroll";
      if (paused) { cancelAnimationFrame(frame); frame = 0; host.dataset.running = "false"; }
      else { if (wasPaused) last = 0; request(); }
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost); renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)); } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      mirror?.getRenderTarget().dispose(); shadowMap.dispose(); mark.dispose(); lighting.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
