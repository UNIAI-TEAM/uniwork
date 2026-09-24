import * as THREE from "three";

/** Preserve the approved artwork; the wave mask never reaches the face. */
export function createMascotRenderer(host: HTMLElement, onFailure: (failed: boolean) => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.z = 2;
  const uniforms = { uPortrait: { value: null as THREE.Texture | null }, uWave: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: `
      uniform float uWave;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 transformed = position;
        // The cheek begins to the right of this sloping, feathered boundary.
        // Unlike a radial joint mask, it cannot rotate face or mane vertices.
        float rightEdge = mix(0.350, 0.292, smoothstep(0.50, 0.58, uv.y));
        float foreleg = (1.0 - smoothstep(rightEdge - 0.018, rightEdge, uv.x))
          * smoothstep(0.443, 0.492, uv.y)
          * (1.0 - smoothstep(0.687, 0.706, uv.y));
        if (foreleg > 0.0 && uWave != 0.0) {
          vec2 local = (uv - vec2(0.345, 0.515)) * 2.0;
          float angle = uWave * foreleg;
          mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
          transformed.xy += turn * local - local;
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uPortrait;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(uPortrait, vUv);
        if (gl_FragColor.a < 0.003) discard;
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = new THREE.PlaneGeometry(2, 2, 144, 144);
  scene.add(new THREE.Mesh(geometry, material));

  let disposed = false, lost = false, loaded = false, visible = false, paused = true;
  let last = 0, gesture = 2.4, gestureAge = 0;
  const draw = () => {
    if (disposed || lost || !loaded) return;
    const envelope = Math.min(1, gestureAge / .22, gesture / .35);
    uniforms.uWave.value = !paused && gesture > 0 ? Math.sin(gestureAge * 8.2) * .085 * Math.max(0, envelope) : 0;
    host.dataset.expression = !paused && gesture > 0 ? "greeting" : "idle";
    renderer.render(scene, camera);
    host.dataset.rendered = "true";
  };
  const tick = (time: number) => {
    if (disposed || lost || !loaded || !visible || paused || document.hidden) return;
    const delta = last ? Math.min((time - last) / 1000, .05) : 0;
    last = time; gestureAge += delta; gesture = Math.max(0, gesture - delta);
    draw();
    if (gesture === 0) sync();
  };
  const sync = () => {
    const running = !disposed && !lost && loaded && visible && !paused && gesture > 0 && !document.hidden;
    renderer.setAnimationLoop(running ? tick : null); last = 0;
    host.dataset.running = String(running);
    if (!running) draw();
  };
  const resize = () => {
    // Scroll-reveal transforms must not shrink the drawing buffer or override
    // the canvas's 100% CSS size: artwork and shirt mark share this layout box.
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const side = Math.min(width, height);
    camera.left = -width / side; camera.right = width / side;
    camera.top = height / side; camera.bottom = -height / side;
    camera.updateProjectionMatrix(); draw();
  };
  const texture = new THREE.TextureLoader().load("/landing/mascot/uni-horse-v2.webp", (portrait) => {
    if (disposed) { portrait.dispose(); return; }
    portrait.colorSpace = THREE.SRGBColorSpace;
    uniforms.uPortrait.value = portrait;
    loaded = true; onFailure(false); draw(); sync();
  }, undefined, () => {
    if (!disposed) { host.dataset.rendered = "false"; onFailure(true); }
  });
  const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(host);
  const viewObserver = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; sync(); }, { threshold: .08 }); viewObserver.observe(host);
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; host.dataset.rendered = "false"; onFailure(true); sync(); };
  const contextRestored = () => { lost = false; onFailure(false); sync(); };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  document.addEventListener("visibilitychange", sync);
  resize(); sync();
  return {
    setState(next: { paused: boolean }) {
      paused = next.paused;
      sync();
    },
    dispose() {
      disposed = true; renderer.setAnimationLoop(null); sizeObserver.disconnect(); viewObserver.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
      document.removeEventListener("visibilitychange", sync);
      texture.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
