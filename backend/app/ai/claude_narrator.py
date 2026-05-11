import re
import logging
import anthropic
from app.core.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a Customer Success analyst reviewing account health signals.
Write a churn risk assessment based on the data provided. Respond in exactly this format:

ASSESSMENT: <3-5 sentences on churn risk level and key drivers>
ACTIONS:
1. <specific next action for the CSM>
2. <specific next action for the CSM>
3. <specific next action for the CSM>

Be specific. Reference the signals provided. Do not mention the customer by name."""

def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

def mask_pii(text: str) -> str:
    text = re.sub(r'\S+@\S+\.\S+', '[EMAIL]', text)
    text = re.sub(r'[\+\d][\d\s\-\(\)\.]{6,}\d', '[PHONE]', text)
    return text

def arr_band(arr: float | None) -> str:
    if arr is None:
        return "unknown"
    if arr < 50_000:
        return "<$50k"
    if arr < 200_000:
        return "$50k–$200k"
    return ">$200k"

def build_context(
    tier: str,
    arr: float | None,
    days_to_renewal: int,
    signal_scores: dict[str, float],
    weights: dict[str, float],
    ml_result,
    open_tasks: int,
    high_priority_tasks: int,
    nps_scores: list[int],
    notes: list[str],
    playbook_trigger_count: int,
) -> str:
    lines = [
        f"Account tier: {tier}",
        f"ARR band: {arr_band(arr)}",
        f"Days to renewal: {days_to_renewal}",
        "",
        "Signal scores (0-100, higher = healthier):",
    ]
    for signal, score in signal_scores.items():
        w = weights.get(signal, 0)
        lines.append(f"  {signal}: {score:.0f} (weight {w:.0%})")
    if ml_result:
        lines += [
            "",
            f"ML churn probability: {ml_result.ml_probability:.0%}",
            f"Top risk factors: {', '.join(ml_result.top_features)}",
        ]
    lines += [
        "",
        f"Open tasks: {open_tasks} ({high_priority_tasks} high-priority)",
        f"NPS scores (recent): {nps_scores if nps_scores else 'none'}",
        f"Playbook triggers (last 30d): {playbook_trigger_count}",
    ]
    if notes:
        lines += ["", "Recent CSM notes:"]
        for note in notes:
            lines.append(f"  - {mask_pii(note)}")
    return "\n".join(lines)

def generate(
    tier: str,
    arr: float | None,
    days_to_renewal: int,
    signal_scores: dict[str, float],
    weights: dict[str, float],
    ml_result,
    open_tasks: int,
    high_priority_tasks: int,
    nps_scores: list[int],
    notes: list[str],
    playbook_trigger_count: int,
) -> str | None:
    context = build_context(
        tier=tier, arr=arr, days_to_renewal=days_to_renewal,
        signal_scores=signal_scores, weights=weights, ml_result=ml_result,
        open_tasks=open_tasks, high_priority_tasks=high_priority_tasks,
        nps_scores=nps_scores, notes=notes,
        playbook_trigger_count=playbook_trigger_count,
    )
    try:
        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": context}],
        )
        return response.content[0].text
    except Exception as e:
        logger.warning(f"Claude narrator failed: {e}")
        return None
