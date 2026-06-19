"""
Sentinel v2.0 — Guardian AI Module
Generates intelligent narrative alerts from telemetry data.
"""

import os
import json
import urllib.request
from datetime import datetime


def get_time_context():
    hour = datetime.now().hour
    if 0 <= hour < 5: return "late night"
    elif 5 <= hour < 7: return "early morning"
    elif 7 <= hour < 12: return "morning"
    elif 12 <= hour < 17: return "afternoon"
    elif 17 <= hour < 20: return "evening"
    elif 20 <= hour < 22: return "night"
    else: return "late night"


def get_risk_level(score):
    if score >= 80: return "CRITICAL"
    elif score >= 60: return "HIGH"
    elif score >= 40: return "ELEVATED"
    return "MODERATE"


def get_road_name(lat, lng):
    """Reverse geocode lat/lng to a road or place name using OpenStreetMap Nominatim."""
    try:
        # Nominatim requires a user-agent header
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=18&addressdetails=1"
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'SentinelSafetyPlatform/2.0 (contact@sentinelsafety.org)'}
        )
        # Timeout after 3 seconds to avoid blocking
        with urllib.request.urlopen(req, timeout=3.0) as response:
            data = json.loads(response.read().decode('utf-8'))
            address = data.get("address", {})
            # Look for road first, then other identifiers
            road = address.get("road") or address.get("pedestrian") or address.get("suburb") or address.get("neighbourhood") or address.get("city") or "Unknown Location"
            return road
    except Exception as e:
        print(f"⚠️ Reverse geocoding failed: {e}")
        return "GPS Location"


def generate_narrative(user_name, trigger_type, confidence_score, lat, lng, signal_chain, address="", battery_level=None, speed=None):
    road_name = address if address else get_road_name(lat, lng)
    
    # Try using Gemini if API key is in environment
    api_key = os.environ.get("GEMINI_API_KEY")
    if api_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            
            # Format context for Gemini
            signals_str = ", ".join([f"{s.get('type')}: {s.get('detail')}" for s in signal_chain]) if signal_chain else trigger_type
            prompt = (
                f"You are Sentinel's Guardian AI emergency notification system. Write a short, urgent, "
                f"highly informative alert message suitable for SMS/messaging to family/guardians. "
                f"Use the following user data:\n"
                f"- User Name: {user_name}\n"
                f"- Nearest Road: {road_name}\n"
                f"- Speed: {f'{speed:.1f} km/h' if speed is not None else 'unknown'}\n"
                f"- Signals Detected: {signals_str}\n"
                f"- Battery Level: {f'{battery_level:.0f}%' if battery_level is not None else 'unknown'}\n"
                f"- Confidence Score: {confidence_score}/100\n\n"
                f"Guidelines:\n"
                f"1. Start with 'Possible assault detected' or '🚨 URGENT: Potential emergency detected'.\n"
                f"2. Mention if the user stopped moving or what speed they are moving near {road_name}.\n"
                f"3. Summarize the signals detected (like impact and distress keywords) in a natural sentence.\n"
                f"4. Keep it extremely concise and direct (under 160 characters if possible).\n"
                f"5. Output ONLY the alert message itself, without quotes or additional text."
            )
            
            model = genai.GenerativeModel('gemini-1.5-flash')
            response = model.generate_content(prompt)
            generated_text = response.text.strip()
            if generated_text:
                return generated_text
        except Exception as gemini_err:
            print(f"⚠️ Gemini generation failed, falling back to rule-based template: {gemini_err}")
            
    # Fallback / Default Rule-Based System (matches requested structure exactly)
    prefix = "Possible assault detected"
    
    # Movement/Location clause
    movement = ""
    if speed is not None:
        if speed < 0.5:
            movement = f"User stopped moving near {road_name}"
        else:
            movement = f"User moving at {speed:.1f} km/h near {road_name}"
    else:
        # Default assumption if triggered by impact/distress is that they might be stationary or need help
        movement = f"User stopped moving near {road_name}"
        
    # Signals clause
    sig_types = [s.get("type", "") for s in signal_chain] if signal_chain else []
    
    signals_desc = ""
    if "impact" in sig_types and "keyword" in sig_types:
        signals_desc = "Impact + distress voice detected"
    elif "impact" in sig_types and "running" in sig_types:
        signals_desc = "Impact + sudden running detected"
    elif "impact" in sig_types:
        signals_desc = "Phone impact/drop detected"
    elif "keyword" in sig_types:
        signals_desc = "Distress voice detected"
    elif "no_response" in sig_types:
        signals_desc = "User unresponsive to safety check"
    else:
        signals_desc = f"{trigger_type} detected"
        
    narrative = f"{prefix}. {movement}. {signals_desc}."
    
    # Append battery warning if critical
    if battery_level is not None and battery_level < 15:
        narrative += f" ⚡ Battery low: {battery_level:.0f}%."
        
    return narrative


def generate_shadow_narrative(user_name, lat, lng, safe_zone="", eta_mins=0):
    time_str = datetime.now().strftime("%I:%M %p")
    n = f"👻 SHADOW ALERT — '{user_name}' reported being followed at {time_str}. 📍 {lat:.6f}, {lng:.6f}. Silent recording active. "
    if safe_zone:
        n += f"Nearest safe zone: {safe_zone} (~{eta_mins} min). "
    n += "Evidence preserved."
    return n
