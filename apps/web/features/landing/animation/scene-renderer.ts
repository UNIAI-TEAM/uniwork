import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildSceneModel, type ScenePalette } from "./scene-models";

export function createScene(host: HTMLElement, palette: ScenePalette, onSelect: (index: number) => void, onFailure: (failed: boolean) => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true"); host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 50);
  camera.position.set(0, .48, 7.4); camera.lookAt(0, 0, 0);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, .04);
  scene.environment = environmentTarget.texture; scene.environmentIntensity = .65; environment.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(palette.paper, palette.brand, .8));
  const key = new THREE.DirectionalLight(palette.paper, 2); key.position.set(-3, 5, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.blurSamples = 8; key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4; key.shadow.normalBias = .025; scene.add(key);
  const rim = new THREE.DirectionalLight(palette.brand, 1.5); rim.position.set(3, 1, -2); scene.add(rim);
  const model = buildSceneModel(palette); scene.add(model.root);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: .065 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.92; floor.receiveShadow = true; scene.add(floor);
  const pointer = new THREE.Vector2(); const raycaster = new THREE.Raycaster();
  let visible = false, paused = false, disposed = false, lost = false, selected = 0, turn = 0;
  let elapsed = 0, last = 0, frame = 0, dragging = false, moved = false, startX = 0, rotation = 0, targetRotation = 0;
  const draw = () => {
    if (disposed || lost) return;
    model.root.rotation.y = rotation;
    model.update(elapsed, selected, pointer);
    renderer.render(scene, camera);
    host.dataset.rendered = "true";
  };
  const tick = (now: number) => {
    if (disposed || lost || !visible || document.hidden || paused) { frame = 0; return; }
    const delta = last ? Math.min((now - last) / 1000, .05) : 0; last = now;
    elapsed += delta;
    rotation += (targetRotation - rotation) * .12;
    draw(); frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    host.dataset.running = String(visible && !document.hidden && !paused && !lost);
    if (visible && !document.hidden && !paused && !lost) frame = requestAnimationFrame(tick);
    else draw();
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); draw();
  };
  const observer = new ResizeObserver(resize); observer.observe(host);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; sync(); }, { threshold: .08 }); visibility.observe(host);
  const canvas = renderer.domElement;
  const down = (event: PointerEvent) => { dragging = true; moved = false; startX = event.clientX; canvas.setPointerCapture(event.pointerId); };
  const move = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    if (dragging) { const dx = event.clientX - startX; moved ||= Math.abs(dx) > 3; targetRotation += dx * .008; startX = event.clientX; }
    if (paused) { rotation = targetRotation; draw(); }
  };
  const up = (event: PointerEvent) => {
    if (!dragging) return; dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!moved) {
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(model.pickables)[0];
      if (hit) onSelect(Number(hit.object.userData.index));
    }
  };
  const cancel = () => { dragging = false; };
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; host.dataset.rendered = "false"; onFailure(true); sync(); };
  const contextRestored = () => { lost = false; onFailure(false); sync(); };
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  document.addEventListener("visibilitychange", sync); resize(); sync();
  return {
    setState(next: { paused: boolean; selected: number; turn: number }) {
      paused = next.paused; selected = next.selected;
      if (turn !== next.turn) { targetRotation += Math.PI / 3; turn = next.turn; }
      if (paused) { rotation = targetRotation; elapsed = .8; }
      draw(); sync();
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored);
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material)); } });
      materials.forEach(material => material.dispose()); environmentTarget.dispose(); renderer.forceContextLoss(); renderer.dispose(); canvas.remove();
    },
  };
}
