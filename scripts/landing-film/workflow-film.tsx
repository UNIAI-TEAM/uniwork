import { useLayoutEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ACESFilmicToneMapping, Color, CubicBezierCurve3, ExtrudeGeometry, PMREMGenerator, Shape, Vector3, VSMShadowMap } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const COBALT = "#0b5bf5";
const PAPER = "#edf2ff";
const NAVY = "#101f42";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.25, 1) } as const;
type Point = [number, number, number];

function roundedRectangle(width: number, height: number, radius: number) {
  const s = new Shape();
  const x = -width / 2;
  const y = -height / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + width - radius, y);
  s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius);
  s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  return s;
}

function Plate({ width, height, depth = 0.07, radius = 0.13, color, metalness = 0.18, roughness = 0.3 }: {
  width: number; height: number; depth?: number; radius?: number; color: string; metalness?: number; roughness?: number;
}) {
  const bevel = Math.min(0.018, depth * 0.32, height * 0.2);
  const geometry = useMemo(() => new ExtrudeGeometry(roundedRectangle(width, height, radius), {
    depth, bevelEnabled: true, bevelSegments: 5, steps: 1,
    bevelSize: bevel, bevelThickness: bevel, curveSegments: 20,
  }), [width, height, depth, radius, bevel]);
  return <mesh geometry={geometry} castShadow receiveShadow>
    <meshPhysicalMaterial color={color} roughness={roughness} metalness={metalness}
      clearcoat={0.38} clearcoatRoughness={0.26} envMapIntensity={0.8} />
  </mesh>;
}

function Rule({ x, y, width, color, thickness = 0.026, z = 0.139, angle = 0 }: {
  x: number; y: number; width: number; color: string; thickness?: number; z?: number; angle?: number;
}) {
  return <group position={[x, y, z]} rotation={[0, 0, angle]}>
    <Plate width={width} height={thickness} radius={thickness / 2.4} depth={0.004} color={color} metalness={0.1} roughness={0.48} />
  </group>;
}

function Disc({ position, radius, color, rim = false }: { position: Point; radius: number; color: string; rim?: boolean }) {
  return <group position={position}>
    {rim && <mesh>
      <torusGeometry args={[radius + 0.012, 0.009, 10, 40]} />
      <meshStandardMaterial color="#c7d8f1" roughness={0.37} metalness={0.6} />
    </mesh>}
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[radius, radius, 0.017, 40]} />
      <meshPhysicalMaterial color={color} roughness={0.36} metalness={0.23} clearcoat={0.5} />
    </mesh>
  </group>;
}

function Tick({ x, y, color, scale = 1 }: { x: number; y: number; color: string; scale?: number }) {
  return <group position={[x, y, 0.148]} scale={scale}>
    <Rule x={-0.031} y={-0.015} z={0} width={0.079} thickness={0.025} color={color} angle={-0.72} />
    <Rule x={0.039} y={0.018} z={0} width={0.129} thickness={0.025} color={color} angle={0.81} />
  </group>;
}

function MeetingDetail({ index, clock, ink, muted }: { index: number; clock: number; ink: string; muted: string }) {
  return <group>
    <Disc position={[-0.72, 0.42, 0.14]} radius={0.082} color={ink} rim />
    <Disc position={[-0.58, 0.42, 0.145]} radius={0.082} color={muted} rim />
    <Rule x={0.13} y={0.43} width={0.75} color={ink} thickness={0.036} />
    <Rule x={-0.02} y={0.29} width={0.45} color={muted} thickness={0.016} />
    {Array.from({ length: 25 }, (_, bar) => {
      const height = 0.065 + (0.5 + 0.5 * Math.sin(bar * 1.38 + index * 1.7 + clock * 2)) * (0.18 + 0.12 * Math.sin(bar * 0.6));
      return <group key={bar} position={[-0.79 + bar * 0.066, -0.13, 0.139]}>
        <Plate width={0.026} height={height} radius={0.011} depth={0.006} color={bar < 14 ? ink : muted} roughness={0.5} />
      </group>;
    })}
    <Rule x={-0.56} y={-0.44} width={0.44} color={muted} thickness={0.016} />
    <Rule x={0.58} y={-0.44} width={0.31} color={muted} thickness={0.016} />
  </group>;
}

function TaskDetail({ index, ink, muted, reveal }: { index: number; ink: string; muted: string; reveal: number }) {
  const accent = index === 0 ? COBALT : "#c0dfff";
  return <group>
    <Disc position={[-0.72, 0.66, 0.137]} radius={0.12} color={accent} />
    <Tick x={-0.72} y={0.66} color={index === 0 ? "#ffffff" : NAVY} />
    <Rule x={0.06} y={0.71} width={0.92} thickness={0.037} color={ink} />
    <Rule x={-0.14} y={0.54} width={0.51} thickness={0.019} color={muted} />
    <Rule x={0} y={0.34} width={1.66} thickness={0.011} color={muted} />
    {[0, 1, 2].map((row) => <group key={row} position={[0, -row * 0.26, 0]}>
      <group position={[-0.76, 0.13, 0.132]}>
        <Plate width={0.115} height={0.115} depth={0.01} radius={0.023} color={row === 0 ? accent : muted} roughness={0.5} />
      </group>
      {row === 0 && <Tick x={-0.76} y={0.13} color={index === 0 ? "#ffffff" : NAVY} scale={0.47 * reveal} />}
      <Rule x={-0.1 - row * 0.035} y={0.145} width={1.01 - row * 0.07} thickness={0.025} color={ink} />
      <Rule x={-0.28} y={0.046} width={0.63} thickness={0.011} color={muted} />
    </group>)}
    <Rule x={0} y={-0.59} width={1.66} thickness={0.01} color={muted} />
    {[-0.74, -0.6, -0.46].map((x, owner) => <Disc key={x} position={[x, -0.76, 0.143 + owner * 0.006]} radius={0.071} color={owner === 1 ? muted : accent} />)}
    <group position={[0.51, -0.76, 0.135]}>
      <Plate width={0.52} height={0.126} radius={0.055} depth={0.009} color={muted} roughness={0.5} />
      <Rule x={0} y={0} width={0.28} thickness={0.015} color={ink} z={0.019} />
    </group>
  </group>;
}

const starts: Point[] = [[-2.28, 0.44, 0.16], [0, 1.49, -0.5], [2.35, 0.46, 0.18]];
const gathered: Point[] = [[-0.69, 0.66, 0.73], [0, 0.96, 0.25], [0.69, 1.22, -0.24]];
const finishes: Point[] = [[-2.35, 0.05, 0.14], [0, 1.05, -0.5], [2.35, 0.05, 0.14]];

function WorkTile({ index, phase, clock }: { index: number; phase: number; clock: number }) {
  const gather = interpolate(phase, [24 + index * 3, 60 + index * 3], [0, 1], clamp);
  const spread = interpolate(phase, [78 + index * 3, 116 + index * 3], [0, 1], clamp);
  const conversion = interpolate(phase, [62, 104], [0, 1], clamp);
  const context = Math.sin(Math.PI * interpolate(phase, [39, 102], [0, 1], clamp));
  const position = starts[index].map((value, axis) =>
    value + (gathered[index][axis] - value) * gather + (finishes[index][axis] - gathered[index][axis]) * spread,
  ) as Point;
  position[1] += Math.sin(clock + index * 1.4) * 0.035;
  const color = ["#fcfdff", COBALT, NAVY][index];
  const ink = index === 0 ? "#294879" : "#f1f6ff";
  const muted = ["#b5c9e8", "#76a7fa", "#5d779c"][index];
  const rotation = [0.06, -0.085, -0.07][index] * (1 - spread) + (index - 1) * context * 0.04;
  const height = 1.38 + conversion * 0.66;
  const tailGeometry = useMemo(() => {
    const tail = new Shape();
    tail.moveTo(-0.47, -0.61);
    tail.lineTo(-0.47, -0.88);
    tail.quadraticCurveTo(-0.47, -0.94, -0.4, -0.9);
    tail.lineTo(-0.06, -0.61);
    return new ExtrudeGeometry(tail, { depth: 0.07, bevelEnabled: true, bevelSize: 0.013, bevelThickness: 0.013, bevelSegments: 4 });
  }, []);
  return <group position={position} rotation={[-0.07 + context * 0.03, -0.13 + index * 0.065, rotation]}>
    <group position={[0.026, -0.025, -0.025]}>
      <Plate width={2.12} height={height} depth={0.032} radius={0.145} color={index === 0 ? "#aebfd9" : muted} metalness={0.72} roughness={0.25} />
    </group>
    <Plate width={2.12} height={height} radius={0.145} color={color} metalness={index === 0 ? 0.04 : 0.48} roughness={index === 0 ? 0.3 : 0.32} />
    <group position={[0, 0, 0.081]}>
      <Plate width={2.048} height={height - 0.07} depth={0.012} radius={0.116} color={color} metalness={index === 0 ? 0.02 : 0.35} roughness={0.4} />
    </group>
    <mesh geometry={tailGeometry} scale={Math.max(0.001, 1 - conversion)} castShadow>
      <meshPhysicalMaterial color={color} roughness={0.34} metalness={index === 0 ? 0.04 : 0.4} />
    </mesh>
    <group scale={Math.max(0.001, 1 - conversion)}>
      <MeetingDetail index={index} clock={clock} ink={ink} muted={muted} />
    </group>
    <group scale={Math.max(0.001, conversion)}>
      <TaskDetail index={index} ink={ink} muted={muted} reveal={spread} />
    </group>
    <group position={[-0.06, 0.06, -0.082]} scale={Math.max(0.001, context)} rotation={[0, 0, 0.055]}>
      <Plate width={2.08} height={1.63} depth={0.021} radius={0.1} color="#dbe7f8" roughness={0.5} />
    </group>
  </group>;
}

function Link({ side, reveal, clock }: { side: number; reveal: number; clock: number }) {
  const curve = useMemo(() => new CubicBezierCurve3(
    new Vector3(side * 0.72, 0.05, -0.32), new Vector3(side * 1.1, -0.8, 0.44),
    new Vector3(side * 1.61, -1.3, 0.64), new Vector3(side * 2.23, -1.04, 0.31),
  ), [side]);
  const bead = curve.getPoint((clock / (Math.PI * 2) + (side === 1 ? 0.31 : 0.66)) % 1);
  return <group scale={Math.max(0.001, reveal)}>
    <mesh castShadow>
      <tubeGeometry args={[curve, 64, 0.018, 12, false]} />
      <meshPhysicalMaterial color="#91b8ed" roughness={0.3} metalness={0.56} clearcoat={0.4} />
    </mesh>
    <mesh position={bead} castShadow>
      <sphereGeometry args={[0.049, 24, 16]} />
      <meshPhysicalMaterial color={COBALT} roughness={0.23} metalness={0.48} clearcoat={0.55} />
    </mesh>
  </group>;
}

function CameraRig({ clock }: { clock: number }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(3.7 + Math.sin(clock) * 0.24, 3.05 + (1 - Math.cos(clock)) * 0.06, 10.65);
    camera.lookAt(0, 0.4, 0);
    camera.updateMatrixWorld();
  }, [camera, clock]);
  return null;
}

export function WorkflowFilm() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // All transforms, reflections, and work details return to the same frame-defined state.
  const phase = interpolate(frame, [0, 122, 156, 209], [0, 122, 122, 0], {
    ...clamp, easing: [Easing.linear, Easing.linear, Easing.bezier(0.7, 0, 0.3, 1)],
  });
  const clock = ((frame === 209 ? 0 : frame) / 209) * Math.PI * 2;
  const reveal = interpolate(phase, [93, 122], [0, 1], clamp);
  return <AbsoluteFill style={{ backgroundColor: PAPER }}>
    <ThreeCanvas width={width} height={height} shadows dpr={1}
      camera={{ position: [3.7, 3.05, 10.65], fov: 37, near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: false, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ scene, gl }) => {
        scene.background = new Color(PAPER);
        gl.shadowMap.type = VSMShadowMap;
        const studio = new RoomEnvironment();
        const generator = new PMREMGenerator(gl);
        scene.environment = generator.fromScene(studio, 0.065).texture;
        scene.environmentIntensity = 0.78;
        studio.dispose();
        generator.dispose();
      }}>
      <CameraRig clock={clock} />
      <fog attach="fog" args={[PAPER, 18, 35]} />
      <ambientLight intensity={0.38} />
      <hemisphereLight args={["#ffffff", "#cad5e9", 0.78]} />
      <directionalLight position={[-3.5, 7, 5]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-normalBias={0.022} shadow-bias={-0.00008} shadow-radius={7} shadow-blurSamples={16} />
      <directionalLight position={[5, 4, -3]} intensity={1.4} color="#d4e4ff" />
      <directionalLight position={[-5, 1, 0]} intensity={0.45} color="#ffffff" />
      <group rotation={[0, -0.08 + Math.sin(clock) * 0.025, 0]}>
        <group position={[0, -1.2, -0.09]} rotation={[-Math.PI / 2, 0, 0]}>
          <Plate width={7.25} height={3.7} depth={0.055} radius={0.42} color="#f8faff" metalness={0.08} roughness={0.52} />
        </group>
        {[-1, 1].map((side) => <Link key={side} side={side} reveal={reveal} clock={clock} />)}
        {[0, 1, 2].map((index) => <WorkTile key={index} index={index} phase={phase} clock={clock} />)}
      </group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.28, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={PAPER} roughness={0.86} metalness={0} />
      </mesh>
    </ThreeCanvas>
  </AbsoluteFill>;
}
