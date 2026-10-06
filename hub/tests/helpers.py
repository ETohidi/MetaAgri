"""Small builders shared by the tests (plain functions; fixtures live in conftest.py)."""
from hub.schemas import Action, Proposal
from hub.state import HubState


def fresh_state(seed: int = 0) -> HubState:
    state = HubState()
    state.reset(seed=seed)
    return state


def set_weather(state: HubState, rain_today: float = 0.0, wind: float = 2.0, rain_tomorrow: float = 0.0) -> None:
    """Pin today's and tomorrow's weather so a rule test doesn't depend on the dice."""
    state.weather_today.update(rain_mm=rain_today, wind_ms=wind, hail=False, note="")
    state.forecast[0].update(rain_mm=rain_tomorrow, hail=False, note="")


def make_ready(state: HubState, *fields: str) -> None:
    for name in fields:
        state.fields[name].days_to_harvest = 0


def proposal(field: str, *actions: Action, rationale: str = "test", confidence: float = 0.8) -> Proposal:
    return Proposal(field=field, actions=list(actions), rationale=rationale, confidence=confidence)


def capacity(farm: str, combine: float = 1, storage_t: float = 200.0, confidence: float = 0.85) -> dict:
    return {
        "farm": farm,
        "can_share": {"combine": combine, "storage_t": storage_t},
        "valid_until": "Tue 7 Jul",
        "confidence": confidence,
        "note": "test",
    }


def entry_for(entries: list[dict], field: str, action_type: str) -> dict:
    return next(e for e in entries if e["field"] == field and e["action"]["type"] == action_type)
