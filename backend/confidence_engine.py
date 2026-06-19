"""
Sentinel v2.0 — Confidence Engine
Multi-signal weighted scoring to eliminate false positives.
"""

from datetime import datetime


# Signal weights
SIGNAL_WEIGHTS = {
    "keyword": 40,      # Danger keyword detected via NLP
    "impact": 30,       # Phone drop/impact via accelerometer
    "running": 20,      # Running detected after impact
    "no_response": 0,   # User didn't respond to safety popup (disabled weight)
    "night": 10,        # Between 10 PM and 5 AM
    "unsafe_zone": 10,  # In known unsafe area from heatmap
    "low_battery": 5,   # Battery < 15% during night
    "manual": 100,      # Manual SOS = instant trigger
}

SOS_THRESHOLD = 70


def is_nighttime():
    hour = datetime.now().hour
    return hour >= 22 or hour < 5


def calculate_confidence(signals: list) -> dict:
    """
    Calculate confidence score from multiple signals.
    
    signals: list of dicts like [{"type": "keyword", "detail": "help me"}, {"type": "impact"}]
    
    Returns: {"score": int, "triggered": bool, "breakdown": [...]}
    """
    total = 0
    breakdown = []
    
    for signal in signals:
        sig_type = signal.get("type", "")
        weight = SIGNAL_WEIGHTS.get(sig_type, 0)
        
        if weight > 0:
            total += weight
            breakdown.append({
                "signal": sig_type,
                "score": weight,
                "detail": signal.get("detail", ""),
                "running_total": total
            })
    
    # Auto-add night bonus if applicable
    if is_nighttime() and not any(s.get("type") == "night" for s in signals):
        night_weight = SIGNAL_WEIGHTS["night"]
        total += night_weight
        breakdown.append({
            "signal": "night",
            "score": night_weight,
            "detail": "Auto-detected: high-risk hours",
            "running_total": total
        })
    
    triggered = total >= SOS_THRESHOLD
    
    return {
        "score": min(total, 100),
        "threshold": SOS_THRESHOLD,
        "triggered": triggered,
        "breakdown": breakdown,
        "is_night": is_nighttime()
    }


def evaluate_scenario(keyword=None, impact=False, running=False, no_response=False, unsafe_zone=False, low_battery=False, manual=False):
    """Helper to quickly evaluate a scenario."""
    signals = []
    if manual:
        signals.append({"type": "manual", "detail": "User pressed SOS"})
    if keyword:
        signals.append({"type": "keyword", "detail": keyword})
    if impact:
        signals.append({"type": "impact", "detail": "Accelerometer spike"})
    if running:
        signals.append({"type": "running", "detail": "Post-impact acceleration"})
    if no_response:
        signals.append({"type": "no_response", "detail": "15s timeout"})
    if unsafe_zone:
        signals.append({"type": "unsafe_zone", "detail": "Heatmap match"})
    if low_battery:
        signals.append({"type": "low_battery", "detail": "Battery < 15%"})
    
    return calculate_confidence(signals)
