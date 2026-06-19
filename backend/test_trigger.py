import json
import urllib.request

payload = {
    "user_id": 1,
    "user_name": "Jane Doe Test",
    "trigger_type": "Manual Test Alert",
    "lat": 19.0760,
    "lng": 72.8777,
    "battery_level": 95,
    "speed": 0,
    "confidence_score": 100,
    "signal_chain": [{"type": "manual", "detail": "Pressed physical panic button"}]
}

req = urllib.request.Request(
    "http://127.0.0.1:8000/api/v1/sos/trigger",
    data=json.dumps(payload).encode('utf-8'),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as res:
        print("STATUS:", res.status)
        print("RESPONSE:", res.read().decode())
except Exception as e:
    print("ERROR:", e)
