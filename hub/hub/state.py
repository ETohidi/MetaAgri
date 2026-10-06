"""In-memory farm twin state: fields, weather, resources, neighbour farms, log, plans."""
import os
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from hub import weather
from hub.clock import date_label, long_date
from hub.schemas import FarmCensus, FieldCensus, Resources, Weather

FIELDS = ["North", "West", "River"]

# Display name for a field acting as a proposer (log actor, plan attribution) - distinct
# from the field's own name, which stays "North"/"West"/"River" everywhere (schema
# fields, URLs) since that's the physical field, not the AI making the proposal.
FIELD_AGENT_NAME = {"North": "North field agent", "West": "West field agent", "River": "River field agent"}
FIELD_DISPLAY_NAME = {"North": "North field", "West": "West field", "River": "River field"}

# kc = crop coefficient while growing; price for value-at-risk; cereal = ripens & needs combine
CROPS = {
    "winter wheat": {"kc": 0.45, "stress_threshold": 35, "price_eur_t": 220, "cereal": True, "daily_ripe_loss": 0.01, "emoji": "🌾"},
    "rapeseed": {"kc": 0.40, "stress_threshold": 30, "price_eur_t": 460, "cereal": True, "daily_ripe_loss": 0.02, "emoji": "🌼"},
    "potatoes": {"kc": 1.10, "stress_threshold": 60, "price_eur_t": 160, "cereal": False, "daily_ripe_loss": 0.0, "emoji": "🥔"},
}
KC_HARVESTED = 0.2  # bare stubble
KC_COVER_CROP = 0.5

SEED_FIELDS = {
    "North": {"crop": "winter wheat", "area_ha": 42, "days_to_harvest": 4, "soil_moisture": 48, "irrigable": False, "yield_t_ha": 7.8, "health": 0.86, "disease": 0.15},
    "West": {"crop": "rapeseed", "area_ha": 30, "days_to_harvest": 3, "soil_moisture": 44, "irrigable": False, "yield_t_ha": 3.9, "health": 0.84, "disease": 0.10},
    "River": {"crop": "potatoes", "area_ha": 24, "days_to_harvest": 48, "soil_moisture": 62, "irrigable": True, "yield_t_ha": 42.0, "health": 0.90, "disease": 0.35},
}

OWN_FARM_NAME = "Hof Lerchenbruch"
NEIGHBOUR_FARM_SEEDS = {
    "Gut Rohrdommelsee": {"storage_capacity_t": 900, "storage_used_t": 380, "combine_busy_prob": 0.10, "cereal_heavy": False,
                       "avg_soil_moisture": 52, "crops": "maize, sugar beet", "area_ha": 310},
    "Agrarhof Oderblick": {"storage_capacity_t": 600, "storage_used_t": 420, "combine_busy_prob": 0.60, "cereal_heavy": True,
                           "avg_soil_moisture": 45, "crops": "wheat, rapeseed, barley", "area_ha": 240},
}
FARM_NAMES = [OWN_FARM_NAME, *NEIGHBOUR_FARM_SEEDS]
FARM_IDS = {"lerchenbruch": "Hof Lerchenbruch", "rohrdommelsee": "Gut Rohrdommelsee", "oderblick": "Agrarhof Oderblick"}
FARM_ID_BY_NAME = {name: farm_id for farm_id, name in FARM_IDS.items()}
FARM_COORDS = {"Hof Lerchenbruch": (52.655, 14.300), "Gut Rohrdommelsee": (52.712, 14.170), "Agrarhof Oderblick": (52.585, 14.455)}  # (lat, lon)
REGION_NAME = "Oderbruch"
REGION_COORD = (52.64, 14.30)
FARMYARD_COORD = (52.6545, 14.2990)
FIELD_POLYGONS = {  # closed rings of [lon, lat]; areas ≈ area_ha
    "North": [[14.2950, 52.6575], [14.3045, 52.6575], [14.3045, 52.6635], [14.2950, 52.6635], [14.2950, 52.6575]],
    "West": [[14.2860, 52.6505], [14.2935, 52.6505], [14.2935, 52.6560], [14.2860, 52.6560], [14.2860, 52.6505]],
    "River": [[14.3040, 52.6480], [14.3105, 52.6480], [14.3105, 52.6530], [14.3040, 52.6530], [14.3040, 52.6480]],
}

WATER_PERMIT_NORMAL_M3 = 6500  # daily abstraction permit
WATER_PERMIT_HEATWAVE_M3 = 3600  # the authority cuts it during a heatwave
COMBINES, SPRAYERS, WORKERS = 1, 1, 5
STORAGE_CAPACITY_T, STORAGE_SEED_USED_T = 450, 120
M3_PER_MM_HA = 10  # 1 mm on 1 ha = 10 m³

# A cereal-heavy neighbour rushes its own ripe crop in before a hail storm.
NEIGHBOUR_HAIL_BACKLOG_SHARE = 0.25
SURPLUS_NOISE_T = 0.5  # less than this isn't a sale or a trailer trip (same as stem.SURPLUS_MIN_T)
NEIGHBOUR_HINT = (
    "The farm manager suggested a neighbour farm could help - propose the harvest as usual; "
    "the Machinery ring will line up a neighbour's combine or silo space if ours can't cope."
)


@dataclass
class FieldState:
    name: str
    crop: str
    area_ha: float
    days_to_harvest: int
    soil_moisture: float
    irrigable: bool
    yield_t_ha: float
    health: float
    disease: float
    harvested: bool = False
    cover_crop: bool = False
    harvested_t: float = 0.0
    harvest_waiting_days: int = 0
    last_irrigated_tick: Optional[int] = None
    last_sprayed_tick: Optional[int] = None
    recent_rejections: List[str] = field(default_factory=list)

    @property
    def cereal(self) -> bool:
        return CROPS[self.crop]["cereal"]

    @property
    def stress_threshold(self) -> float:
        return CROPS[self.crop]["stress_threshold"]

    @property
    def short_crop(self) -> str:
        """'winter wheat' -> 'wheat', for plain-language text."""
        return self.crop.split()[-1]

    @property
    def harvest_ready(self) -> bool:
        return not self.harvested and self.days_to_harvest <= 0

    @property
    def kc(self) -> float:
        if self.harvested:
            return KC_COVER_CROP if self.cover_crop else KC_HARVESTED
        return CROPS[self.crop]["kc"]

    @property
    def yield_estimate_t(self) -> float:
        """Standing crop estimate; once harvested, what actually came off the field."""
        if self.harvested:
            return self.harvested_t
        return round(self.area_ha * self.yield_t_ha * min(1.0, self.health / 0.85), 1)

    @property
    def stage(self) -> str:
        if self.harvested:
            return "cover crop" if self.cover_crop else "harvested"
        if self.cereal:
            if self.days_to_harvest <= 0:
                return "harvest-ready"
            return "ripening" if self.days_to_harvest <= 7 else "grain fill"
        return "tuber bulking" if self.days_to_harvest > 14 else "maturing"


class HubState:
    def __init__(self) -> None:
        self.reset()

    # -- lifecycle -----------------------------------------------------
    def reset(self, seed: Optional[int] = None) -> None:
        if seed is None and os.environ.get("METAAGRI_SEED", "").strip():
            seed = int(os.environ["METAAGRI_SEED"])
        if seed is not None:
            random.seed(seed)
        self.seed = seed

        self.tick = 0
        self.next_bundle_id = 1
        self.fields: Dict[str, FieldState] = {name: FieldState(name=name, **cfg) for name, cfg in SEED_FIELDS.items()}
        self.water_permit_m3 = WATER_PERMIT_NORMAL_M3
        self.storage_used_t = float(STORAGE_SEED_USED_T)
        # Grain an approved plan harvested beyond the silo's free space, waiting for a
        # deliver_to in the same plan (else sold directly to the co-op).
        self.pending_surplus_t = 0.0
        self.own_combine_busy = False  # our combine already worked a field today
        self.heatwave_days_remaining = 0  # counts today as the first remaining day
        self.hail_tick: Optional[int] = None

        self.weather_today = weather.normal_day(0)
        self.forecast = [weather.normal_day(t) for t in range(1, weather.FORECAST_DAYS + 1)]

        self.neighbours: Dict[str, dict] = {
            name: {
                **cfg,
                "storage_used_t": float(cfg["storage_used_t"]),
                "avg_soil_moisture": float(cfg["avg_soil_moisture"]),
                "combine_available": 1 if random.random() > cfg["combine_busy_prob"] else 0,
            }
            for name, cfg in NEIGHBOUR_FARM_SEEDS.items()
        }

        self.bundles: List[dict] = []
        self.log: List[dict] = []
        self.notices: List[dict] = []
        self.pending_flower_proposals: Dict[str, dict] = {}
        self.pending_farm_capacity: Dict[str, dict] = {}
        # Last known answer from each farm agent (incl. our own), refreshed by the
        # Machinery ring every tick. Keyed by farm name.
        self.nearby_capacity: Dict[str, dict] = {}
        self.history: Dict[str, List[dict]] = {f: [] for f in FIELDS}
        self.farm_history: Dict[str, List[dict]] = {name: [] for name in FARM_NAMES}
        # For the hero SVG's animations: set by an approved plan, cleared by the next day
        # (a stateless server-rendered SVG can't know "has the viewer already seen this", so
        # the animation just loops while the event is still the most recent one).
        self.recent_actions: List[dict] = []
        self.recent_proposals: List[str] = []

        self.record_history()
        self.record_farm_history()
        seed_note = f" (seed {seed})" if seed is not None else ""
        self.add_log(actor="Farm", level="info", text=f"season reset / seeded{seed_note}")

    # -- helpers ---------------------------------------------------------
    def date(self) -> str:
        return date_label(self.tick)

    def long_date(self) -> str:
        return long_date(self.tick)

    @property
    def storage_free_t(self) -> float:
        return max(0.0, STORAGE_CAPACITY_T - self.storage_used_t)

    @property
    def hail_warning_active(self) -> bool:
        return self.hail_tick is not None

    def heatwave_message(self) -> str:
        return f"heatwave: water permit cut to {WATER_PERMIT_HEATWAVE_M3:,} m³/day"

    def hail_message(self) -> str:
        return f"hail warning: severe hail expected {date_label(self.hail_tick)}"

    def scenario_messages(self) -> List[str]:
        messages = []
        if self.heatwave_days_remaining > 0:
            messages.append(self.heatwave_message())
        if self.hail_warning_active:
            messages.append(self.hail_message())
        return messages

    @property
    def scenario(self) -> Optional[str]:
        messages = self.scenario_messages()
        return " · ".join(messages) if messages else None

    def add_log(self, actor: str, level: str, text: str) -> None:
        self.log.append({"tick": self.tick, "date": self.date(), "actor": actor, "text": text, "level": level})

    def add_notice(self, audience: str, text: str) -> None:
        self.notices.append({"tick": self.tick, "date": self.date(), "audience": audience, "text": text})
        self.notices = self.notices[-30:]

    def own_avg_soil_moisture(self) -> float:
        total_area = sum(f.area_ha for f in self.fields.values())
        return round(sum(f.soil_moisture * f.area_ha for f in self.fields.values()) / total_area, 1)

    def own_combine_available(self) -> int:
        return 0 if self.own_combine_busy else COMBINES

    # -- field census, for a field agent ------------------------------------
    def resources(self) -> Resources:
        return Resources(
            water_permit_m3=self.water_permit_m3,
            workers=WORKERS,
            combine=COMBINES,
            sprayer=SPRAYERS,
            storage_free_t=round(self.storage_free_t, 1),
        )

    def census(self, name: str) -> FieldCensus:
        f = self.fields[name]
        hint = NEIGHBOUR_HINT if any("neighbour farm" in r.lower() for r in f.recent_rejections) else None
        return FieldCensus(
            tick=self.tick,
            date=self.date(),
            field=name,
            crop=f.crop,
            area_ha=f.area_ha,
            stage=f.stage,
            days_to_harvest=f.days_to_harvest,
            harvest_ready=f.harvest_ready,
            harvested=f.harvested,
            cover_crop=f.cover_crop,
            irrigable=f.irrigable,
            soil_moisture_pct=round(f.soil_moisture, 1),
            stress_threshold_pct=f.stress_threshold,
            crop_health=round(f.health, 3),
            disease_pressure=round(f.disease, 3),
            yield_estimate_t=f.yield_estimate_t,
            days_since_sprayed=None if f.last_sprayed_tick is None else self.tick - f.last_sprayed_tick,
            days_since_irrigated=None if f.last_irrigated_tick is None else self.tick - f.last_irrigated_tick,
            weather_today=Weather(**self.weather_today),
            forecast=[Weather(**w) for w in self.forecast],
            resources=self.resources(),
            recent_rejections=list(f.recent_rejections),
            scenario=self.scenario,
            hint=hint,
        )

    # -- farm-level census, for a farm agent (ours or a neighbour's) ---------
    def farm_census(self, farm_name: str) -> FarmCensus:
        if farm_name == OWN_FARM_NAME:
            storage_free = self.storage_free_t
            combine = self.own_combine_available()
            backlog = sum(f.area_ha for f in self.fields.values() if f.harvest_ready)
            moisture = self.own_avg_soil_moisture()
        else:
            n = self.neighbours[farm_name]
            storage_free = max(0.0, n["storage_capacity_t"] - n["storage_used_t"])
            combine = n["combine_available"]
            # No per-field model for neighbours: a cereal-heavy farm has ripe crop of its
            # own to get in before a hail storm, otherwise no backlog.
            backlog = n["area_ha"] * NEIGHBOUR_HAIL_BACKLOG_SHARE if (n["cereal_heavy"] and self.hail_warning_active) else 0.0
            moisture = n["avg_soil_moisture"]
        return FarmCensus(
            farm=farm_name,
            date=self.date(),
            storage_free_t=round(storage_free, 1),
            combine_available=combine,
            ripe_backlog_ha=round(backlog, 1),
            avg_soil_moisture_pct=round(moisture, 1),
            scenario=self.scenario,
        )

    def farms_summary(self) -> list:
        """One row per farm (ours first), for the map and the farm strip."""
        rows = [
            {
                "farm": OWN_FARM_NAME,
                "id": FARM_ID_BY_NAME[OWN_FARM_NAME],
                "is_own": True,
                "lat": FARM_COORDS[OWN_FARM_NAME][0],
                "lon": FARM_COORDS[OWN_FARM_NAME][1],
                "crops": ", ".join(f.short_crop for f in self.fields.values()),
                "area_ha": sum(f.area_ha for f in self.fields.values()),
                "storage_capacity_t": STORAGE_CAPACITY_T,
                "storage_free_t": round(self.storage_free_t, 1),
                "combine_available": self.own_combine_available(),
                "avg_soil_moisture_pct": self.own_avg_soil_moisture(),
            }
        ]
        for name, n in self.neighbours.items():
            rows.append(
                {
                    "farm": name,
                    "id": FARM_ID_BY_NAME[name],
                    "is_own": False,
                    "lat": FARM_COORDS[name][0],
                    "lon": FARM_COORDS[name][1],
                    "crops": n["crops"],
                    "area_ha": n["area_ha"],
                    "storage_capacity_t": n["storage_capacity_t"],
                    "storage_free_t": round(max(0.0, n["storage_capacity_t"] - n["storage_used_t"]), 1),
                    "combine_available": n["combine_available"],
                    "avg_soil_moisture_pct": round(n["avg_soil_moisture"], 1),
                }
            )
        return rows

    # -- history and projection, for the detail views -------------------------
    def record_history(self) -> None:
        for name, f in self.fields.items():
            self.history[name].append(
                {
                    "tick": self.tick,
                    "date": self.date(),
                    "soil_moisture_pct": round(f.soil_moisture, 1),
                    "crop_health": round(f.health, 3),
                    "rain_mm": self.weather_today["rain_mm"],
                    "irrigation_mm": 0.0,
                    "yield_estimate_t": f.yield_estimate_t,
                }
            )

    def _farm_history_row(self, row: dict) -> dict:
        return {
            "tick": self.tick,
            "date": self.date(),
            "storage_free_t": row["storage_free_t"],
            "avg_soil_moisture_pct": row["avg_soil_moisture_pct"],
            "combine_available": row["combine_available"],
        }

    def record_farm_history(self) -> None:
        for row in self.farms_summary():
            self.farm_history[row["farm"]].append(self._farm_history_row(row))

    def refresh_today_farm_history(self) -> None:
        """An approved plan changes silo space and combines the same day (our harvest, a
        delivery to a neighbour's silo) - rewrite today's rows so the charts match /state."""
        for row in self.farms_summary():
            rows = self.farm_history[row["farm"]]
            if rows and rows[-1]["tick"] == self.tick:
                rows[-1] = self._farm_history_row(row)

    def projection(self, name: str) -> list:
        """Soil moisture over the forecast days if nobody irrigates."""
        f = self.fields[name]
        moisture = f.soil_moisture
        rows = []
        for i, w in enumerate(self.forecast, start=1):
            moisture = max(0.0, min(100.0, moisture + w["rain_mm"] - w["et0_mm"] * f.kc))
            rows.append({"tick": self.tick + i, "date": date_label(self.tick + i), "projected_moisture_pct": round(moisture, 1)})
        return rows

    # -- applying an approved plan -----------------------------------------
    def apply_action(self, name: str, action: dict) -> None:
        f = self.fields[name]
        t = action.get("type")
        if t == "irrigate":
            mm = action.get("mm") or 0.0
            f.soil_moisture = min(100.0, f.soil_moisture + mm)
            f.last_irrigated_tick = self.tick
            today = self.history[name][-1]
            today["irrigation_mm"] = round(today["irrigation_mm"] + mm, 1)
            today["soil_moisture_pct"] = round(f.soil_moisture, 1)
            self.recent_actions.append({"field": name, "kind": "irrigate"})
        elif t == "spray":
            f.last_sprayed_tick = self.tick
            f.disease = max(0.05, f.disease - 0.4)
            self.recent_actions.append({"field": name, "kind": "spray"})
        elif t in ("harvest", "borrow_combine"):
            if f.harvested:
                return
            tonnes = f.yield_estimate_t
            f.harvested = True
            f.harvested_t = tonnes
            stored = min(tonnes, self.storage_free_t)
            self.storage_used_t += stored
            self.pending_surplus_t += tonnes - stored
            if t == "harvest":
                self.own_combine_busy = True
                self.recent_actions.append({"field": name, "kind": "harvest"})
            else:
                self.recent_actions.append({"field": name, "kind": "harvest", "farm": action.get("farm")})
        elif t == "deliver_to":
            farm = action.get("farm")
            n = self.neighbours.get(farm)
            if n is None:
                return
            # Never more than the plan's leftover grain, nor more than really fits in the
            # neighbour's silo (a farm agent may over-report); the rest is sold below.
            fit = max(0.0, n["storage_capacity_t"] - n["storage_used_t"])
            moved = min(action.get("tonnes") or 0.0, self.pending_surplus_t, fit)
            n["storage_used_t"] += moved
            self.pending_surplus_t -= moved
            action["moved_t"] = round(moved, 1)  # what the neighbour's notice reports
            if moved >= SURPLUS_NOISE_T:
                self.recent_actions.append({"field": name, "kind": "deliver", "farm": farm})
        elif t == "sow_cover_crop":
            if f.harvested:  # a cover crop only goes on stubble
                f.cover_crop = True
        elif t == "fertilize":
            f.health = min(0.95, f.health + 0.02)
        # scout, defer_task: logged only, no state change

    def apply_bundle(self, bundle: dict) -> None:
        self.recent_actions = []
        # deliver_to last, so it can move whatever the plan's harvests left over.
        steps = [(p["field"], a) for p in bundle["proposals"] for a in p["actions"]]
        for name, a in steps:
            if a["type"] != "deliver_to":
                self.apply_action(name, a)
        for name, a in steps:
            if a["type"] == "deliver_to":
                self.apply_action(name, a)
        if self.pending_surplus_t >= SURPLUS_NOISE_T:
            self.add_log(
                actor="Farm",
                level="info",
                text=f"sold {self.pending_surplus_t:.0f} t directly to the co-op at the harvest spot price",
            )
        self.pending_surplus_t = 0.0
        self.refresh_today_farm_history()

    # -- full state dump for GET /state ---------------------------------
    def field_dict(self, name: str) -> dict:
        f = self.fields[name]
        return {
            "name": FIELD_DISPLAY_NAME[name],
            "crop": f.crop,
            "emoji": CROPS[f.crop]["emoji"],
            "area_ha": f.area_ha,
            "stage": f.stage,
            "days_to_harvest": f.days_to_harvest,
            "harvest_ready": f.harvest_ready,
            "harvested": f.harvested,
            "cover_crop": f.cover_crop,
            "soil_moisture_pct": round(f.soil_moisture, 1),
            "stress_threshold_pct": f.stress_threshold,
            "irrigable": f.irrigable,
            "crop_health": round(f.health, 3),
            "disease_pressure": round(f.disease, 3),
            "yield_estimate_t": f.yield_estimate_t,
            "harvest_waiting_days": f.harvest_waiting_days,
            "last_irrigated_date": None if f.last_irrigated_tick is None else date_label(f.last_irrigated_tick),
            "last_sprayed_date": None if f.last_sprayed_tick is None else date_label(f.last_sprayed_tick),
            "recent_rejections": list(f.recent_rejections),
            "polygon": FIELD_POLYGONS[name],
        }

    def to_dict(self) -> dict:
        return {
            "tick": self.tick,
            "date": self.date(),
            "long_date": self.long_date(),
            "farm": OWN_FARM_NAME,
            "region": REGION_NAME,
            "fields": {name: self.field_dict(name) for name in FIELDS},
            "weather_today": self.weather_today,
            "forecast": self.forecast,
            "resources": {
                "water_permit_m3": self.water_permit_m3,
                "water_permit_normal_m3": WATER_PERMIT_NORMAL_M3,
                "workers": WORKERS,
                "combine": self.own_combine_available(),
                "sprayer": SPRAYERS,
                "storage_capacity_t": STORAGE_CAPACITY_T,
                "storage_used_t": round(self.storage_used_t, 1),
                "storage_free_t": round(self.storage_free_t, 1),
            },
            "scenario": self.scenario,
            "heatwave_days_remaining": self.heatwave_days_remaining,
            "hail_date": date_label(self.hail_tick) if self.hail_warning_active else None,
            "farms": self.farms_summary(),
            "farmyard": list(FARMYARD_COORD),
            "nearby_capacity": self.nearby_capacity,
            "recent_actions": self.recent_actions,
            "recent_proposals": self.recent_proposals,
            "bundle_count": len(self.bundles),
        }
