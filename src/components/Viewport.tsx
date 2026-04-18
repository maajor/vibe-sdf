'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildFragmentShader, vertexShader } from '@/lib/shader';
import { transpile } from '@/lib/transpiler';

interface ViewportProps {
  code: string;
  onError: (error: string | null) => void;
}

export default function Viewport({ code, onError }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animIdRef = useRef<number>(0);
  const lastGoodCode = useRef<string>('');

  const compileShader = useCallback((jsCode: string) => {
    if (!jsCode.trim()) {
      onError(null);
      return;
    }

    const result = transpile(jsCode);

    if (result.error) {
      onError(result.error);
      return;
    }

    if (!materialRef.current) return;

    const fragmentShader = buildFragmentShader(result.glslMapFunction, result.materialColorTable);

    // Test compile by creating a new material
    try {
      const testMat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uResolution: { value: new THREE.Vector2(800, 600) },
          uTime: { value: 0 },
          uCameraPos: { value: new THREE.Vector3(0, 2, 5) },
        },
      });

      // Force compile
      testMat.onBeforeCompile = () => {};
      const testMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), testMat);

      // Use renderer to compile and check for errors
      if (rendererRef.current) {
        const gl = rendererRef.current.getContext();
        const testScene = new THREE.Scene();
        testScene.add(testMesh);
        rendererRef.current.compile(testScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10));

        // Check for shader compilation errors
        const program = (testMat as any).program;
        if (program) {
          const fragShader = program.fragmentShader;
          const diagnostics = gl.getShaderInfoLog(fragShader);
          if (diagnostics && diagnostics.includes('ERROR')) {
            onError(`GLSL Error:\n${diagnostics}`);
            testMat.dispose();
            testMesh.geometry.dispose();
            return;
          }
        }
        testMat.dispose();
        testMesh.geometry.dispose();
      }

      // Apply to actual material
      materialRef.current.fragmentShader = fragmentShader;
      materialRef.current.needsUpdate = true;
      lastGoodCode.current = jsCode;
      onError(null);
    } catch (e: any) {
      onError(`Shader error: ${e.message}`);
    }
  }, [onError]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera (used only for OrbitControls; actual rendering is fullscreen quad)
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(3, 2.5, 4);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Fullscreen quad
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: buildFragmentShader(
        `vec2 map(vec3 p) { return vec2(length(p) - 1.0, 0.0); }\n`,
        '  return vec3(0.8, 0.5, 0.3);\n'
      ),
      uniforms: {
        uResolution: { value: new THREE.Vector2(width * renderer.getPixelRatio(), height * renderer.getPixelRatio()) },
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3(3, 2.5, 4) },
      },
      depthTest: false,
      depthWrite: false,
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.minDistance = 1;
    controls.maxDistance = 20;
    controlsRef.current = controls;

    // Animation loop
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();

      // Update camera position uniform
      material.uniforms.uCameraPos.value.copy(camera.position);
      material.uniforms.uResolution.value.set(
        container.clientWidth * renderer.getPixelRatio(),
        container.clientHeight * renderer.getPixelRatio()
      );

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animIdRef.current);
      ro.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Compile when code changes
  useEffect(() => {
    compileShader(code);
  }, [code, compileShader]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#0d0d12]" />
  );
}
