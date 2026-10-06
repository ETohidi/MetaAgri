"""Frozen shared schemas for the hub <-> petal contract (DESIGN.md section 6).

agents/petal/petal/schemas.py is a standalone copy of the Action/Proposal/FarmCapacity
part - the petal never imports the hub.
"""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

FIELD = Literal["North", "West", "River"]

ACTION_TYPES = (
    "irrigate",
    "spray",
    "fertilize",
    "harvest",
    "scout",
    "defer_task",
    "sow_cover_crop",
    "borrow_combine",
    "deliver_to",
)


class Weather(BaseModel):
    date: str
    temp_max_c: float
    rain_mm: float
    wind_ms: float
    et0_mm: float
    humidity_pct: int
    hail: bool = False
    note: str = ""


class Resources(BaseModel):
    """Today's availability, as a field agent sees it."""

    water_permit_m3: int
    workers: int
    combine: int
    sprayer: int
    storage_free_t: float


class FieldCensus(BaseModel):
    tick: int
    date: str
    field: FIELD
    crop: str
    area_ha: float
    stage: str
    days_to_harvest: int
    harvest_ready: bool
    harvested: bool
    cover_crop: bool
    irrigable: bool
    soil_moisture_pct: float
    stress_threshold_pct: float
    crop_health: float
    disease_pressure: float
    yield_estimate_t: float
    days_since_sprayed: Optional[int] = None
    days_since_irrigated: Optional[int] = None
    weather_today: Weather
    forecast: List[Weather] = []
    resources: Resources
    recent_rejections: List[str] = []
    scenario: Optional[str] = None
    hint: Optional[str] = None


class Action(BaseModel):
    type: Literal[
        "irrigate",
        "spray",
        "fertilize",
        "harvest",
        "scout",
        "defer_task",
        "sow_cover_crop",
        "borrow_combine",
        "deliver_to",
    ]
    mm: Optional[float] = Field(default=None, ge=0)  # irrigate depth
    product: Optional[str] = None  # spray: fungicide | insecticide | herbicide
    kg_n_ha: Optional[float] = Field(default=None, ge=0)  # fertilize
    tonnes: Optional[float] = Field(default=None, ge=0)  # deliver_to
    farm: Optional[str] = None  # borrow_combine / deliver_to: the neighbour's exact name
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    reason: Optional[str] = None


class Proposal(BaseModel):
    field: FIELD
    actions: List[Action] = []
    rationale: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    risks: List[str] = []


class ThornEntry(BaseModel):
    field: str
    action: dict
    blocked: bool
    rule: Optional[str] = None


class PlanRow(BaseModel):
    """One row of the plan table: one allowed action on one field."""

    field: FIELD
    crop: str
    action_type: str
    what: str  # "Irrigate 25 mm" · "Harvest ~328 t" · "Deliver 115 t to Gut Rohrdommelsee" · "Wait"
    resources: str  # "6,000 m³ water · 1 worker" · "combine · 2 workers" · "—"
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str


class FarmCensus(BaseModel):
    """What a farm agent (ours or a neighbour's) is asked about."""

    farm: str
    date: str
    storage_free_t: float
    combine_available: int
    ripe_backlog_ha: float
    avg_soil_moisture_pct: float
    scenario: Optional[str] = None


class FarmCapacity(BaseModel):
    """A farm agent's answer."""

    farm: str
    can_share: Dict[str, float]  # {"combine": 0|1, "storage_t": n}
    valid_until: str
    confidence: float = Field(ge=0.0, le=1.0)
    note: str = ""


class Bundle(BaseModel):
    bundle_id: int
    tick: int
    plan_for: str
    summary: str
    proposals: List[Proposal]
    thorn: List[ThornEntry]
    plan_rows: List[PlanRow]
    overall_confidence: Optional[float] = None
    nearby_capacity: List[FarmCapacity] = []
    resources_before: Dict[str, float]  # {"water_m3","workers","combine","sprayer","storage_free_t"} available
    resources_after: Dict[str, float]  # same keys, remaining if the plan is approved
    status: Literal["pending", "approved", "rejected", "expired"] = "pending"
    reason: Optional[str] = None


class DecideRequest(BaseModel):
    bundle_id: int
    decision: Literal["approve", "reject"]
    reason: Optional[str] = None
