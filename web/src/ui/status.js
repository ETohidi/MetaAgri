// One status vocabulary for every level (docs/CONCEPT-v2.md section 6): shape + word + colour,
// never colour alone. tone feeds page.js pill(text, tone): ok | warn | crit | mute.

/** Crop condition, World to District (GEOGLAM Crop Monitor classes). */
export const CROP_CONDITION = {
  exceptional: { label: "Exceptional", tone: "ok" },
  favourable: { label: "Favourable", tone: "ok" },
  watch: { label: "Watch", tone: "warn" },
  poor: { label: "Poor", tone: "crit" },
  outofseason: { label: "Out of season", tone: "mute" },
  nodata: { label: "No data", tone: "mute" },
};

/** Drought (European Drought Observatory combined drought indicator). */
export const DROUGHT = {
  none: { label: "No drought", tone: "ok" },
  watch: { label: "Drought watch", tone: "warn" },
  warning: { label: "Drought warning", tone: "warn" },
  alert: { label: "Drought alert", tone: "crit" },
};

/** Farm operations, for the farm and its plan. */
export const OPS = {
  ontrack: { label: "On track", tone: "ok" },
  decision: { label: "Needs decision", tone: "warn" },
  blocked: { label: "Blocked by safety rules", tone: "crit" },
};

/** Confidence in plain words (the number stays in the tooltip). */
export function confidenceWord(c) {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "medium";
  return "low";
}

/**
 * Crop condition of one field from the twin's state (Simulated): poor below its stress line or in
 * bad health, watch near the line or under disease pressure, favourable otherwise.
 * @param {import("../engine/types.js").FieldSnapshot} f
 */
export function fieldCondition(f) {
  if (f.harvested) return CROP_CONDITION.outofseason;
  if (f.soilMoisturePct < f.stressThresholdPct || f.cropHealth < 0.6) return CROP_CONDITION.poor;
  if (f.soilMoisturePct < f.stressThresholdPct + 10 || f.diseasePressure >= 0.6) return CROP_CONDITION.watch;
  return CROP_CONDITION.favourable;
}
