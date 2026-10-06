"""Copy of the frozen Action/Proposal/FarmCapacity schemas from hub/hub/schemas.py.

Kept independent of hub/ on purpose: petal agents must not import hub code.
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
    farm: Optional[str] = None  # borrow_combine / deliver_to: neighbour's exact name
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    reason: Optional[str] = None


class Proposal(BaseModel):
    field: FIELD
    actions: List[Action] = []
    rationale: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    risks: List[str] = []


class FarmCapacity(BaseModel):
    """A farm agent's answer, for agent.unit == "FARM"."""

    farm: str
    can_share: Dict[str, float]  # {"combine": 0|1, "storage_t": n}
    valid_until: str
    confidence: float = Field(ge=0.0, le=1.0)
    note: str = ""
