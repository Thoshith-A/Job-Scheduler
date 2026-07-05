"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";
import type { SceneWorker } from "./scene-data";
import { WORKER_STATUS_HEX } from "@/lib/status";

export function WorkerNode({
  worker,
  position,
  seed,
}: {
  worker: SceneWorker;
  position: [number, number, number];
  seed: number;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const color = useMemo(() => new THREE.Color(WORKER_STATUS_HEX[worker.status]), [worker.status]);
  const load = worker.concurrency > 0 ? Math.min(worker.inFlight / worker.concurrency, 1) : 0;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Heartbeat pulse — faster when busier; dimmed when not alive.
    const beat = worker.alive ? 0.5 + Math.abs(Math.sin(t * (1.4 + load * 1.6) + seed)) * 0.5 : 0.12;
    if (coreRef.current) {
      const s = 0.9 + beat * 0.25;
      coreRef.current.scale.setScalar(s);
    }
    if (matRef.current) {
      matRef.current.emissiveIntensity = worker.alive ? 0.8 + beat * 1.4 : 0.15;
    }
    if (haloRef.current) {
      const hs = 1.4 + beat * 0.7;
      haloRef.current.scale.setScalar(hs);
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = worker.alive ? 0.12 + beat * 0.14 : 0.04;
    }
  });

  return (
    <group position={position}>
      <Float speed={worker.alive ? 1.5 : 0} floatIntensity={worker.alive ? 0.6 : 0} rotationIntensity={0.2}>
        {/* Halo */}
        <mesh ref={haloRef}>
          <sphereGeometry args={[0.32, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} depthWrite={false} />
        </mesh>
        {/* Core */}
        <mesh ref={coreRef} castShadow>
          <sphereGeometry args={[0.24, 32, 32]} />
          <meshStandardMaterial
            ref={matRef}
            color={color}
            emissive={color}
            emissiveIntensity={1}
            metalness={0.4}
            roughness={0.3}
            transparent
            opacity={worker.alive ? 1 : 0.35}
          />
        </mesh>
      </Float>
    </group>
  );
}
