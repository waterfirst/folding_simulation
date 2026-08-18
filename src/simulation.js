export const MAX_LAYERS = 10;
export const MAX_FOLD_ANGLE = 85;

const REFERENCE_TEMPERATURE = 25;
const ACTUATION_ARM_MM = 42;

export const DEFAULT_LAYERS = [
  {
    id: "utg",
    name: "UTG",
    thickness: 30,
    modulus: 70,
    allowableStrain: 0.006,
    tempCoeff: 0.00015,
    enabled: true,
  },
  {
    id: "oca-top",
    name: "OCA Top",
    thickness: 25,
    modulus: 0.002,
    allowableStrain: 0.8,
    tempCoeff: 0.055,
    enabled: true,
  },
  {
    id: "pol",
    name: "POL",
    thickness: 45,
    modulus: 3.2,
    allowableStrain: 0.025,
    tempCoeff: 0.0035,
    enabled: true,
  },
  {
    id: "pi",
    name: "PI Film",
    thickness: 25,
    modulus: 2.5,
    allowableStrain: 0.07,
    tempCoeff: 0.002,
    enabled: true,
  },
  {
    id: "pet",
    name: "PET Support",
    thickness: 50,
    modulus: 2.7,
    allowableStrain: 0.04,
    tempCoeff: 0.004,
    enabled: true,
  },
  {
    id: "oca-bottom",
    name: "OCA Bottom",
    thickness: 25,
    modulus: 0.002,
    allowableStrain: 0.8,
    tempCoeff: 0.055,
    enabled: true,
  },
];

export const DEFAULT_PARAMS = {
  foldAngle: 0,
  temperature: 25,
  baseHingeR: 5,
  panelWidth: 70,
  cycleCount: 0,
  hysteresis: 18,
  cycleSpeed: 0.75,
  flipFold: false,
};

const THIN_STACK_LAYERS = DEFAULT_LAYERS.map((layer) => ({
  ...layer,
  thickness:
    {
      "oca-top": 18,
      pol: 35,
      pi: 20,
      pet: 30,
      "oca-bottom": 18,
    }[layer.id] ?? layer.thickness,
}));

export const PRESETS = [
  {
    name: "Baseline",
    description: "표준 적층·상온 평가 조건",
    params: { foldAngle: 24, temperature: 25, baseHingeR: 5, panelWidth: 70, cycleCount: 0, hysteresis: 18 },
    layers: DEFAULT_LAYERS,
  },
  {
    name: "Thin Stack",
    description: "박막 적층·저하중 조건",
    params: { foldAngle: 48, temperature: 25, baseHingeR: 5.5, panelWidth: 70, cycleCount: 5000, hysteresis: 16 },
    layers: THIN_STACK_LAYERS,
  },
  {
    name: "Hot Cycle",
    description: "고온 반복 구동 조건",
    params: { foldAngle: 58, temperature: 70, baseHingeR: 4.5, panelWidth: 70, cycleCount: 80000, hysteresis: 30 },
    layers: DEFAULT_LAYERS,
  },
  {
    name: "Tight Hinge",
    description: "소반경 힌지 한계 평가",
    params: { foldAngle: 68, temperature: 25, baseHingeR: 3, panelWidth: 70, cycleCount: 20000, hysteresis: 24 },
    layers: DEFAULT_LAYERS,
  },
];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function cloneLayers(layers = DEFAULT_LAYERS) {
  return layers.map((layer) => ({ ...layer }));
}

function temperatureAdjustedModulus(layer, temperature) {
  const referenceModulus = Math.max(0, Number(layer.modulus || 0));
  const coefficient = Math.max(0, Number(layer.tempCoeff ?? 0.004));
  const temperatureFactor = clamp(
    Math.exp(-coefficient * (temperature - REFERENCE_TEMPERATURE)),
    0.08,
    2.5
  );
  return {
    modulus: referenceModulus * temperatureFactor,
    temperatureFactor,
  };
}

export function layerSummary(layers, temperature = REFERENCE_TEMPERATURE) {
  const activeLayers = layers.filter((layer) => layer.enabled !== false).slice(0, MAX_LAYERS);
  const totalThickness = activeLayers.reduce(
    (sum, layer) => sum + Math.max(0, Number(layer.thickness || 0)),
    0
  );

  if (activeLayers.length === 0 || totalThickness <= 0) {
    return {
      activeLayers: [],
      totalThickness: 0,
      effectiveModulus: 0,
      bendingRigidityPerWidth: 0,
      neutralAxis: 0,
      outerDistance: 0,
    };
  }

  let cursorMm = 0;
  let ea = 0;
  let eay = 0;
  const prepared = activeLayers.map((layer) => {
    const thickness = Math.max(0, Number(layer.thickness || 0));
    const thicknessMm = thickness / 1000;
    const { modulus, temperatureFactor } = temperatureAdjustedModulus(layer, temperature);
    const modulusMpa = modulus * 1000;
    const lowerMm = cursorMm;
    const centerMm = lowerMm + thicknessMm / 2;
    const upperMm = lowerMm + thicknessMm;
    cursorMm = upperMm;
    ea += modulusMpa * thicknessMm;
    eay += modulusMpa * thicknessMm * centerMm;
    return {
      ...layer,
      thickness,
      thicknessMm,
      referenceModulus: Math.max(0, Number(layer.modulus || 0)),
      modulus,
      modulusMpa,
      temperatureFactor,
      allowableStrain: Math.max(0.0001, Number(layer.allowableStrain ?? 0.03)),
      lowerMm,
      centerMm,
      upperMm,
    };
  });

  const totalThicknessMm = totalThickness / 1000;
  const neutralAxisMm = ea > 0 ? eay / ea : totalThicknessMm / 2;
  const bendingRigidityPerWidth = prepared.reduce((sum, layer) => {
    const localI = Math.pow(layer.thicknessMm, 3) / 12;
    const distance = layer.centerMm - neutralAxisMm;
    const parallelAxis = layer.thicknessMm * distance * distance;
    return sum + layer.modulusMpa * (localI + parallelAxis);
  }, 0);
  const effectiveModulusMpa =
    bendingRigidityPerWidth > 0
      ? (12 * bendingRigidityPerWidth) / Math.pow(totalThicknessMm, 3)
      : 0;
  const outerDistanceMm = Math.max(neutralAxisMm, totalThicknessMm - neutralAxisMm);

  return {
    activeLayers: prepared,
    totalThickness,
    totalThicknessMm,
    effectiveModulus: effectiveModulusMpa / 1000,
    bendingRigidityPerWidth,
    neutralAxis: neutralAxisMm * 1000,
    neutralAxisMm,
    outerDistance: outerDistanceMm * 1000,
    outerDistanceMm,
  };
}

function layerMechanicalResults(stack, curvature, params, fatigueDamage, residualCurvature) {
  const direction = params.flipFold ? -1 : 1;
  const effectiveCurvature = curvature + residualCurvature;
  return stack.activeLayers.map((layer) => {
    const lowerStrain = direction * (layer.lowerMm - stack.neutralAxisMm) * effectiveCurvature;
    const upperStrain = direction * (layer.upperMm - stack.neutralAxisMm) * effectiveCurvature;
    const criticalSurface = Math.abs(lowerStrain) >= Math.abs(upperStrain) ? "lower" : "upper";
    const criticalStrain = criticalSurface === "lower" ? lowerStrain : upperStrain;
    const criticalStress = criticalStrain * layer.modulusMpa;
    const highTemperaturePenalty =
      layer.tempCoeff > 0.001 ? clamp(1 - Math.max(0, params.temperature - 25) * 0.002, 0.75, 1) : 1;
    const fatiguePenalty = 1 - fatigueDamage * 0.35;
    const effectiveAllowableStrain = layer.allowableStrain * highTemperaturePenalty * fatiguePenalty;
    const utilization = Math.abs(criticalStrain) / Math.max(effectiveAllowableStrain, 0.0001);

    return {
      id: layer.id,
      name: layer.name,
      lowerStrain,
      upperStrain,
      criticalSurface,
      criticalStrain,
      stress: criticalStress,
      maxAbsStress: Math.abs(criticalStress),
      maxAbsStrain: Math.abs(criticalStrain),
      allowableStrain: layer.allowableStrain,
      effectiveAllowableStrain,
      modulus: layer.modulus,
      utilization,
    };
  });
}

export function evaluateFold(params, layers = DEFAULT_LAYERS) {
  const safeParams = { ...DEFAULT_PARAMS, ...params };
  const stack = layerSummary(layers, safeParams.temperature);
  const foldAngle = clamp(Number(safeParams.foldAngle || 0), 0, MAX_FOLD_ANGLE);
  const normalizedAngle = foldAngle / MAX_FOLD_ANGLE;
  const foldProgress = Math.sin(normalizedAngle * Math.PI * 0.5);
  const minimumRadius = Math.max(0.5, Number(safeParams.baseHingeR || 0.5));
  const curvature = foldProgress / minimumRadius;
  const currentRadius = curvature > 1e-9 ? 1 / curvature : Number.POSITIVE_INFINITY;
  const cycleCount = Math.max(0, Number(safeParams.cycleCount || 0));
  const fatigueDamage = clamp(
    (Math.log10(cycleCount + 1) / Math.log10(200001)) * 0.45,
    0,
    0.45
  );
  const hysteresisBase = clamp(Number(safeParams.hysteresis || 0) / 100, 0, 0.7);
  const residualCurvature =
    (fatigueDamage * 0.08 * clamp(hysteresisBase / 0.18, 0.4, 2.2)) / minimumRadius;
  const residualStrain = stack.outerDistanceMm * residualCurvature;
  const layerResults = layerMechanicalResults(
    stack,
    curvature,
    safeParams,
    fatigueDamage,
    residualCurvature
  );
  const criticalResult = layerResults.reduce(
    (critical, result) => (!critical || result.utilization > critical.utilization ? result : critical),
    null
  );
  const maxStressResult = layerResults.reduce(
    (critical, result) => (!critical || result.maxAbsStress > critical.maxAbsStress ? result : critical),
    null
  );
  const maxStrainResult = layerResults.reduce(
    (critical, result) => (!critical || result.maxAbsStrain > critical.maxAbsStrain ? result : critical),
    null
  );

  const panelWidth = clamp(Number(safeParams.panelWidth || 70), 10, 200);
  const bendingMoment = stack.bendingRigidityPerWidth * panelWidth * curvature;
  const elasticForce = bendingMoment / ACTUATION_ARM_MM;
  const thermalViscoelasticLoss = clamp(Math.max(0, safeParams.temperature - 25) * 0.0015, 0, 0.12);
  const loopLoss = clamp(hysteresisBase + fatigueDamage * 0.35 + thermalViscoelasticLoss, 0.02, 0.65);
  const fixtureParasiticLoad = foldProgress * (0.08 + panelWidth * 0.0015);
  const calculatedForce = elasticForce + fixtureParasiticLoad;
  const foldingLoad = elasticForce * (1 + loopLoss * 0.55) + fixtureParasiticLoad;
  const unfoldingLoad = Math.max(
    0,
    elasticForce * (1 - loopLoss * 0.45) - fixtureParasiticLoad * 0.35
  );
  const actuatorStroke = foldProgress * ACTUATION_ARM_MM;
  const utilization = criticalResult?.utilization ?? 0;
  const fatigueIndex = clamp(utilization, 0, 1.4);
  const safetyMargin = clamp((1 - utilization) * 100, 0, 100);

  let risk = "PASS";
  if (utilization >= 1) risk = "FAIL";
  else if (utilization >= 0.75) risk = "WATCH";

  return {
    totalAngle: Number((foldAngle * 2).toFixed(1)),
    radius: currentRadius,
    curvature: Number(curvature.toFixed(6)),
    force: Number(calculatedForce.toFixed(3)),
    elasticForce: Number(elasticForce.toFixed(3)),
    foldingLoad: Number(foldingLoad.toFixed(3)),
    unfoldingLoad: Number(unfoldingLoad.toFixed(3)),
    actuatorStroke: Number(actuatorStroke.toFixed(2)),
    bendingMoment: Number(bendingMoment.toFixed(4)),
    bendingRigidity: Number(stack.bendingRigidityPerWidth.toFixed(5)),
    stress: Number((maxStressResult?.maxAbsStress ?? 0).toFixed(2)),
    strain: Number((maxStrainResult?.maxAbsStrain ?? 0).toFixed(6)),
    fatigueIndex: Number(fatigueIndex.toFixed(3)),
    fatigueShift: Number(fatigueDamage.toFixed(4)),
    loopLoss: Number(loopLoss.toFixed(3)),
    residualStrain: Number(residualStrain.toFixed(6)),
    effectiveModulus: Number(stack.effectiveModulus.toFixed(3)),
    stackThickness: Number(stack.totalThickness.toFixed(1)),
    neutralAxis: Number(stack.neutralAxis.toFixed(2)),
    safetyMargin: Number(safetyMargin.toFixed(1)),
    stressIntensity: clamp(utilization, 0, 1),
    criticalLayer: criticalResult?.name ?? "-",
    criticalSurface: criticalResult?.criticalSurface ?? "-",
    criticalUtilization: Number(utilization.toFixed(3)),
    criticalStress: Number((criticalResult?.maxAbsStress ?? 0).toFixed(2)),
    layerResults,
    risk,
  };
}

export function buildCurve(params, layers = DEFAULT_LAYERS, points = 36) {
  return Array.from({ length: points }, (_, index) => {
    const foldAngle = (MAX_FOLD_ANGLE / (points - 1)) * index;
    return { foldAngle, ...evaluateFold({ ...params, foldAngle }, layers) };
  });
}

export function buildHysteresisCurve(
  params,
  layers = DEFAULT_LAYERS,
  points = 70,
  peakAngle = MAX_FOLD_ANGLE
) {
  const curve = [];
  const peakMetrics = evaluateFold({ ...params, foldAngle: peakAngle }, layers);
  const loss = peakMetrics.loopLoss;

  for (let index = 0; index <= points; index += 1) {
    const progress = index / points;
    const metrics = evaluateFold({ ...params, foldAngle: peakAngle * progress }, layers);
    curve.push({
      strain: metrics.strain,
      stress: metrics.stress,
      foldAngle: peakAngle * progress,
      phase: "load",
    });
  }

  for (let index = 0; index <= points; index += 1) {
    const progress = index / points;
    const foldAngle = peakAngle * (1 - progress);
    const metrics = evaluateFold({ ...params, foldAngle }, layers);
    const unloadingFactor = 1 - loss * (0.2 + progress * 0.45);
    curve.push({
      strain: metrics.strain,
      stress: Math.max(0, metrics.stress * unloadingFactor),
      foldAngle,
      phase: "unload",
    });
  }

  return curve;
}

function formatNumber(value, digits = 6) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "Infinity";
}

export function simulationCsv(params, metrics, layers = DEFAULT_LAYERS) {
  const rows = [
    ["record_type", "name", "value", "unit", "phase", "index", "strain", "stress_mpa", "utilization"],
    ["metadata", "model_version", "2.0", "analytical laminate", "", "", "", "", ""],
    ["parameter", "fold_angle_single_side", formatNumber(params.foldAngle, 2), "deg", "", "", "", "", ""],
    ["parameter", "fold_angle_total", formatNumber(params.foldAngle * 2, 2), "deg", "", "", "", "", ""],
    ["parameter", "temperature", formatNumber(params.temperature, 1), "degC", "", "", "", "", ""],
    ["parameter", "minimum_hinge_radius", formatNumber(params.baseHingeR, 3), "mm", "", "", "", "", ""],
    ["parameter", "panel_width", formatNumber(params.panelWidth, 2), "mm", "", "", "", "", ""],
    ["parameter", "cycle_count", formatNumber(params.cycleCount, 0), "count", "", "", "", "", ""],
    ["parameter", "hysteresis_sensitivity", formatNumber(params.hysteresis, 2), "percent", "", "", "", "", ""],
    ["output", "stack_thickness", formatNumber(metrics.stackThickness, 3), "um", "", "", "", "", ""],
    ["output", "effective_modulus", formatNumber(metrics.effectiveModulus, 5), "GPa", "", "", "", "", ""],
    ["output", "neutral_axis", formatNumber(metrics.neutralAxis, 3), "um", "", "", "", "", ""],
    ["output", "current_radius", formatNumber(metrics.radius, 5), "mm", "", "", "", "", ""],
    ["output", "bending_rigidity_per_width", formatNumber(metrics.bendingRigidity, 6), "N*mm2/mm", "", "", "", "", ""],
    ["output", "calculated_force", formatNumber(metrics.force, 5), "N", "", "", "", "", ""],
    ["output", "folding_load", formatNumber(metrics.foldingLoad, 5), "N", "", "", "", "", ""],
    ["output", "unfolding_load", formatNumber(metrics.unfoldingLoad, 5), "N", "", "", "", "", ""],
    ["output", "max_layer_stress", formatNumber(metrics.stress, 5), "MPa", "", "", "", "", ""],
    ["output", "max_layer_strain", formatNumber(metrics.strain, 8), "strain", "", "", "", "", ""],
    ["output", "critical_layer", metrics.criticalLayer, "", "", "", "", "", formatNumber(metrics.criticalUtilization, 5)],
    ["output", "risk", metrics.risk, "", "", "", "", "", ""],
  ];

  const evaluatedLayers = layerSummary(layers, params.temperature).activeLayers;
  evaluatedLayers.forEach((layer, index) => {
    rows.push(["layer_property", `${layer.name}.thickness`, layer.thickness, "um", "", index, "", "", ""]);
    rows.push(["layer_property", `${layer.name}.modulus_25c`, layer.referenceModulus, "GPa", "", index, "", "", ""]);
    rows.push(["layer_property", `${layer.name}.modulus_at_temperature`, formatNumber(layer.modulus, 6), "GPa", "", index, "", "", ""]);
    rows.push(["layer_property", `${layer.name}.allowable_strain`, formatNumber(layer.allowableStrain * 100, 4), "percent", "", index, "", "", ""]);
  });

  metrics.layerResults.forEach((layer, index) => {
    rows.push([
      "layer_result",
      layer.name,
      layer.criticalSurface,
      "",
      "",
      index,
      formatNumber(layer.criticalStrain, 8),
      formatNumber(layer.stress, 5),
      formatNumber(layer.utilization, 5),
    ]);
  });

  buildHysteresisCurve(params, layers).forEach((point, index) => {
    rows.push([
      "stress_strain_curve",
      "hysteresis_point",
      "",
      "",
      point.phase,
      index,
      formatNumber(point.strain, 8),
      formatNumber(point.stress, 5),
      "",
    ]);
  });

  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(",")
    )
    .join("\r\n");
}
