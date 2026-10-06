"""What buyers and neighbours see: template notices generated from APPROVED plan
actions only (a rejected or expired plan never reaches anyone outside the farm)."""
from hub.state import FIELD_DISPLAY_NAME, SURPLUS_NOISE_T, HubState


def confidence_label(confidence: float) -> str:
    if confidence >= 0.7:
        return "high"
    if confidence >= 0.4:
        return "medium"
    return "low"


def _harvest_notice(field: str, crop: str, tonnes: float, confidence: float) -> dict:
    return {
        "audience": "Buyers",
        "text": (
            f"{crop.capitalize()} harvest on {FIELD_DISPLAY_NAME[field]} today — about {tonnes:.0f} t expected. "
            f"Confidence: {confidence_label(confidence)}."
        ),
    }


def generate(bundle: dict, state: HubState) -> list[dict]:
    notices = []
    for p in bundle["proposals"]:
        field = p["field"]
        f = state.fields[field]
        where = FIELD_DISPLAY_NAME[field]
        for a in p["actions"]:
            t = a["type"]
            confidence = a.get("confidence", p["confidence"])
            if t == "harvest":
                notices.append(_harvest_notice(field, f.crop, f.yield_estimate_t, confidence))
            elif t == "borrow_combine":
                # A borrowed combine still brings in a harvest buyers want to hear about.
                notices.append(_harvest_notice(field, f.crop, f.yield_estimate_t, confidence))
                notices.append(
                    {
                        "audience": a["farm"],
                        "text": f"{a['farm']}: thanks for lending your combine for our {where} ({f.crop}) today.",
                    }
                )
            elif t == "deliver_to":
                # apply_bundle records what actually moved; nothing moved -> nothing to tell them
                tonnes = a.get("moved_t", a.get("tonnes", 0))
                if tonnes < SURPLUS_NOISE_T:
                    continue
                notices.append(
                    {
                        "audience": a["farm"],
                        "text": f"{a['farm']}: expect about {tonnes:.0f} t of {f.crop} for storage today.",
                    }
                )
            elif t == "spray":
                product = (a.get("product") or "crop protection").capitalize()
                notices.append(
                    {
                        "audience": "Beekeepers & neighbours",
                        "text": f"{product} spraying on {where} today — please keep hives and walkers away from the field edge.",
                    }
                )
            elif t == "irrigate":
                notices.append(
                    {
                        "audience": "Neighbours",
                        "text": f"Irrigation running on {where} today ({a.get('mm', 0):g} mm) — the field track may be wet.",
                    }
                )
            elif t == "sow_cover_crop":
                notices.append(
                    {"audience": "Neighbours", "text": f"Cover crop sown on {where} after the {f.short_crop} harvest."}
                )
            elif t == "fertilize":
                notices.append({"audience": "Neighbours", "text": f"Fertilizer spreading on {where} today."})
            # scout, defer_task: nothing anyone outside the farm needs to know
    return notices
