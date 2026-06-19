"""
Sentinel v2.0 — Core Backend
Complete safety intelligence platform with:
- Confidence scoring engine
- Guardian AI narrative alerts
- Shadow tracking
- Community heatmap
- Offline queue sync
- Admin dashboard API
- JWT authentication
- Health check endpoint
- Evidence vault listing
"""

from pydub import AudioSegment
from fastapi import FastAPI, BackgroundTasks, UploadFile, File, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from typing import Optional, List
import speech_recognition as sr
import shutil
import time
import os
import json
import glob
from datetime import datetime
from contextlib import asynccontextmanager
import math

from database import (
    init_db, get_db, create_user, get_user_by_email, get_user_by_id, get_all_users,
    update_user_location, update_user_profile, update_emergency_contacts, toggle_user_active,
    create_sos_event, get_sos_event, get_active_sos_events, get_all_sos_events,
    resolve_sos_event, mark_false_alarm,
    create_incident, get_incidents, get_incident_stats,
    create_shadow_session, update_shadow_trail, end_shadow_session,
    get_active_shadow_sessions,
    queue_offline_event, get_unsynced_events, mark_synced,
    log_confidence, get_dashboard_stats
)
from auth import (
    hash_password, verify_password, create_jwt, get_user_from_token,
    ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
)
from guardian_ai import generate_narrative, generate_shadow_narrative
from confidence_engine import calculate_confidence, SOS_THRESHOLD

ffmpeg_path = shutil.which("ffmpeg")
if ffmpeg_path:
    AudioSegment.converter = ffmpeg_path
ffprobe_path = shutil.which("ffprobe")
if ffprobe_path:
    AudioSegment.ffprobe = ffprobe_path

# ============ APP INIT ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    # Startup
    init_db()
    from seed_data import seed_admin_user
    seed_admin_user()
    print("\n" + "="*60)
    print("🛡️  SENTINEL v2.0 — Safety Intelligence Platform")
    print("="*60)
    print("   Admin Panel: http://localhost:8000/admin")
    print("   API Docs:    http://localhost:8000/docs")
    print("   Health:      http://localhost:8000/api/v1/health")
    print("="*60 + "\n")
    yield
    # Shutdown
    print("🛡️  Sentinel shutting down...")

app = FastAPI(
    title="Sentinel v2.0 — Safety Intelligence Platform",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("evidence_vault", exist_ok=True)


# ============ DATA MODELS ============

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    phone: str = ""
    gender: str = ""

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()

    @field_validator('email')
    @classmethod
    def email_valid(cls, v):
        if '@' not in v or '.' not in v:
            raise ValueError('Invalid email format')
        return v.strip().lower()

class LoginRequest(BaseModel):
    email: str
    password: str

class EmergencyPayload(BaseModel):
    user_id: Optional[int] = None
    user_name: str = "Guest"
    trigger_type: str
    lat: float
    lng: float
    battery_level: Optional[float] = None
    speed: Optional[float] = None
    confidence_score: Optional[int] = None
    signal_chain: Optional[List[dict]] = []

class ConfidenceRequest(BaseModel):
    user_id: Optional[int] = None
    signals: List[dict]
    lat: float = 0
    lng: float = 0

class ShadowRequest(BaseModel):
    user_id: Optional[int] = None
    user_name: str = "Guest"
    lat: float
    lng: float

class IncidentReport(BaseModel):
    lat: float
    lng: float
    incident_type: str
    severity: int = 1
    description: str = ""

    @field_validator('severity')
    @classmethod
    def severity_range(cls, v):
        if v < 1 or v > 5:
            raise ValueError('Severity must be between 1 and 5')
        return v

class ContactsUpdate(BaseModel):
    contacts: List[dict]

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None

class OfflineSyncPayload(BaseModel):
    events: List[dict]


# ============ HEALTH CHECK ============

@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint for mobile app connectivity verification."""
    return {
        "status": "healthy",
        "service": "sentinel-v2",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0"
    }


# ============ AUTH ENDPOINTS ============

@app.post("/api/v1/auth/signup")
async def signup(req: SignupRequest):
    existing = get_user_by_email(req.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    pw_hash = hash_password(req.password)
    user = create_user(req.name, req.email, pw_hash, req.phone, req.gender)
    if not user:
        raise HTTPException(status_code=500, detail="Failed to create account")
    
    token = create_jwt(user["id"], user["email"], False)
    print(f"✅ New user registered: {req.name} ({req.email})")
    
    return {
        "token": token,
        "user": {
            "id": user["id"], "name": user["name"],
            "email": user["email"], "phone": user["phone"],
            "gender": user["gender"]
        }
    }

@app.post("/api/v1/auth/login")
async def login(req: LoginRequest):
    user = get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account has been deactivated")
    
    token = create_jwt(user["id"], user["email"], user["is_admin"])
    role = "admin" if user["is_admin"] else "user"
    print(f"🔓 Login: {user['name']} ({role})")
    
    return {
        "token": token,
        "user": {
            "id": user["id"], "name": user["name"],
            "email": user["email"], "is_admin": user["is_admin"],
            "phone": user.get("phone", ""),
            "gender": user.get("gender", ""),
            "emergency_contacts": json.loads(user.get("emergency_contacts", "[]"))
        }
    }

@app.get("/api/v1/auth/me")
async def get_me(authorization: str = Header(None)):
    token_data = get_user_from_token(authorization)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = get_user_by_id(token_data["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user["id"], "name": user["name"],
        "email": user["email"], "is_admin": user["is_admin"],
        "phone": user.get("phone", ""),
        "gender": user.get("gender", ""),
        "emergency_contacts": json.loads(user.get("emergency_contacts", "[]"))
    }


# ============ CONFIDENCE ENGINE ============

@app.post("/api/v1/confidence/evaluate")
async def evaluate_confidence(req: ConfidenceRequest):
    result = calculate_confidence(req.signals)
    
    if req.user_id:
        log_confidence(req.user_id, json.dumps([s["type"] for s in req.signals]),
                      result["score"], result["score"], result["triggered"])
    
    print(f"🧠 Confidence: {result['score']}/100 | Triggered: {result['triggered']} | Signals: {[s.get('type') for s in req.signals]}")
    return result


# ============ SOS / EMERGENCY ============

@app.post("/api/v1/sos/trigger")
async def handle_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    # Generate Guardian AI narrative
    narrative = generate_narrative(
        user_name=payload.user_name,
        trigger_type=payload.trigger_type,
        confidence_score=payload.confidence_score or 70,
        lat=payload.lat, lng=payload.lng,
        signal_chain=payload.signal_chain or [],
        battery_level=payload.battery_level,
        speed=payload.speed
    )
    
    # Store in database
    event = create_sos_event(
        user_id=payload.user_id,
        user_name=payload.user_name,
        trigger_type=payload.trigger_type,
        confidence_score=payload.confidence_score or 70,
        lat=payload.lat, lng=payload.lng,
        narrative=narrative,
        signal_chain=json.dumps(payload.signal_chain or [])
    )
    
    # Update user location
    if payload.user_id:
        update_user_location(payload.user_id, payload.lat, payload.lng)
    
    # Load emergency contacts
    guardians = []
    if payload.user_id:
        user_data = get_user_by_id(payload.user_id)
        if user_data and user_data.get("emergency_contacts"):
            try:
                guardians = json.loads(user_data["emergency_contacts"])
            except Exception as json_err:
                print(f"⚠️ Failed to parse user emergency contacts: {json_err}")

    print("\n" + "🚨"*25)
    print(f"[GUARDIAN AI ALERT]")
    print(narrative)
    print("🚨"*25 + "\n")

    # Simulate sending SMS notifications to family/guardians
    print("📲"*25)
    print("[SIMULATED SMS NOTIFICATIONS TO FAMILY/GUARDIANS]")
    if guardians:
        for g in guardians:
            g_name = g.get("name", "Guardian")
            g_phone = g.get("phone", "Unknown")
            g_relation = g.get("relation", "Family")
            print(f"  ↳ SMS Sent to {g_name} ({g_relation}) at {g_phone}: '{narrative}'")
    else:
        print("  ⚠️ No Emergency Guardians registered for this user.")
    print("📲"*25 + "\n")
    
    return {
        "status": "active",
        "event_id": event["id"],
        "narrative": narrative,
        "confidence_score": payload.confidence_score or 70,
        "timestamp": time.time(),
        "guardians_notified": guardians
    }


@app.get("/api/v1/sos/status/{event_id}")
async def get_sos_status(event_id: int):
    event = get_sos_event(event_id)
    if event:
        return {"status": event.get("status", "unknown")}
    return {"status": "unknown"}


@app.post("/api/v1/sos/analyze-audio")
async def analyze_audio(file: UploadFile = File(...)):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    # Save the incoming mobile file as .m4a first
    mobile_audio_path = f"temp_mobile_{timestamp}.m4a"
    clean_wav_path = f"temp_clean_{timestamp}.wav"
    
    try:
        # 1. Save the raw file from the phone
        with open(mobile_audio_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 2. Convert the mobile audio to pure PCM WAV for the recognizer
        try:
            audio = AudioSegment.from_file(mobile_audio_path)
            audio.export(clean_wav_path, format="wav")
        except Exception as conv_err:
            import traceback
            print(f"⚠️ Audio Conversion Failed: {conv_err}")
            traceback.print_exc() # Prints exactly why it failed to the terminal
            return {"danger_detected": False, "error": f"Conversion failed: {str(conv_err)}", "transcript": "[Silence]", "confidence_contribution": 0}

        # 3. Analyze the clean WAV file
        recognizer = sr.Recognizer()
        with sr.AudioFile(clean_wav_path) as source:
            # Adjust for ambient noise so it hears you better
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            audio_data = recognizer.record(source)
            text = recognizer.recognize_google(audio_data).lower()
            print(f"🎙️ [Transcript]: {text}")

            danger_keywords = ["help", "save me", "stop it", "police",
                             "leave me alone", "bachao", "chhodo",
                             "please help", "someone help", "don't touch",
                             "let me go", "fire", "emergency", "danger",
                             "get away", "stay away", "call police",
                             "madad karo", "koi hai", "please stop"]
            
            is_danger = any(word in text for word in danger_keywords)
            matched = [w for w in danger_keywords if w in text]
            
            if is_danger:
                print("⚠️ [THREAT DETECTED] Saving to Evidence Vault...")
                vault_audio = f"evidence_vault/threat_{timestamp}.wav"
                vault_text = f"evidence_vault/transcript_{timestamp}.txt"
                shutil.move(clean_wav_path, vault_audio)
                with open(vault_text, "w") as f:
                    f.write(f"Time: {timestamp}\nTranscript: {text}\nMatched: {matched}")
                
                return {
                    "danger_detected": True,
                    "transcript": text,
                    "matched_keywords": matched,
                    "confidence_contribution": 40
                }
            
            return {"danger_detected": False, "transcript": text, "confidence_contribution": 0}
            
    except sr.UnknownValueError:
        return {"danger_detected": False, "transcript": "[Silence]", "confidence_contribution": 0}
    except Exception as e:
        print(f"❌ Backend Error: {str(e)}")
        return {"danger_detected": False, "error": str(e), "confidence_contribution": 0}
    finally:
        # Clean up temporary files
        if os.path.exists(mobile_audio_path):
            os.remove(mobile_audio_path)
        
        danger = locals().get('is_danger', False)
        if not danger and os.path.exists(clean_wav_path):
            os.remove(clean_wav_path)


# ============ EVIDENCE VAULT ============

@app.get("/api/v1/evidence/list")
async def list_evidence(authorization: str = Header(None)):
    """List all evidence files from the vault."""
    evidence = []
    vault_dir = os.path.join(os.path.dirname(__file__), "evidence_vault")
    
    # Get all transcript files
    for txt_file in sorted(glob.glob(os.path.join(vault_dir, "transcript_*.txt")), reverse=True):
        try:
            with open(txt_file, "r") as f:
                content = f.read()
            
            # Extract timestamp from filename
            basename = os.path.basename(txt_file)
            ts = basename.replace("transcript_", "").replace(".txt", "")
            
            # Check for matching audio file
            audio_file = os.path.join(vault_dir, f"threat_{ts}.wav")
            has_audio = os.path.exists(audio_file)
            
            evidence.append({
                "id": ts,
                "timestamp": ts,
                "transcript": content,
                "has_audio": has_audio,
                "audio_url": f"/api/v1/evidence/audio/{ts}" if has_audio else None
            })
        except Exception:
            continue
    
    return {"evidence": evidence, "count": len(evidence)}


@app.get("/api/v1/evidence/audio/{evidence_id}")
async def get_evidence_audio(evidence_id: str):
    """Serve an evidence audio file."""
    from fastapi.responses import FileResponse
    audio_path = os.path.join(os.path.dirname(__file__), "evidence_vault", f"threat_{evidence_id}.wav")
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(audio_path, media_type="audio/wav")


# ============ SHADOW TRACKING ============

@app.post("/api/v1/shadow/activate")
async def activate_shadow(req: ShadowRequest):
    session_id = create_shadow_session(req.user_id, req.lat, req.lng)
    
    narrative = generate_shadow_narrative(
        req.user_name, req.lat, req.lng,
        safe_zone="Nearest Police Station", eta_mins=7
    )
    
    print(f"\n👻 SHADOW MODE ACTIVATED for {req.user_name}")
    print(f"   Session ID: {session_id}")
    print(f"   {narrative}\n")
    
    return {
        "session_id": session_id,
        "status": "active",
        "narrative": narrative,
        "nearest_safe_zone": {
            "name": "Nearest Police Station",
            "eta_minutes": 7
        }
    }

@app.post("/api/v1/shadow/update/{session_id}")
async def update_shadow(session_id: int, lat: float = 0, lng: float = 0):
    return {"status": "tracking", "session_id": session_id}

@app.post("/api/v1/shadow/end/{session_id}")
async def end_shadow(session_id: int, lat: float = 0, lng: float = 0):
    end_shadow_session(session_id, lat, lng)
    return {"status": "ended", "session_id": session_id}

import math

# --- Add this helper function ---
def calculate_distance_meters(lat1, lon1, lat2, lon2):
    """Haversine formula to calculate distance between two lat/lng coordinates."""
    R = 6371e3 # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

# --- Add this new Data Model ---
class ShadowBroadcastRequest(BaseModel):
    user_id: Optional[int] = None
    user_name: str = "Guest"
    lat: float
    lng: float
    radius: int = 200

# --- Add this new Endpoint ---
@app.post("/api/v1/shadow/activate-and-broadcast")
async def activate_and_broadcast_shadow(req: ShadowBroadcastRequest):
    session_id = create_shadow_session(req.user_id, req.lat, req.lng)
    
    narrative = generate_shadow_narrative(
        req.user_name, req.lat, req.lng,
        safe_zone="Nearest Safe Zone", eta_mins=7
    )
    
    # 200m Geofence Broadcast Logic
    nearby_users_alerted = 0
    all_users = get_all_users() # Pulls all active users from database
    
    for u in all_users:
        # Ensure the user has a known location and isn't the person triggering the alarm
        if u.get("last_lat") and u.get("last_lng") and u.get("id") != req.user_id:
            distance = calculate_distance_meters(req.lat, req.lng, u["last_lat"], u["last_lng"])
            
            if distance <= req.radius:
                nearby_users_alerted += 1
                # Here is where you would hook in Firebase Cloud Messaging (FCM) 
                # or Apple Push Notification Service (APNs)
                print(f"📲 [GEOFENCE ALERT] Push notification dispatched to User #{u['id']} ({distance:.1f}m away)")

    print(f"\n👻 SHADOW MODE + GEOFENCE BROADCAST ACTIVATED for {req.user_name}")
    print(f"   Session ID: {session_id}")
    print(f"   Alerted {nearby_users_alerted} users within {req.radius} meters.")
    print(f"   {narrative}\n")
    
    return {
        "session_id": session_id,
        "status": "active_and_broadcasting",
        "nearby_users_alerted": nearby_users_alerted,
        "narrative": narrative
    }


# ============ COMMUNITY HEATMAP ============

@app.get("/api/v1/heatmap/incidents")
async def get_heatmap(lat: float = None, lng: float = None, radius: float = 5):
    incidents = get_incidents(lat, lng, radius)
    return {"incidents": incidents, "count": len(incidents)}

@app.post("/api/v1/heatmap/report")
async def report_incident(report: IncidentReport, authorization: str = Header(None)):
    user_id = None
    if authorization:
        token_data = get_user_from_token(authorization)
        if token_data:
            user_id = token_data["user_id"]
    
    create_incident(report.lat, report.lng, report.incident_type,
                   report.severity, report.description, user_id)
    
    print(f"📌 New incident: {report.incident_type} at {report.lat},{report.lng}")
    return {"status": "reported"}


# ============ OFFLINE SYNC ============

@app.post("/api/v1/offline/sync")
async def sync_offline(payload: OfflineSyncPayload, authorization: str = Header(None)):
    user_id = 0
    if authorization:
        token_data = get_user_from_token(authorization)
        if token_data:
            user_id = token_data["user_id"]
    
    synced = 0
    for event in payload.events:
        # Save to raw offline queue table
        queue_offline_event(user_id, json.dumps(event), event.get("type", "sos"))
        
        # Promote to active SOS events so they pop up on the Admin Panel
        trigger_type = event.get("trigger_type", "Manual Offline SOS")
        score = event.get("confidence_score", 100)
        lat = event.get("lat", 0.0)
        lng = event.get("lng", 0.0)
        user_name = event.get("user_name", "Guest")
        signal_chain = event.get("signal_chain", [])
        
        # Generate narrative for this offline alarm
        narrative = generate_narrative(
            user_name=user_name,
            trigger_type=trigger_type,
            confidence_score=score,
            lat=lat, lng=lng,
            signal_chain=signal_chain,
            battery_level=event.get("battery_level"),
            speed=event.get("speed")
        )
        
        # Add "offline mesh" context to the narrative
        narrative = f"📡 [OFFLINE MESH SYNCED] {narrative}"
        
        create_sos_event(
            user_id=event.get("user_id"),
            user_name=user_name,
            trigger_type=trigger_type,
            confidence_score=score,
            lat=lat, lng=lng,
            narrative=narrative,
            signal_chain=json.dumps(signal_chain)
        )
        
        synced += 1
    
    print(f"📡 Synced {synced} offline events from user {user_id}")
    return {"synced_count": synced, "status": "synced"}



# ============ USER PROFILE ============

@app.post("/api/v1/user/location")
async def update_location(lat: float, lng: float, authorization: str = Header(None)):
    if authorization:
        token_data = get_user_from_token(authorization)
        if token_data:
            update_user_location(token_data["user_id"], lat, lng)
    return {"status": "updated"}

@app.post("/api/v1/user/contacts")
async def update_contacts(req: ContactsUpdate, authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Auth required")
    token_data = get_user_from_token(authorization)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    update_emergency_contacts(token_data["user_id"], json.dumps(req.contacts))
    return {"status": "updated", "contacts": req.contacts}

@app.post("/api/v1/user/profile")
async def update_profile(req: ProfileUpdate, authorization: str = Header(None)):
    """Update user profile details."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Auth required")
    token_data = get_user_from_token(authorization)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    update_user_profile(token_data["user_id"], name=req.name, phone=req.phone, gender=req.gender)
    user = get_user_by_id(token_data["user_id"])
    return {
        "status": "updated",
        "user": {
            "id": user["id"], "name": user["name"],
            "email": user["email"], "phone": user.get("phone", ""),
            "gender": user.get("gender", "")
        }
    }


# ============ ADMIN ENDPOINTS ============

def require_admin(authorization: str):
    if not authorization:
        raise HTTPException(status_code=401, detail="Auth required")
    token_data = get_user_from_token(authorization)
    if not token_data or not token_data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return token_data

@app.get("/api/v1/admin/dashboard")
async def admin_dashboard(authorization: str = Header(None)):
    require_admin(authorization)
    stats = get_dashboard_stats()
    active_events = get_active_sos_events()
    active_shadows = get_active_shadow_sessions()
    incident_stats = get_incident_stats()
    
    return {
        "stats": stats,
        "active_alerts": active_events,
        "active_shadows": active_shadows,
        "incident_stats": incident_stats
    }

@app.get("/api/v1/admin/users")
async def admin_users(authorization: str = Header(None)):
    require_admin(authorization)
    return {"users": get_all_users()}

@app.get("/api/v1/admin/sos-events")
async def admin_sos_events(authorization: str = Header(None), limit: int = 50):
    require_admin(authorization)
    return {"events": get_all_sos_events(limit)}

@app.post("/api/v1/admin/resolve/{event_id}")
async def admin_resolve(event_id: int, authorization: str = Header(None)):
    require_admin(authorization)
    resolve_sos_event(event_id)
    print(f"✅ Admin resolved SOS event #{event_id}")
    return {"status": "resolved", "event_id": event_id}

@app.post("/api/v1/admin/false-alarm/{event_id}")
async def admin_false_alarm(event_id: int, authorization: str = Header(None)):
    require_admin(authorization)
    mark_false_alarm(event_id)
    print(f"❌ Admin marked SOS event #{event_id} as false alarm")
    return {"status": "false_alarm", "event_id": event_id}

@app.post("/api/v1/admin/toggle-user/{user_id}")
async def admin_toggle_user(user_id: int, active: bool = True, authorization: str = Header(None)):
    require_admin(authorization)
    toggle_user_active(user_id, active)
    return {"status": "updated", "user_id": user_id, "is_active": active}

@app.get("/api/v1/admin/heatmap-stats")
async def admin_heatmap_stats(authorization: str = Header(None)):
    require_admin(authorization)
    return get_incident_stats()



# ============ SAFE ROUTE (kept) ============

@app.post("/api/v1/routes/safe-path")
async def get_safe_path(lat: float, lng: float):
    return {
        "recommended_route": "Commercial Avenue",
        "crowd_density": "High",
        "safety_score": 94,
        "eta_mins": 14
    }


# ============ ADMIN WEB PANEL ============

@app.get("/admin", response_class=HTMLResponse)
async def admin_panel():
    """Serve the admin dashboard web interface."""
    admin_html_path = os.path.join(os.path.dirname(__file__), "admin_panel.html")
    if os.path.exists(admin_html_path):
        with open(admin_html_path, "r") as f:
            return f.read()
    return "<h1>Admin panel file not found. Run seed_data.py first.</h1>"


if __name__ == "__main__":
    import uvicorn
    print("🛡️ Sentinel v2.0 starting...")
    uvicorn.run(app, host="0.0.0.0", port=8000)