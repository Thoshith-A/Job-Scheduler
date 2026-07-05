"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneQueue } from "./scene-data";

const MAX_PARTICLES = 400;

interface Particle {
  curve: THREE.QuadraticBezierCurve3;
  t: number;
  speed: number;
  color: THREE.Color;
}

/**
 * Instanced job-throughput particles flowing from queues toward the worker fleet.
 * Count is capped and scaled by real running/throughput so the density *is* the load.
 */
export function ParticleFlow({
  queues,
  queuePositions,
  workerPositions,
}: {
  queues: SceneQueue[];
  queuePositions: THREE.Vector3[];
  workerPositions: THREE.Vector3[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo<Particle[]>(() => {
    if (queues.length === 0) return [];
    const hub = new THREE.Vector3(0, 3.2, -3.5);
    const targets = workerPositions.length > 0 ? workerPositions : [hub];

    // Weight each queue by its live activity.
    const weights = queues.map((q) => q.running * 2 + q.throughputPerMin + 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const desired = Math.min(
      MAX_PARTICLES,
      Math.round(queues.reduce((a, q) => a + q.running * 3 + q.throughputPerMin, 0)) + queues.length * 3,
    );

    const out: Particle[] = [];
    queues.forEach((q, qi) => {
      const start = queuePositions[qi];
      if (!start) return;
      const n = Math.max(2, Math.round((weights[qi]! / totalWeight) * desired));
      const color = new THREE.Color(q.healthHex);
      for (let i = 0; i < n && out.length < MAX_PARTICLES; i++) {
        const target = targets[(qi + i) % targets.length]!;
        const from = new THREE.Vector3(start.x, 0.7, start.z);
        const mid = new THREE.Vector3(
          (from.x + target.x) / 2,
          2.6 + Math.random() * 1.4,
          (from.z + target.z) / 2,
        );
        out.push({
          curve: new THREE.QuadraticBezierCurve3(from, mid, target.clone()),
          t: Math.random(),
          speed: 0.18 + Math.random() * 0.22,
          color,
        });
      }
    });
    return out;
    // Rebuild only when topology changes (queue set / worker count) — not on every
    // stats poll — so the streams stay smooth. Health/throughput are snapshotted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queues.map((q) => q.id).join(","), workerPositions.length, queuePositions]);

  const count = particles.length;

  // Assign per-instance colors once the mesh exists.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    for (let i = 0; i < count; i++) mesh.setColorAt(i, particles[i]!.color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [particles, count]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < count; i++) {
      const p = particles[i]!;
      p.t += p.speed * dt;
      if (p.t > 1) p.t -= 1;
      const pos = p.curve.getPoint(p.t);
      dummy.position.copy(pos);
      const s = 0.045 + Math.sin(p.t * Math.PI) * 0.03;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      key={count}
      args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial
        emissive="#ffffff"
        emissiveIntensity={2.4}
        toneMapped={false}
        transparent
        opacity={0.9}
      />
    </instancedMesh>
  );
}
