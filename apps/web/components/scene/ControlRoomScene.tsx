"use client";

import { useMemo, useRef, useState, Suspense, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  Lightformer,
  ContactShadows,
  MeshReflectorMaterial,
} from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import type { SceneData } from "./scene-data";
import { QueuePillar } from "./QueuePillar";
import { WorkerNode } from "./WorkerNode";
import { ParticleFlow } from "./ParticleFlow";

/* ── Layout helpers ───────────────────────────────────────────────────────── */

function useLayout(queueCount: number, workerCount: number) {
  // Positions depend only on topology (counts), so they stay stable across the
  // 1.5s data polls — the particle streams don't reshuffle when only numbers change.
  const queuePositions = useMemo(() => {
    const spacing = queueCount > 8 ? 1.5 : 1.9;
    return Array.from(
      { length: queueCount },
      (_, i) => new THREE.Vector3((i - (queueCount - 1) / 2) * spacing, 0, 0),
    );
  }, [queueCount]);

  const workerPositions = useMemo(() => {
    const R = 5.5;
    return Array.from({ length: workerCount }, (_, i) => {
      const frac = workerCount === 1 ? 0.5 : i / (workerCount - 1);
      const angle = Math.PI * (0.12 + 0.76 * frac);
      return new THREE.Vector3(
        Math.cos(angle) * R,
        2.1 + Math.sin(angle) * 1.7,
        -3.6 - Math.sin(angle) * 1.1,
      );
    });
  }, [workerCount]);

  return { queuePositions, workerPositions };
}

/* ── Camera focus rig ─────────────────────────────────────────────────────── */

function CameraRig({
  controls,
  focus,
}: {
  controls: React.MutableRefObject<React.ElementRef<typeof OrbitControls> | null>;
  focus: THREE.Vector3 | null;
}) {
  const { camera } = useThree();
  const desiredTarget = useRef(new THREE.Vector3(0, 0.9, 0));
  const desiredPos = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (focus) {
      desiredTarget.current.set(focus.x, 1.1, focus.z);
      desiredPos.current = new THREE.Vector3(focus.x + 3.4, 3.1, focus.z + 6.2);
    } else {
      desiredTarget.current.set(0, 0.9, 0);
      desiredPos.current = null;
    }
  }, [focus]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const k = 1 - Math.pow(0.0025, delta);
    c.target.lerp(desiredTarget.current, k);
    if (desiredPos.current) camera.position.lerp(desiredPos.current, k * 0.8);
    c.update();
  });

  return null;
}

/* ── Scene contents ───────────────────────────────────────────────────────── */

function SceneContents({
  data,
  controls,
  focus,
  setFocus,
}: {
  data: SceneData;
  controls: React.MutableRefObject<React.ElementRef<typeof OrbitControls> | null>;
  focus: THREE.Vector3 | null;
  setFocus: (v: THREE.Vector3 | null) => void;
}) {
  const { queuePositions, workerPositions } = useLayout(data.queues.length, data.workers.length);

  const maxDepth = useMemo(
    () => Math.max(1, ...data.queues.map((q) => q.depth)),
    [data.queues],
  );

  return (
    <>
      <color attach="background" args={["#070809"]} />
      <fog attach="fog" args={["#070809", 12, 30]} />

      <hemisphereLight intensity={0.25} groundColor="#000000" color="#ffd8a8" />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.1}
        color="#ffe8c4"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-6, 4, -6]} intensity={30} color="#22d3ee" distance={20} decay={2} />

      {/* Procedural studio IBL (no network HDRI) */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 6, -6]} scale={[12, 6, 1]} color="#ffdba0" />
        <Lightformer form="rect" intensity={1.4} position={[-8, 4, 2]} scale={[6, 8, 1]} color="#8fd3ff" />
        <Lightformer form="rect" intensity={1.2} position={[8, 4, 2]} scale={[6, 8, 1]} color="#ffb267" />
        <Lightformer form="ring" intensity={1.6} position={[0, 8, 4]} scale={4} color="#ffffff" />
      </Environment>

      {/* Glossy reflective studio floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <MeshReflectorMaterial
          resolution={512}
          blur={[300, 90]}
          mixBlur={1}
          mixStrength={38}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#0a0c10"
          metalness={0.75}
          roughness={0.55}
        />
      </mesh>

      <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={30} blur={2.4} far={8} resolution={512} />

      {/* Queues */}
      {data.queues.map((q, i) => (
        <QueuePillar
          key={q.id}
          queue={q}
          position={[queuePositions[i]!.x, 0, queuePositions[i]!.z]}
          maxDepth={maxDepth}
          selected={focus !== null && Math.abs(focus.x - queuePositions[i]!.x) < 0.01}
          onSelect={(_, pos) => setFocus(pos)}
        />
      ))}

      {/* Workers */}
      {data.workers.map((w, i) => (
        <WorkerNode key={w.id} worker={w} position={[workerPositions[i]!.x, workerPositions[i]!.y, workerPositions[i]!.z]} seed={i * 1.7} />
      ))}

      {/* Throughput particles */}
      <ParticleFlow queues={data.queues} queuePositions={queuePositions} workerPositions={workerPositions} />

      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        autoRotate={focus === null}
        autoRotateSpeed={0.45}
        enableDamping
        dampingFactor={0.06}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={6}
        maxDistance={20}
      />
      <CameraRig controls={controls} focus={focus} />

      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={0.55} luminanceSmoothing={0.2} intensity={0.85} radius={0.7} />
        <DepthOfField focusDistance={0.02} focalLength={0.06} bokehScale={2.2} height={480} />
        <Vignette offset={0.28} darkness={0.72} eskil={false} />
        <Noise opacity={0.035} premultiply />
      </EffectComposer>
    </>
  );
}

/* ── Public component ─────────────────────────────────────────────────────── */

export default function ControlRoomScene({ data }: { data: SceneData }) {
  const controls = useRef<React.ElementRef<typeof OrbitControls> | null>(null);
  const [focus, setFocus] = useState<THREE.Vector3 | null>(null);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [8.5, 5.2, 9.5], fov: 42 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      performance={{ min: 0.5 }}
      className="rounded-3xl"
      onPointerMissed={() => setFocus(null)}
    >
      <Suspense fallback={null}>
        <SceneContents data={data} controls={controls} focus={focus} setFocus={setFocus} />
      </Suspense>
    </Canvas>
  );
}
