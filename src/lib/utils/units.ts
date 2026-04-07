// ─── Unit System ─────────────────────────────────────────────────────────────
// All raw data is stored in SI units (meters, m/s).
// This module provides conversion factors and labels for metric vs imperial.
// Option A: unit is selected BEFORE upload — all computed values use the chosen unit.

export type UnitSystem = 'metric' | 'imperial';

/** m/s → km/h or mph */
export const SPEED_FACTOR: Record<UnitSystem, number> = {
  metric:   3.6,
  imperial: 2.23694,
};

/** meters → km or miles */
export const DIST_DIVISOR: Record<UnitSystem, number> = {
  metric:   1000,
  imperial: 1609.344,
};

/** meters → meters or feet (elevation display) */
export const ELE_FACTOR: Record<UnitSystem, number> = {
  metric:   1,
  imperial: 3.28084,
};

export const SPEED_LABEL: Record<UnitSystem, string> = {
  metric:   'KM/H',
  imperial: 'MPH',
};

export const DIST_LABEL: Record<UnitSystem, string> = {
  metric:   'KM',
  imperial: 'MI',
};

export const ELE_LABEL: Record<UnitSystem, string> = {
  metric:   'm',
  imperial: 'ft',
};

// ─── Absolute fallback thresholds for SceneDetectorV2 ─────────────────────
// Used only when percentile calculation is unavailable (< 20 valid samples).
// Values are in the display unit (km/h or mph).

export const SPEED_THRESH_DESCENT: Record<UnitSystem, number> = {
  metric:   15.0,
  imperial: 9.3,
};

export const SPEED_THRESH_TECHNICAL: Record<UnitSystem, number> = {
  metric:   30.0,
  imperial: 18.6,
};

export const SPEED_THRESH_SUFFER: Record<UnitSystem, number> = {
  metric:   8.0,
  imperial: 5.0,
};
