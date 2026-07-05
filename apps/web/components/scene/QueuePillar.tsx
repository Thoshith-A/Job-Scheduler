"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html, Float } from "@react-three/drei";
import * as THREE from "three";
import type { SceneQueue } from "./scene-data";

const PILLAR_W = 0.9;
const MIN_H = 0.4;
const MAX_H = 5;

export function QueuePillar({
  queue,
  position,
  maxDepth,
  selected,
  onSelect,
}: {
  queue: SceneQueue;
  position: [number, number, number];
  maxDepth: number;
  selected: boolean;
  onSelect: (id: string, pos: THREE.Vector3) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelGroup = useRef<THREE.Group>(null);
  const color = useMemo(() => new THREE.Color(queue.healthHex), [queue.healthHex]);
  const hovered = useRef(false);

  const targetH = useMemo(() => {
    const norm = maxDepth > 0 ? queue.depth / maxDepth : 0;
    return MIN_H + Math.min(norm, 1) * (MAX_H - MIN_H);
  }, [queue.depth, maxDepth]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Smoothly grow/shrink; anchor the base to the floor (y = 0).
    const k = 1 - Math.pow(0.001, delta);
    const nextScale = THREE.MathUtils.lerp(mesh.scale.y, targetH, k);
    mesh.scale.y = nextScale;
    mesh.position.y = nextScale * 0.5;

    if (labelGroup.current) labelGroup.current.position.y = nextScale + 0.5;

    if (matRef.current) {
      const pulse = 0.55 + Math.sin(state.clock.elapsedTime * 2 + position[0]) * 0.15;
      const boost = hovered.current || selected ? 1.6 : 1;
      matRef.current.emissiveIntensity = pulse * boost;
      matRef.current.color.lerp(color, k);
      matRef.current.emissive.lerp(color, k);
    }
  });

  return (
    <group position={position}>
      {/* Base glow ring on the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[PILLAR_W * 0.7, PILLAR_W * 0.95, 48]} />
        <meshBasicMaterial color={queue.healthHex} transparent opacity={selected ? 0.7 : 0.35} />
      </mesh>

      <RoundedBox
        ref={meshRef}
        args={[PILLAR_W, 1, PILLAR_W]}
        radius={0.08}
        smoothness={4}
        scale={[1, MIN_H, 1]}
        position={[0, MIN_H * 0.5, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(queue.id, new THREE.Vector3(position[0], 0, position[2]));
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          hovered.current = true;
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          hovered.current = false;
          document.body.style.cursor = "auto";
        }}
        castShadow
      >
        <meshStandardMaterial
          ref={matRef}
          color={queue.healthHex}
          emissive={queue.healthHex}
          emissiveIntensity={0.7}
          metalness={0.6}
          roughness={0.25}
        />
      </RoundedBox>

      {/* Floating label */}
      <group ref={labelGroup} position={[0, MIN_H + 0.5, 0]}>
        <Float speed={2} rotationIntensity={0} floatIntensity={0.4}>
          <Html center distanceFactor={9} occlude={false} zIndexRange={[20, 0]}>
            <div className="pointer-events-none select-none whitespace-nowrap text-center">
              <div className="font-mono text-[13px] font-semibold text-white drop-shadow">
                {queue.depth}
              </div>
              <div className="max-w-[7rem] truncate text-[10px] uppercase tracking-wide text-white/70">
                {queue.name}
              </div>
            </div>
          </Html>
        </Float>
      </group>
    </group>
  );
}
