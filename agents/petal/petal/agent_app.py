"""MetaAgri petal: a Flower AgentApp that proposes the day's farm work for one field
(North, West, or River), or - when agent.unit="FARM" - reports one farm's spare
capacity (combine, silo space) for the Machinery ring."""

import json
import os
import re
from datetime import datetime, timedelta
from urllib.parse import quote

import requests
from flwr.agentapp import AgentApp, AgentSession
from flwr.app import Context
from openai import OpenAI

from petal.schemas import ACTION_TYPES, FarmCapacity, Proposal

MODEL = "openai/gpt-5.6-sol"
DEFAULT_HUB_URL = "http://127.0.0.1:8100"
FIELDS = ("North", "West", "River")
OWN_FARM_NAME = "Hof Lerchenbruch"
NEIGHBOUR_FARMS = ("Gut Rohrdommelsee", "Agrarhof Oderblick")
SEASON_YEAR = 2026  # the season starts Monday 6 July 2026 (hub/clock.py); labels carry no year

app = AgentApp()


def _load_census(context: Context, path: str, hub_url: str) -> dict:
    """SuperGrid fallback: use agent.census if provided, else fetch from the hub."""
    census_override = context.run_config.get("agent.census")
    if isinstance(census_override, str) and census_override.strip():
        return json.loads(census_override)
    response = requests.get(f"{hub_url}{path}", timeout=10)
    response.raise_for_status()
    return response.json()


def _next_date_label(date_label: str) -> str:
    """Next day's label, e.g. "Mon 6 Jul" -> "Tue 7 Jul" (hub/clock.py format). Unparseable -> unchanged."""
    try:
        day = datetime.strptime(f"{date_label} {SEASON_YEAR}", "%a %d %b %Y").date()
    except (TypeError, ValueError):
        return str(date_label)
    next_day = day + timedelta(days=1)
    return f"{next_day:%a} {next_day.day} {next_day:%b}"


def _build_system_prompt(field: str, census: dict) -> str:
    action_types = ", ".join(ACTION_TYPES)
    neighbours = " and ".join(f'"{name}"' for name in NEIGHBOUR_FARMS)
    # Show the parameters of the action this field most likely needs (irrigable = potatoes).
    example_action = (
        {"type": "irrigate", "mm": 15, "confidence": 0.0, "reason": "string"}
        if census.get("irrigable")
        else {"type": "harvest", "confidence": 0.0, "reason": "string"}
    )
    schema_example = json.dumps(
        {
            "field": field,
            "actions": [example_action],
            "rationale": "string",
            "confidence": 0.0,
            "risks": ["string"],
        }
    )
    recent_rejections = census.get("recent_rejections") or []
    rejections_text = "; ".join(recent_rejections) if recent_rejections else "none"
    hint = census.get("hint")
    hint_text = f" Hint from the farm: {hint}" if hint else ""
    return (
        f"You are the {field} field agent on {OWN_FARM_NAME}, an arable farm in the Oderbruch "
        "(Brandenburg, Germany). Every morning you receive your field's census as JSON and propose "
        "today's work for this one field. "
        # What the census means.
        "The census: date is today. crop, area_ha and stage describe the field. days_to_harvest "
        "counts down to ripeness; harvest_ready is true once the wheat or rapeseed is ripe (potatoes are not "
        "ready this season). harvested says the crop is already off the field, cover_crop that a "
        "cover crop was sown after it, irrigable that the field has irrigation equipment. "
        "soil_moisture_pct is plant-available water in % (1 mm of rain or irrigation adds about 1 %, "
        "the crop uses about et0_mm times its crop factor per day); below stress_threshold_pct the "
        "crop suffers and crop_health (0-1) drops. disease_pressure (0-1) is the fungal risk: wet, "
        "humid days raise it, and above about 0.6 blight is likely unless the crop is sprayed. "
        "yield_estimate_t is the tonnes the whole field would give if harvested today. "
        "days_since_sprayed / days_since_irrigated are null if it never happened this season. "
        "weather_today has temp_max_c, rain_mm, wind_ms, et0_mm (evaporation demand, mm/day), "
        "humidity_pct and hail; forecast holds the next 3 days and forecast[0] is tomorrow. "
        "resources is what the whole farm has today, shared with the other two fields: "
        "water_permit_m3 (the daily water abstraction permit), workers, combine, sprayer and "
        "storage_free_t (free silo space in tonnes). scenario names an active heatwave or hail warning. "
        # What the agent may do, and what it costs.
        f"Use ONLY these action types: {action_types}. "
        "irrigate needs mm (water depth): only on irrigable fields; it costs mm x area_ha x 10 m³ "
        "of water (1 mm on 1 ha = 10 m³, so 25 mm on 24 ha = 6,000 m³) and 1 worker. "
        "spray needs product (fungicide, insecticide or herbicide): it costs the sprayer and 1 worker. "
        "fertilize needs kg_n_ha (kilograms of nitrogen per hectare): it costs 1 worker. "
        "harvest brings the whole field (about yield_estimate_t tonnes) into our silo: it costs "
        "the combine and 2 workers. scout means walking the field to check crop, soil or grain "
        "moisture: it costs nothing. defer_task means deliberately waiting (say what and why in "
        "the reason): it costs nothing. sow_cover_crop is only for a harvested field without a "
        "cover crop: it costs 1 worker. borrow_combine needs farm: harvest this field with that "
        "neighbour's combine, costing their combine and 1 of our workers. deliver_to needs farm and "
        "tonnes: send surplus grain to that neighbour's silo, costing nothing of ours. "
        f"The neighbour farms are {neighbours}. Leave borrow_combine and deliver_to to the Machinery "
        "ring: it adds them by itself, with a neighbour that reported spare capacity today, when our "
        "combine is taken or the silo is full. Even when the hint mentions neighbour help, just "
        "propose the harvest as usual. "
        # The Safety check rules (hub/thorn.py), so the proposal passes.
        "A Safety check blocks every action that breaks these rules, so only propose actions that pass: "
        "irrigation must stay within today's water permit (mm x area_ha x 10 <= water_permit_m3; a "
        "heatwave cuts the permit); only irrigable fields can be irrigated; no spraying when today's "
        "wind_ms is above 5 m/s or more than 5 mm of rain is forecast for tomorrow; no spraying within "
        "14 days of harvest (days_to_harvest 14 or less); harvest only a ripe (harvest_ready), "
        "unharvested crop on a dry day (today's rain_mm below 2 mm); each machine (combine, sprayer) "
        "can work only one field per day, and if several fields want it the Coordinator keeps the one "
        "with the most value at risk; never plan more work than the workers available today (the three "
        "fields share them); no fertilizing when soil_moisture_pct is above 90, more than 10 mm of rain "
        "is forecast for tomorrow, or the field is harvested; borrow_combine and deliver_to need a named "
        "neighbour farm that reports spare capacity. "
        # How to decide.
        "Ripe wheat or rapeseed loses yield every day it waits, and a hail warning means harvesting a "
        "ripe crop before the storm is worth it. If nothing is needed, return an empty actions list and say why "
        "in the rationale. "
        f"Respond with ONE JSON object only, no prose, matching this schema: {schema_example}. "
        "Every action needs its own confidence (0-1) and a one-line reason that mentions the crop, "
        "the soil moisture or the weather behind it. "
        "Be conservative when confidence is low: prefer scout or defer_task over a risky action. "
        "Confidence above 0.85 requires that both today's weather and tomorrow's forecast support the action. "
        "If irrigation was rejected, fit it into the permit: mm <= water_permit_m3 / (area_ha x 10). "
        f"Recent rejections by the farm manager, learn from them: {rejections_text}."
        f"{hint_text}"
    )


def _build_farm_system_prompt(farm_name: str, valid_until: str) -> str:
    schema_example = json.dumps(
        {
            "farm": farm_name,
            "can_share": {"combine": 0, "storage_t": 0},
            "valid_until": valid_until,
            "confidence": 0.0,
            "note": "string",
        }
    )
    return (
        f"You are the farm agent for {farm_name}, an arable farm in the Oderbruch (Brandenburg, "
        "Germany) and a member of the local Machinery ring, where neighbouring farms lend each other "
        "combines and silo space at harvest time. You receive a high-level census as JSON: "
        "storage_free_t (free silo space in tonnes), combine_available (1 if your combine is free "
        "today), ripe_backlog_ha (hectares of your own ripe crop still waiting for a combine), "
        "avg_soil_moisture_pct, and any active scenario (heatwave or hail warning). "
        "Report how much you can realistically share with a neighbour farm today: combine is 0 or 1 "
        "(1 only if your combine is free and you have no ripe backlog of your own), storage_t is "
        "the tonnes of grain you can take into your silo. Stay conservative: keep a buffer of at "
        "least 50 t of silo space for your own harvest, share less (about half) while a scenario is "
        "active, and share nothing you are unsure about. "
        f"Respond with ONE JSON object only, no prose, matching this schema: {schema_example}. "
        f'valid_until must be "{valid_until}" (the next day). '
        'note is one short line for the farm manager, e.g. "combine free, 470 t silo space".'
    )


def _extract_json_object(text: str) -> str:
    text = text.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    return text


def _parse_proposal(raw_text: str, field: str) -> Proposal:
    try:
        data = json.loads(_extract_json_object(raw_text))
        data["field"] = field  # it answered for the census it was given, whatever it wrote
        return Proposal(**data)
    except Exception as exc:  # malformed or schema-invalid model output
        return Proposal(
            field=field,
            actions=[],
            rationale=f"Model output could not be parsed/validated ({exc}); holding off on field work conservatively.",
            confidence=0.1,
            risks=["model output parse failure"],
        )


def _parse_capacity(raw_text: str, farm_name: str, valid_until: str) -> FarmCapacity:
    try:
        data = json.loads(_extract_json_object(raw_text))
        data["farm"] = farm_name  # same: the answer is for the farm that was asked
        return FarmCapacity(**data)
    except Exception as exc:  # malformed or schema-invalid model output
        return FarmCapacity(
            farm=farm_name,
            can_share={"combine": 0, "storage_t": 0},
            valid_until=valid_until,
            confidence=0.1,
            note=f"Model output could not be parsed/validated ({exc}); reporting no spare capacity conservatively.",
        )


def _post_json(hub_url: str, path: str, payload: dict, quiet: bool) -> None:
    """POST our answer to the hub too, best-effort. When `quiet` (census was supplied
    inline, e.g. from SuperGrid), the hub can't be reached by design, so don't warn about
    it - the hub itself parses this agent's stdout for the answer in that case."""
    try:
        requests.post(f"{hub_url}{path}", json=payload, timeout=5)
    except requests.RequestException as exc:
        if not quiet:
            print(f"warning: could not reach hub at {hub_url}{path}: {exc}")


@app.main()
def main(agent: AgentSession, context: Context) -> None:
    unit = context.run_config.get("agent.unit")
    hub_url = str(context.run_config.get("hub.url") or DEFAULT_HUB_URL).rstrip("/")
    census_override = context.run_config.get("agent.census")
    used_inline_census = isinstance(census_override, str) and bool(census_override.strip())

    is_farm = unit == "FARM"
    if is_farm:
        farm_name = str(context.run_config.get("agent.farm") or "").strip()
        if not farm_name:
            raise ValueError('agent.farm must be set when agent.unit="FARM"')
        census = _load_census(context, f"/farms/{quote(farm_name)}/census", hub_url)
        valid_until = _next_date_label(census.get("date", ""))
        system_prompt = _build_farm_system_prompt(farm_name, valid_until)
    elif unit in FIELDS:
        census = _load_census(context, f"/census/{unit}", hub_url)
        system_prompt = _build_system_prompt(unit, census)
    else:
        raise ValueError(f'agent.unit must be one of {FIELDS} or "FARM", got {unit!r}')

    client = OpenAI(
        base_url=os.environ["FLWR_RUNTIME_BASE_URL"],
        api_key=os.environ["FLWR_RUNTIME_API_KEY"],
        max_retries=0,
    )
    stream = client.responses.create(
        model=MODEL,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(census)},
        ],
        stream=True,
    )

    output_text = []
    for event in stream:
        agent.events.emit(event.to_dict())
        if event.type in {"error", "response.failed"}:
            raise RuntimeError(f"Model response failed: {event}")
        if event.type == "response.output_text.delta":
            output_text.append(event.delta)

    raw_text = "".join(output_text)
    if is_farm:
        capacity = _parse_capacity(raw_text, farm_name, valid_until)
        payload = capacity.model_dump()
        _post_json(hub_url, "/farm-capacity", payload, quiet=used_inline_census)
    else:
        proposal = _parse_proposal(raw_text, unit)
        payload = proposal.model_dump(exclude_none=True)
        _post_json(hub_url, "/proposals", payload, quiet=used_inline_census)

    final_json = json.dumps(payload)
    agent.events.emit({"type": "response.output_text.delta", "delta": final_json})
    agent.events.emit({"type": "response.completed"})
    print(final_json)
