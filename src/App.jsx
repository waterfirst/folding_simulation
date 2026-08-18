import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Activity,
  Download,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Thermometer,
} from "lucide-react";
import {
  DEFAULT_LAYERS,
  DEFAULT_PARAMS,
  MAX_FOLD_ANGLE,
  PRESETS,
  buildCurve,
  buildHysteresisCurve,
  clamp,
  cloneLayers,
  evaluateFold,
  simulationCsv,
} from "./simulation.js";

const PARAM_CONTROLS = [
  { key: "foldAngle", label: "편측 접힘 각도", unit: "deg", min: 0, max: MAX_FOLD_ANGLE, step: 0.5 },
  { key: "temperature", label: "평가 온도", unit: "degC", min: -20, max: 90, step: 1 },
  { key: "baseHingeR", label: "최소 힌지 반경", unit: "mm", min: 2, max: 10, step: 0.5 },
  { key: "panelWidth", label: "유효 패널 폭", unit: "mm", min: 30, max: 120, step: 1 },
  { key: "cycleCount", label: "누적 사이클", unit: "count", min: 0, max: 200000, step: 1000 },
  { key: "hysteresis", label: "이력 손실 민감도", unit: "percent", min: 5, max: 45, step: 1 },
];

function formatValue(value, unit) {
  if (unit === "deg") return `${Number(value).toFixed(1)}°`;
  if (unit === "degC") return `${Number(value).toFixed(0)} °C`;
  if (unit === "count") return Math.round(value).toLocaleString("ko-KR");
  if (unit === "percent") return `${Number(value).toFixed(0)}%`;
  if (unit === "x") return `${Number(value).toFixed(2)}×`;
  return `${Number(value).toFixed(1)} ${unit}`;
}

function formatRadius(radius) {
  return Number.isFinite(radius) ? radius.toFixed(2) : "∞";
}

function PanelColorLegend() {
  return (
    <div className="legend" aria-label="응력 이용률 컬러 범례">
      <span>Low</span>
      <div className="legendBar" />
      <span>High</span>
    </div>
  );
}

function updatePanelColors(mesh, isLeft, intensity) {
  const { geometry } = mesh;
  const position = geometry.attributes.position;
  const count = position.count;
  if (!geometry.attributes.color) {
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  }

  const colors = geometry.attributes.color.array;
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const x = position.getX(index);
    const distanceFromHinge = isLeft ? Math.abs(x) : x;
    const stressFactor = Math.exp(-distanceFromHinge * 1.65) * intensity;
    if (stressFactor < 0.4) {
      color.setRGB(0.03, 0.22 + stressFactor * 1.25, 0.8 - stressFactor * 1.05);
    } else if (stressFactor < 0.75) {
      const progress = (stressFactor - 0.4) / 0.35;
      color.setRGB(0.08 + progress * 0.88, 0.92 - progress * 0.1, 0.1);
    } else {
      const progress = Math.min(1, (stressFactor - 0.75) / 0.25);
      color.setRGB(1, 0.55 - progress * 0.42, 0.03);
    }
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.attributes.color.needsUpdate = true;
}

function SimulationCanvas({ params, metrics }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080b10);
    scene.fog = new THREE.Fog(0x080b10, 9, 18);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    camera.position.set(0, 4.2, 8.2);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountRef.current.appendChild(renderer.domElement);

    const geometries = new Set();
    const materials = new Set();
    const registerGeometry = (geometry) => {
      geometries.add(geometry);
      return geometry;
    };
    const registerMaterial = (material) => {
      materials.add(material);
      return material;
    };

    scene.add(new THREE.AmbientLight(0xffffff, 0.82));
    const keyLight = new THREE.DirectionalLight(0xf4fbff, 1.85);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x7deeff, 3.8, 14);
    rimLight.position.set(-3.8, 2.3, 2.8);
    scene.add(rimLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.25);
    fillLight.position.set(-4, 5.5, -5);
    scene.add(fillLight);
    const hingeSpot = new THREE.SpotLight(0xffffff, 2.2, 9, Math.PI / 5, 0.45, 1.1);
    hingeSpot.position.set(0, 5.8, 2.2);
    hingeSpot.target.position.set(0, 0, 0);
    scene.add(hingeSpot, hingeSpot.target);

    const floorMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x0d1218, roughness: 0.8, metalness: 0.1 })
    );
    const floor = new THREE.Mesh(registerGeometry(new THREE.PlaneGeometry(14, 10)), floorMaterial);
    floor.position.y = -2.3;
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, 0x1b4656, 0x14232c);
    grid.position.y = -2.28;
    scene.add(grid);
    if (Array.isArray(grid.material)) grid.material.forEach(registerMaterial);
    else registerMaterial(grid.material);
    registerGeometry(grid.geometry);

    const panelMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.12, side: THREE.DoubleSide })
    );
    const rightPanelMaterial = registerMaterial(panelMaterial.clone());
    const overlayMaterial = registerMaterial(
      new THREE.MeshBasicMaterial({ color: 0x77d7ff, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false })
    );
    const rightOverlayMaterial = registerMaterial(overlayMaterial.clone());
    const edgeMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x24323c, roughness: 0.36, metalness: 0.66 })
    );
    const frameMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x384650, roughness: 0.34, metalness: 0.72, emissive: 0x071116 })
    );
    const clampMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x596873, roughness: 0.28, metalness: 0.82 })
    );
    const motorMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x566775, roughness: 0.25, metalness: 0.86 })
    );
    const guideMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x2d3b44, roughness: 0.34, metalness: 0.82 })
    );
    const rodMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0xe1eef2, roughness: 0.14, metalness: 0.92 })
    );
    const loadCellMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x00a5bd, emissive: 0x063b44, roughness: 0.24, metalness: 0.58 })
    );
    const baseMaterial = registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x18232b, roughness: 0.48, metalness: 0.62 })
    );

    const leftPanelGroup = new THREE.Group();
    const rightPanelGroup = new THREE.Group();
    scene.add(leftPanelGroup, rightPanelGroup);
    const panelWidth = 3.2;
    const panelHeight = 4.35;
    const frameRail = 0.075;
    const frameLift = 0.045;

    const leftGeometry = registerGeometry(new THREE.PlaneGeometry(panelWidth, panelHeight, 64, 36));
    leftGeometry.translate(-panelWidth / 2, 0, 0);
    leftGeometry.rotateX(-Math.PI / 2);
    const leftPanel = new THREE.Mesh(leftGeometry, panelMaterial);
    leftPanel.castShadow = true;
    leftPanelGroup.add(leftPanel);
    const leftOverlayGeometry = registerGeometry(leftGeometry.clone());
    const leftOverlay = new THREE.Mesh(leftOverlayGeometry, overlayMaterial);
    leftOverlay.position.y = 0.006;
    leftPanelGroup.add(leftOverlay);

    const rightGeometry = registerGeometry(new THREE.PlaneGeometry(panelWidth, panelHeight, 64, 36));
    rightGeometry.translate(panelWidth / 2, 0, 0);
    rightGeometry.rotateX(-Math.PI / 2);
    const rightPanel = new THREE.Mesh(rightGeometry, rightPanelMaterial);
    rightPanel.castShadow = true;
    rightPanelGroup.add(rightPanel);
    const rightOverlayGeometry = registerGeometry(rightGeometry.clone());
    const rightOverlay = new THREE.Mesh(rightOverlayGeometry, rightOverlayMaterial);
    rightOverlay.position.y = 0.006;
    rightPanelGroup.add(rightOverlay);

    const edgeMeshes = [];
    [[-panelWidth, leftPanelGroup], [panelWidth, rightPanelGroup]].forEach(([x, group]) => {
      const edge = new THREE.Mesh(registerGeometry(new THREE.BoxGeometry(0.035, 0.055, panelHeight)), edgeMaterial);
      edge.position.set(x, 0, 0);
      group.add(edge);
      edgeMeshes.push(edge);
    });

    const panelFixtureMeshes = [];
    const addMesh = (parent, geometry, material, position, rotation = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(registerGeometry(geometry), material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addRail = (group, size, position) => {
      const rail = addMesh(group, new THREE.BoxGeometry(...size), frameMaterial, position);
      panelFixtureMeshes.push(rail);
    };
    const buildPanelJig = (group, side) => {
      const centerX = side === "left" ? -panelWidth / 2 : panelWidth / 2;
      const outerX = side === "left" ? -panelWidth - frameRail / 2 : panelWidth + frameRail / 2;
      addRail(group, [panelWidth + frameRail, frameRail, frameRail], [centerX, frameLift, panelHeight / 2 + frameRail / 2]);
      addRail(group, [panelWidth + frameRail, frameRail, frameRail], [centerX, frameLift, -panelHeight / 2 - frameRail / 2]);
      addRail(group, [frameRail, frameRail, panelHeight + frameRail * 2], [outerX, frameLift, 0]);
    };
    buildPanelJig(leftPanelGroup, "left");
    buildPanelJig(rightPanelGroup, "right");

    addMesh(scene, new THREE.BoxGeometry(9.9, 0.12, 5.9), baseMaterial, [0, -0.62, 0]);
    addMesh(scene, new THREE.BoxGeometry(0.42, 0.18, 0.28), clampMaterial, [0, -0.02, panelHeight * 0.515]);
    addMesh(scene, new THREE.BoxGeometry(0.42, 0.18, 0.28), clampMaterial, [0, -0.02, -panelHeight * 0.515]);
    addMesh(scene, new THREE.CylinderGeometry(0.12, 0.12, 0.62, 32), clampMaterial, [0, -0.08, panelHeight * 0.515], [0, 0, Math.PI / 2]);
    addMesh(scene, new THREE.CylinderGeometry(0.12, 0.12, 0.62, 32), clampMaterial, [0, -0.08, -panelHeight * 0.515], [0, 0, Math.PI / 2]);
    addMesh(scene, new THREE.CylinderGeometry(0.24, 0.24, 0.86, 32), clampMaterial, [0, -0.34, 0], [Math.PI / 2, 0, 0]);
    addMesh(scene, new THREE.BoxGeometry(0.86, 0.2, 0.48), clampMaterial, [0, -0.48, 0]);

    const actuatorAssemblies = [];
    const buildMotorActuator = (side) => {
      const group = new THREE.Group();
      group.position.set(side * 4.9, -0.2, 0);
      scene.add(group);
      addMesh(group, new THREE.BoxGeometry(1.65, 0.18, 5.6), guideMaterial, [0, -0.08, 0]);
      addMesh(group, new THREE.BoxGeometry(1.3, 0.16, 0.18), guideMaterial, [0, 0.08, 1.9]);
      addMesh(group, new THREE.BoxGeometry(1.3, 0.16, 0.18), guideMaterial, [0, 0.08, -1.9]);
      addMesh(group, new THREE.CylinderGeometry(0.33, 0.33, 0.82, 32), motorMaterial, [side * 0.72, 0.12, 0], [0, 0, Math.PI / 2]);
      const carriage = addMesh(group, new THREE.BoxGeometry(0.36, 0.26, 0.72), motorMaterial, [-side * 0.28, 0.16, 0]);
      const rod = addMesh(group, new THREE.CylinderGeometry(0.055, 0.055, 1.45, 24), rodMaterial, [-side * 0.95, 0.17, 0], [0, 0, Math.PI / 2]);
      const loadCell = addMesh(group, new THREE.BoxGeometry(0.18, 0.24, 0.54), loadCellMaterial, [-side * 1.58, 0.17, 0]);
      const pusher = addMesh(group, new THREE.BoxGeometry(0.24, 0.16, 0.9), clampMaterial, [-side * 1.82, 0.11, 0]);
      actuatorAssemblies.push({ side, carriage, rod, loadCell, pusher });
    };
    buildMotorActuator(-1);
    buildMotorActuator(1);

    const markerMaterial = registerMaterial(
      new THREE.MeshBasicMaterial({ color: 0x315869, transparent: true, opacity: 0.7 })
    );
    const marker = new THREE.Mesh(
      registerGeometry(new THREE.TorusGeometry(1.25, 0.01, 8, 72, Math.PI)),
      markerMaterial
    );
    marker.rotation.z = Math.PI / 2;
    marker.position.y = -1.9;
    scene.add(marker);

    sceneRef.current = {
      camera,
      renderer,
      scene,
      leftPanel,
      rightPanel,
      leftPanelGroup,
      rightPanelGroup,
      edgeMeshes,
      panelFixtureMeshes,
      actuatorAssemblies,
      marker,
      geometries,
      materials,
    };

    const resize = () => {
      if (!mountRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const viewState = {
      dragging: false,
      lastX: 0,
      lastY: 0,
      targetX: 0.18,
      targetY: 0,
      panX: 0,
      panY: 0,
      distance: camera.position.length(),
      mode: "rotate",
    };
    const updateCameraDistance = () => {
      camera.position.set(0, viewState.distance * 0.456, viewState.distance * 0.89);
      camera.lookAt(0, 0, 0);
    };
    const handlePointerDown = (event) => {
      viewState.dragging = true;
      viewState.lastX = event.clientX;
      viewState.lastY = event.clientY;
      viewState.mode = event.button === 1 || event.button === 2 ? "pan" : "rotate";
      renderer.domElement.setPointerCapture?.(event.pointerId);
      renderer.domElement.classList.add("isDragging");
    };
    const handlePointerMove = (event) => {
      if (!viewState.dragging) return;
      const deltaX = event.clientX - viewState.lastX;
      const deltaY = event.clientY - viewState.lastY;
      viewState.lastX = event.clientX;
      viewState.lastY = event.clientY;
      if (viewState.mode === "pan") {
        viewState.panX += deltaX * 0.008;
        viewState.panY -= deltaY * 0.008;
      } else {
        viewState.targetY += deltaX * 0.008;
        viewState.targetX = clamp(viewState.targetX + deltaY * 0.006, -0.45, 0.85);
      }
    };
    const handlePointerUp = (event) => {
      viewState.dragging = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      renderer.domElement.classList.remove("isDragging");
    };
    const handleWheel = (event) => {
      event.preventDefault();
      viewState.distance = clamp(viewState.distance + event.deltaY * 0.008, 4.5, 14);
      updateCameraDistance();
    };
    const preventContextMenu = (event) => event.preventDefault();

    renderer.domElement.classList.add("interactiveCanvas");
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", preventContextMenu);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      scene.rotation.x += (viewState.targetX - scene.rotation.x) * 0.16;
      scene.rotation.y += (viewState.targetY - scene.rotation.y) * 0.16;
      scene.position.x += (viewState.panX - scene.position.x) * 0.16;
      scene.position.y += (viewState.panY - scene.position.y) * 0.16;
      renderer.render(scene, camera);
    };

    resize();
    window.addEventListener("resize", resize);
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      renderer.domElement.removeEventListener("contextmenu", preventContextMenu);
      cancelAnimationFrame(frameRef.current);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    const direction = params.flipFold ? -1 : 1;
    const radians = THREE.MathUtils.degToRad(params.foldAngle) * direction;
    sceneRef.current.leftPanelGroup.rotation.z = -radians;
    sceneRef.current.rightPanelGroup.rotation.z = radians;
    const visualThickness = clamp(metrics.stackThickness / 180, 0.28, 2.2);
    sceneRef.current.edgeMeshes.forEach((edge) => {
      edge.scale.y = visualThickness;
    });
    sceneRef.current.panelFixtureMeshes.forEach((mesh) => {
      mesh.scale.y = visualThickness;
    });
    sceneRef.current.marker.scale.setScalar(clamp(params.baseHingeR / 5, 0.55, 1.7));
    const strokeRatio = clamp(metrics.actuatorStroke / 42, 0, 1);
    sceneRef.current.actuatorAssemblies.forEach(({ side, carriage, rod, loadCell, pusher }) => {
      const travel = strokeRatio * 0.72;
      carriage.position.x = -side * (0.28 + travel);
      rod.position.x = -side * (0.95 + travel * 0.72);
      rod.scale.y = 1 + strokeRatio * 0.28;
      loadCell.position.x = -side * (1.58 + travel * 0.42);
      pusher.position.x = -side * (1.82 + travel * 0.32);
      loadCell.material.emissiveIntensity = 0.35 + metrics.stressIntensity * 1.4;
    });
    updatePanelColors(sceneRef.current.leftPanel, true, metrics.stressIntensity);
    updatePanelColors(sceneRef.current.rightPanel, false, metrics.stressIntensity);
  }, [params, metrics]);

  return (
    <div className="canvasWrap">
      <div ref={mountRef} className="canvasMount" />
      <div className="canvasOverlay">
        <div>
          <strong>Motorized Folding Test Set</strong>
          <span>좌클릭 회전 · 중간/우클릭 이동 · 휠 확대</span>
        </div>
        <PanelColorLegend />
      </div>
    </div>
  );
}

function SliderControl({ control, value, onChange }) {
  const percentage = ((value - control.min) / (control.max - control.min)) * 100;
  return (
    <label className="sliderControl">
      <span className="sliderHeader">
        <span>{control.label}</span>
        <strong>{formatValue(value, control.unit)}</strong>
      </span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(event) => onChange(control.key, Number(event.target.value))}
        style={{ "--fill": `${percentage}%` }}
      />
    </label>
  );
}

function LayerEditor({ layers, onLayerChange, onAddLayer, onRemoveLayer }) {
  return (
    <div className="layerEditor">
      <div className="sectionHeader">
        <span>Layer stack</span>
        <button type="button" onClick={onAddLayer} disabled={layers.length >= 10}>+ Layer</button>
      </div>
      <div className="layerTable">
        <div className="layerHead">
          <span>Layer</span><span>두께 µm</span><span>E25 GPa</span><span>허용 ε %</span><span />
        </div>
        {layers.slice(0, 10).map((layer, index) => (
          <div className="layerRow" key={layer.id}>
            <input value={layer.name} aria-label={`${layer.name} 이름`} onChange={(event) => onLayerChange(index, { name: event.target.value })} />
            <input type="number" min="1" max="300" step="1" value={layer.thickness} aria-label={`${layer.name} 두께`} onChange={(event) => onLayerChange(index, { thickness: Number(event.target.value) })} />
            <input type="number" min="0.0001" max="100" step="0.001" value={layer.modulus} aria-label={`${layer.name} 모듈러스`} onChange={(event) => onLayerChange(index, { modulus: Number(event.target.value) })} />
            <input type="number" min="0.01" max="200" step="0.01" value={Number((layer.allowableStrain * 100).toFixed(3))} aria-label={`${layer.name} 허용 변형률`} onChange={(event) => onLayerChange(index, { allowableStrain: Number(event.target.value) / 100 })} />
            <button type="button" onClick={() => onRemoveLayer(index)} aria-label={`${layer.name} 삭제`}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ControlsPanel({ params, selectedPreset, isRunning, saveCount, onParamChange, onPreset, onReset, onToggleRun, onSaveScenario }) {
  return (
    <aside className="panel controlsPanel">
      <div className="panelTitle">
        <SlidersHorizontal size={18} />
        <div><h1>Folding Simulation</h1><p>패널 적층의 접힘 한계와 구동 하중을 빠르게 비교합니다.</p></div>
      </div>
      <div className="buttonRow">
        <button type="button" className="primaryButton" onClick={onToggleRun}>
          {isRunning ? <Pause size={16} /> : <Play size={16} />}{isRunning ? "일시정지" : "사이클 구동"}
        </button>
        <button type="button" className="iconButton" onClick={onReset} aria-label="초기화"><RotateCcw size={17} /></button>
        <button type="button" className="iconButton" onClick={onSaveScenario} disabled={saveCount >= 5} aria-label="현재 조건 저장" title={`현재 조건 저장 (${saveCount}/5)`}><Save size={17} /></button>
      </div>
      <button type="button" className={params.flipFold ? "toggleButton active" : "toggleButton"} onClick={() => onParamChange("flipFold", !params.flipFold)}>접힘 방향 반전</button>
      <div className="presetGrid">
        {PRESETS.map((preset) => (
          <button type="button" key={preset.name} className={selectedPreset === preset.name ? "preset active" : "preset"} onClick={() => onPreset(preset)}>
            <strong>{preset.name}</strong><span>{preset.description}</span>
          </button>
        ))}
      </div>
      <div className="controlStack">
        {PARAM_CONTROLS.map((control) => <SliderControl key={control.key} control={control} value={params[control.key]} onChange={onParamChange} />)}
        <SliderControl control={{ key: "cycleSpeed", label: "사이클 속도", unit: "x", min: 0.2, max: 2.2, step: 0.05 }} value={params.cycleSpeed} onChange={onParamChange} />
      </div>
    </aside>
  );
}

function ParameterDock({ layers, metrics, collapsed, onToggleCollapsed, onLayerChange, onAddLayer, onRemoveLayer }) {
  return (
    <section className={collapsed ? "parameterDock collapsed" : "parameterDock"}>
      <div className="dockSummary">
        <strong>Layer Parameters</strong>
        <span>총 두께 <b>{metrics.stackThickness.toFixed(0)} µm</b></span>
        <span>등가 E <b>{metrics.effectiveModulus.toFixed(2)} GPa</b></span>
        <span>중립축 <b>{metrics.neutralAxis.toFixed(1)} µm</b></span>
        <button type="button" className="dockToggle" onClick={onToggleCollapsed}>{collapsed ? "다시 펼치기" : "접기"}</button>
      </div>
      {!collapsed && <LayerEditor layers={layers} onLayerChange={onLayerChange} onAddLayer={onAddLayer} onRemoveLayer={onRemoveLayer} />}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, unit, tone }) {
  return (
    <div className={`metricCard ${tone || ""}`}>
      <Icon size={17} /><span>{label}</span><strong>{value}<small>{unit}</small></strong>
    </div>
  );
}

function Sparkline({ data, activeAngle }) {
  const maxStress = Math.max(1, ...data.map((point) => point.stress));
  const path = data.map((point, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 84 - clamp(point.stress / maxStress, 0, 1) * 72;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const markerX = clamp(activeAngle / MAX_FOLD_ANGLE, 0, 1) * 100;
  return (
    <svg className="sparkline" viewBox="0 0 100 92" role="img" aria-label="접힘 각도별 응력 곡선">
      <path d="M 0 84 L 100 84" className="axis" /><path d={path} className="curve" /><line x1={markerX} x2={markerX} y1="10" y2="86" className="marker" />
    </svg>
  );
}

function StressStrainChart({ params, layers, activePhase }) {
  const points = useMemo(() => buildHysteresisCurve(params, layers), [params, layers]);
  const maxStrain = Math.max(0.001, Math.max(...points.map((point) => point.strain)) * 1.12);
  const maxStress = Math.max(1, Math.max(...points.map((point) => point.stress)) * 1.12);
  const activePoints = points.filter((point) => point.phase === activePhase);
  const phaseProgress = activePhase === "load" ? clamp(params.foldAngle / MAX_FOLD_ANGLE, 0, 1) : 1 - clamp(params.foldAngle / MAX_FOLD_ANGLE, 0, 1);
  const currentPoint = activePoints[Math.round(phaseProgress * (activePoints.length - 1))] ?? activePoints[0];
  const pathFor = (phase) => points.filter((point) => point.phase === phase).map((point, index) => {
    const x = 12 + (point.strain / maxStrain) * 78;
    const y = 82 - (point.stress / maxStress) * 66;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const currentX = 12 + (currentPoint.strain / maxStrain) * 78;
  const currentY = 82 - (currentPoint.stress / maxStress) * 66;
  return (
    <svg className="hysteresisChart" viewBox="0 0 100 100" role="img" aria-label="Stress strain hysteresis curve">
      <path className="chartGrid" d="M 12 16 H 90 M 12 38 H 90 M 12 60 H 90 M 12 82 H 90 M 12 16 V 82 M 38 16 V 82 M 64 16 V 82 M 90 16 V 82" />
      <path className="chartAxis" d="M 12 16 V 82 H 90" /><path className="loadCurve" d={pathFor("load")} /><path className="unloadCurve" d={pathFor("unload")} />
      <circle className={`curvePoint ${activePhase}`} cx={clamp(currentX, 12, 90)} cy={clamp(currentY, 16, 82)} r="2.6" />
      <text x="51" y="96" textAnchor="middle">Strain</text><text x="5" y="49" textAnchor="middle" transform="rotate(-90 5 49)">Stress</text>
    </svg>
  );
}

function MetricsPanel({ metrics, params, layers, scenarios, curvePhase, onDownloadCsv, onLoadScenario }) {
  const curve = useMemo(() => buildCurve(params, layers), [params, layers]);
  const topLayers = [...metrics.layerResults].sort((a, b) => b.utilization - a.utilization).slice(0, 3);
  return (
    <aside className="panel metricsPanel">
      <div className="panelTitle compact"><Activity size={18} /><div><h2>Mechanical Evaluation</h2><p>적층 보 이론 기반 실시간 추정</p></div></div>
      <div className={`riskBanner ${metrics.risk.toLowerCase()}`}><div><span>Risk Status</span><small>Critical: {metrics.criticalLayer}</small></div><strong>{metrics.risk}</strong></div>
      <div className="metricsGrid">
        <MetricCard icon={Gauge} label="총 접힘각" value={metrics.totalAngle.toFixed(1)} unit="deg" />
        <MetricCard icon={Gauge} label="현재 곡률 반경" value={formatRadius(metrics.radius)} unit="mm" />
        <MetricCard icon={Activity} label="계산 구동 힘" value={metrics.force.toFixed(3)} unit="N" tone="force" />
        <MetricCard icon={Thermometer} label="최대 Layer 응력" value={metrics.stress.toFixed(2)} unit="MPa" tone="stress" />
        <MetricCard icon={Activity} label="Folding Load" value={metrics.foldingLoad.toFixed(3)} unit="N" tone="force" />
        <MetricCard icon={Activity} label="Unfolding Load" value={metrics.unfoldingLoad.toFixed(3)} unit="N" tone="force" />
      </div>
      <div className="derivedGrid">
        <div><span>Max Layer Strain</span><strong>{(metrics.strain * 100).toFixed(3)}%</strong></div>
        <div><span>Critical Utilization</span><strong>{(metrics.criticalUtilization * 100).toFixed(1)}%</strong></div>
        <div><span>Bending Rigidity</span><strong>{metrics.bendingRigidity.toFixed(3)} N·mm²/mm</strong></div>
        <div><span>Motor Stroke</span><strong>{metrics.actuatorStroke.toFixed(1)} mm</strong></div>
        <div><span>Loop Loss</span><strong>{metrics.loopLoss.toFixed(3)}</strong></div>
        <div><span>Fatigue Damage</span><strong>{(metrics.fatigueShift * 100).toFixed(1)}%</strong></div>
      </div>
      <div className="gaugeBlock">
        <div className="gaugeHeader"><span>Critical Layer Utilization</span><strong>{metrics.criticalLayer}</strong></div>
        <div className="gaugeTrack"><span style={{ width: `${clamp(metrics.criticalUtilization, 0, 1) * 100}%` }} /></div>
        <div className="gaugeFooter"><span>Safety margin</span><b>{metrics.safetyMargin.toFixed(1)}%</b></div>
      </div>
      <div className="layerRiskTable">
        {topLayers.map((layer) => <div key={layer.id}><span>{layer.name}</span><b>{(layer.maxAbsStrain * 100).toFixed(3)}%</b><em>{(layer.utilization * 100).toFixed(0)}%</em></div>)}
      </div>
      <div className="chartBlock"><div className="sectionHeader"><span>Stress sweep</span><b>0-{MAX_FOLD_ANGLE}°</b></div><Sparkline data={curve} activeAngle={params.foldAngle} /></div>
      <div className="chartBlock">
        <div className="sectionHeader"><span>Stress-Strain Hysteresis</span><b>{curvePhase === "load" ? "Loading" : "Unloading"}</b></div>
        <StressStrainChart params={params} layers={layers} activePhase={curvePhase} />
        <div className="curveLegend"><span><i className="loadDot" />Loading</span><span><i className="unloadDot" />Unloading</span></div>
      </div>
      <button type="button" className="downloadButton" onClick={onDownloadCsv}><Download size={16} />CSV 다운로드</button>
      <div className="scenarioTable">
        <div className="sectionHeader"><span>Scenario memory</span><b>{scenarios.length} cases</b></div>
        {scenarios.map((scenario) => (
          <button type="button" className="scenarioRow" key={scenario.id} onClick={() => onLoadScenario(scenario)} title="이 조건 불러오기">
            <span>{scenario.name}</span><b>{scenario.metrics.criticalLayer}</b><em>{scenario.metrics.risk}</em>
          </button>
        ))}
      </div>
    </aside>
  );
}

function BottomRail({ params, metrics }) {
  return (
    <footer className="bottomRail">
      <span>single={params.foldAngle.toFixed(1)}°</span><span>stack={metrics.stackThickness.toFixed(0)} µm</span><span>effE={metrics.effectiveModulus.toFixed(2)} GPa</span><span>Rmin={params.baseHingeR.toFixed(1)} mm</span><strong>{metrics.risk} / {metrics.criticalLayer} {(metrics.criticalUtilization * 100).toFixed(0)}%</strong>
    </footer>
  );
}

function presetScenario(preset, index) {
  const params = { ...DEFAULT_PARAMS, ...preset.params };
  const layers = cloneLayers(preset.layers ?? DEFAULT_LAYERS);
  return { id: `preset-${index}`, name: preset.name, params, layers, metrics: evaluateFold(params, layers), userSaved: false };
}

export default function App() {
  const [params, setParams] = useState(() => ({ ...DEFAULT_PARAMS }));
  const [layers, setLayers] = useState(() => cloneLayers(DEFAULT_LAYERS));
  const [selectedPreset, setSelectedPreset] = useState("Custom");
  const [isRunning, setIsRunning] = useState(false);
  const [curvePhase, setCurvePhase] = useState("load");
  const [layerDockCollapsed, setLayerDockCollapsed] = useState(false);
  const previousFoldAngleRef = useRef(DEFAULT_PARAMS.foldAngle);
  const [scenarios, setScenarios] = useState(() => PRESETS.slice(0, 3).map(presetScenario));
  const metrics = useMemo(() => evaluateFold(params, layers), [params, layers]);
  const saveCount = scenarios.filter((scenario) => scenario.userSaved).length;

  useEffect(() => {
    const previous = previousFoldAngleRef.current;
    if (params.foldAngle > previous) setCurvePhase("load");
    if (params.foldAngle < previous) setCurvePhase("unload");
    previousFoldAngleRef.current = params.foldAngle;
  }, [params.foldAngle]);

  useEffect(() => {
    if (!isRunning) return undefined;
    let frameId = 0;
    const started = performance.now();
    const baseCycleCount = params.cycleCount;
    const tick = (now) => {
      const phase = ((now - started) / 1000) * params.cycleSpeed;
      const foldAngle = ((1 - Math.cos(phase)) / 2) * MAX_FOLD_ANGLE;
      const completedCycles = Math.floor(phase / (Math.PI * 2));
      setParams((previous) => ({
        ...previous,
        foldAngle: Number(foldAngle.toFixed(1)),
        cycleCount: Math.min(200000, baseCycleCount + completedCycles),
      }));
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isRunning, params.cycleSpeed]);

  const handleParamChange = (key, value) => {
    setSelectedPreset("Custom");
    setParams((previous) => ({ ...previous, [key]: value }));
  };
  const handleLayerChange = (index, patch) => {
    setSelectedPreset("Custom");
    setLayers((previous) => previous.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } : layer));
  };
  const handleAddLayer = () => {
    setSelectedPreset("Custom");
    setLayers((previous) => previous.length >= 10 ? previous : [...previous, {
      id: `layer-${Date.now()}`,
      name: `Layer ${previous.length + 1}`,
      thickness: 20,
      modulus: 2,
      allowableStrain: 0.03,
      tempCoeff: 0.004,
      enabled: true,
    }]);
  };
  const handleRemoveLayer = (index) => {
    setSelectedPreset("Custom");
    setLayers((previous) => previous.length <= 1 ? previous : previous.filter((_, layerIndex) => layerIndex !== index));
  };
  const handlePreset = (preset) => {
    setIsRunning(false);
    setSelectedPreset(preset.name);
    setParams({ ...DEFAULT_PARAMS, ...preset.params });
    setLayers(cloneLayers(preset.layers ?? DEFAULT_LAYERS));
  };
  const handleReset = () => {
    setIsRunning(false);
    setSelectedPreset("Custom");
    setParams({ ...DEFAULT_PARAMS });
    setLayers(cloneLayers(DEFAULT_LAYERS));
  };
  const handleSaveScenario = () => {
    if (saveCount >= 5) return;
    const stamp = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setScenarios((previous) => [{
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${params.foldAngle}`,
      name: `Saved ${stamp}`,
      params: { ...params },
      layers: cloneLayers(layers),
      metrics: { ...metrics, layerResults: metrics.layerResults.map((layer) => ({ ...layer })) },
      userSaved: true,
    }, ...previous].slice(0, 8));
  };
  const handleLoadScenario = (scenario) => {
    setIsRunning(false);
    setSelectedPreset(scenario.name.startsWith("Saved") ? "Custom" : scenario.name);
    setParams({ ...scenario.params });
    setLayers(cloneLayers(scenario.layers));
  };
  const handleDownloadCsv = () => {
    const csv = simulationCsv(params, metrics, layers);
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `folding_simulation_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="appShell">
      <ControlsPanel params={params} selectedPreset={selectedPreset} isRunning={isRunning} saveCount={saveCount} onParamChange={handleParamChange} onPreset={handlePreset} onReset={handleReset} onToggleRun={() => setIsRunning((value) => !value)} onSaveScenario={handleSaveScenario} />
      <SimulationCanvas params={params} metrics={metrics} />
      <ParameterDock layers={layers} metrics={metrics} collapsed={layerDockCollapsed} onToggleCollapsed={() => setLayerDockCollapsed((value) => !value)} onLayerChange={handleLayerChange} onAddLayer={handleAddLayer} onRemoveLayer={handleRemoveLayer} />
      <MetricsPanel metrics={metrics} params={params} layers={layers} scenarios={scenarios} curvePhase={curvePhase} onDownloadCsv={handleDownloadCsv} onLoadScenario={handleLoadScenario} />
      <BottomRail params={params} metrics={metrics} />
      <div className="creatorCredit">제작자: 개발품질그룹 최낙초 프로 · Analytical model v2.0</div>
    </main>
  );
}
