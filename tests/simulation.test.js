import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAYERS,
  DEFAULT_PARAMS,
  PRESETS,
  cloneLayers,
  evaluateFold,
  layerSummary,
  simulationCsv,
} from "../src/simulation.js";

test("default stack geometry and equivalent properties are finite", () => {
  const summary = layerSummary(DEFAULT_LAYERS, 25);
  assert.equal(summary.totalThickness, 200);
  assert.ok(summary.neutralAxis > 0 && summary.neutralAxis < summary.totalThickness);
  assert.ok(summary.effectiveModulus > 0);
  assert.ok(summary.bendingRigidityPerWidth > 0);
});

test("temperature response is material-specific", () => {
  const room = layerSummary(DEFAULT_LAYERS, 25);
  const hot = layerSummary(DEFAULT_LAYERS, 70);
  const roomUtg = room.activeLayers.find((layer) => layer.id === "utg");
  const hotUtg = hot.activeLayers.find((layer) => layer.id === "utg");
  const roomOca = room.activeLayers.find((layer) => layer.id === "oca-top");
  const hotOca = hot.activeLayers.find((layer) => layer.id === "oca-top");
  assert.ok(hotUtg.modulus / roomUtg.modulus > 0.98);
  assert.ok(hotOca.modulus / roomOca.modulus < 0.2);
});

test("minimum radius is respected at maximum control angle", () => {
  const flat = evaluateFold(DEFAULT_PARAMS, DEFAULT_LAYERS);
  const folded = evaluateFold({ ...DEFAULT_PARAMS, foldAngle: 85, baseHingeR: 5 }, DEFAULT_LAYERS);
  assert.equal(flat.radius, Number.POSITIVE_INFINITY);
  assert.ok(folded.radius >= 5 && folded.radius < 5.001);
});

test("tighter radius increases strain and utilization", () => {
  const wide = evaluateFold({ ...DEFAULT_PARAMS, foldAngle: 85, baseHingeR: 8 }, DEFAULT_LAYERS);
  const tight = evaluateFold({ ...DEFAULT_PARAMS, foldAngle: 85, baseHingeR: 3 }, DEFAULT_LAYERS);
  assert.ok(tight.strain > wide.strain);
  assert.ok(tight.criticalUtilization > wide.criticalUtilization);
  assert.ok(tight.foldingLoad > wide.foldingLoad);
});

test("force is dimensionally scaled to an engineering range", () => {
  const result = evaluateFold({ ...DEFAULT_PARAMS, foldAngle: 85 }, DEFAULT_LAYERS);
  assert.ok(result.foldingLoad > 0.1);
  assert.ok(result.foldingLoad < 20);
});

test("Thin Stack preset actually reduces total thickness", () => {
  const thin = PRESETS.find((preset) => preset.name === "Thin Stack");
  assert.ok(layerSummary(thin.layers, 25).totalThickness < layerSummary(DEFAULT_LAYERS, 25).totalThickness);
});

test("cycle damage reduces safety margin", () => {
  const fresh = evaluateFold({ ...DEFAULT_PARAMS, foldAngle: 60, cycleCount: 0 }, DEFAULT_LAYERS);
  const aged = evaluateFold({ ...DEFAULT_PARAMS, foldAngle: 60, cycleCount: 200000 }, DEFAULT_LAYERS);
  assert.ok(aged.criticalUtilization > fresh.criticalUtilization);
  assert.ok(aged.safetyMargin < fresh.safetyMargin);
});

test("CSV uses normalized layer records and includes curve data", () => {
  const layers = cloneLayers(DEFAULT_LAYERS);
  const params = { ...DEFAULT_PARAMS, foldAngle: 45 };
  const metrics = evaluateFold(params, layers);
  const csv = simulationCsv(params, metrics, layers);
  assert.match(csv, /layer_property,UTG\.modulus_25c,70,GPa/);
  assert.match(csv, /layer_result,UTG/);
  assert.match(csv, /stress_strain_curve,hysteresis_point/);
  assert.doesNotMatch(csv, /\?쒖|諛뺣|怨좎/);
});
