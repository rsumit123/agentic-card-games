from __future__ import annotations

from fastapi import APIRouter, Depends

from ..ai.policy import TIERS, model_label_for_tier, policy_for_tier
from ..auth import AuthenticatedUser, require_user

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/tiers")
def tiers(_user: AuthenticatedUser = Depends(require_user)):
    """The house players a host can seat, and which model plays each one."""
    return {
        "tiers": [
            {
                "tier": tier,
                "model": policy_for_tier(tier).model_pool[0],
                "label": model_label_for_tier(tier),
            }
            for tier in TIERS
        ]
    }
