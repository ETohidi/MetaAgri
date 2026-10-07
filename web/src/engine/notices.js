// What buyers and neighbours see: template notices generated from APPROVED plan actions
// only (a rejected or expired plan never reaches anyone outside the farm). Port of the
// Python hub's notices.py.

import { FIELD_NAMES } from "../data/places.js";
import { capitalize, fixed, g } from "./format.js";
import { SURPLUS_NOISE_T } from "./state.js";

export function confidenceLabel(confidence) {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

function harvestNotice(field, crop, tonnes, confidence) {
  return {
    audience: "Buyers",
    text:
      `${capitalize(crop)} harvest on ${FIELD_NAMES[field]} today — about ${fixed(tonnes, 0)} t expected. ` +
      `Confidence: ${confidenceLabel(confidence)}.`,
  };
}

/** The notices an approved (and already applied) plan produces: [{audience, text}]. */
export function generate(bundle, state) {
  const out = [];
  for (const p of bundle.proposals) {
    const field = p.field;
    const f = state.fields[field];
    const where = FIELD_NAMES[field];
    for (const a of p.actions) {
      const confidence = a.confidence ?? p.confidence;
      switch (a.type) {
        case "harvest":
          out.push(harvestNotice(field, f.crop, f.yieldEstimateT, confidence));
          break;
        case "borrow_combine":
          // A borrowed combine still brings in a harvest buyers want to hear about.
          out.push(harvestNotice(field, f.crop, f.yieldEstimateT, confidence));
          out.push({
            audience: a.farm,
            text: `${a.farm}: thanks for lending your combine for our ${where} (${f.crop}) today.`,
          });
          break;
        case "deliver_to": {
          // applyBundle records what actually moved; nothing moved -> nothing to tell them
          const tonnes = a.movedT ?? a.tonnes ?? 0;
          if (tonnes < SURPLUS_NOISE_T) break;
          out.push({ audience: a.farm, text: `${a.farm}: expect about ${fixed(tonnes, 0)} t of ${f.crop} for storage today.` });
          break;
        }
        case "spray": {
          const product = capitalize(a.product || "crop protection");
          out.push({
            audience: "Beekeepers & neighbours",
            text: `${product} spraying on ${where} today — please keep hives and walkers away from the field edge.`,
          });
          break;
        }
        case "irrigate":
          out.push({
            audience: "Neighbours",
            text: `Irrigation running on ${where} today (${g(a.mm ?? 0)} mm) — the field track may be wet.`,
          });
          break;
        case "sow_cover_crop":
          out.push({ audience: "Neighbours", text: `Cover crop sown on ${where} after the ${f.shortCrop} harvest.` });
          break;
        case "fertilize":
          out.push({ audience: "Neighbours", text: `Fertilizer spreading on ${where} today.` });
          break;
        default:
        // scout, defer_task: nothing anyone outside the farm needs to know
      }
    }
  }
  return out;
}
