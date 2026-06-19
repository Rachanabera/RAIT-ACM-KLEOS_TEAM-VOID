"""
Sentinel v2.0 — Database Layer
SQLite database with all tables for users, SOS events, incidents, shadow sessions, and offline queue.
"""

import sqlite3
import os
import json
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "sentinel.db")


@contextmanager
def get_db_connection():
    """Context manager for safe database connections."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db():
    """Get a database connection with row factory (legacy support)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialize all database tables."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            phone TEXT DEFAULT '',
            gender TEXT DEFAULT '',
            emergency_contacts TEXT DEFAULT '[]',
            is_admin BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            last_lat REAL DEFAULT 0,
            last_lng REAL DEFAULT 0,
            last_seen TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # SOS Events table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sos_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT DEFAULT 'Unknown',
            trigger_type TEXT NOT NULL,
            confidence_score INTEGER DEFAULT 0,
            latitude REAL DEFAULT 0,
            longitude REAL DEFAULT 0,
            address TEXT DEFAULT '',
            narrative TEXT DEFAULT '',
            signal_chain TEXT DEFAULT '[]',
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP,
            resolved_by TEXT DEFAULT '',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    
    # Community incidents table (for heatmap)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            incident_type TEXT NOT NULL,
            severity INTEGER DEFAULT 1,
            description TEXT DEFAULT '',
            reported_by INTEGER,
            is_anonymous BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Shadow tracking sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS shadow_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            start_lat REAL,
            start_lng REAL,
            end_lat REAL DEFAULT 0,
            end_lng REAL DEFAULT 0,
            safe_zone_name TEXT DEFAULT '',
            safe_zone_eta INTEGER DEFAULT 0,
            evidence_files TEXT DEFAULT '[]',
            location_trail TEXT DEFAULT '[]',
            status TEXT DEFAULT 'active',
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    
    # Offline SOS queue
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS offline_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            payload TEXT NOT NULL,
            event_type TEXT DEFAULT 'sos',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            synced BOOLEAN DEFAULT FALSE,
            synced_at TIMESTAMP
        )
    """)
    
    # Confidence score log (for audit trail)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS confidence_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            signal_type TEXT NOT NULL,
            score_added INTEGER NOT NULL,
            total_score INTEGER NOT NULL,
            triggered_sos BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    conn.close()
    print("✅ Database initialized successfully.")


# ============ USER OPERATIONS ============

def create_user(name, email, password_hash, phone="", gender="", is_admin=False):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (name, email, password_hash, phone, gender, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
            (name, email, password_hash, phone, gender, is_admin)
        )
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(user)
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def get_user_by_email(email):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return dict(user) if user else None

def get_user_by_id(user_id):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(user) if user else None

def get_all_users():
    conn = get_db()
    users = conn.execute("SELECT id, name, email, phone, gender, is_admin, is_active, last_lat, last_lng, last_seen, created_at FROM users WHERE is_admin = FALSE").fetchall()
    conn.close()
    return [dict(u) for u in users]

def update_user_location(user_id, lat, lng):
    conn = get_db()
    conn.execute(
        "UPDATE users SET last_lat = ?, last_lng = ?, last_seen = ? WHERE id = ?",
        (lat, lng, datetime.now().isoformat(), user_id)
    )
    conn.commit()
    conn.close()

def update_user_profile(user_id, name=None, phone=None, gender=None):
    """Update user profile fields."""
    conn = get_db()
    updates = []
    values = []
    if name is not None:
        updates.append("name = ?")
        values.append(name)
    if phone is not None:
        updates.append("phone = ?")
        values.append(phone)
    if gender is not None:
        updates.append("gender = ?")
        values.append(gender)
    
    if updates:
        values.append(user_id)
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()
    conn.close()

def update_emergency_contacts(user_id, contacts_json):
    conn = get_db()
    conn.execute("UPDATE users SET emergency_contacts = ? WHERE id = ?", (contacts_json, user_id))
    conn.commit()
    conn.close()

def toggle_user_active(user_id, is_active):
    conn = get_db()
    conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (is_active, user_id))
    conn.commit()
    conn.close()


# ============ SOS EVENT OPERATIONS ============

def create_sos_event(user_id, user_name, trigger_type, confidence_score, lat, lng, narrative="", signal_chain="[]"):
    conn = get_db()
    cursor = conn.execute(
        """INSERT INTO sos_events (user_id, user_name, trigger_type, confidence_score, latitude, longitude, narrative, signal_chain)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, user_name, trigger_type, confidence_score, lat, lng, narrative, signal_chain)
    )
    event_id = cursor.lastrowid
    conn.commit()
    event = conn.execute("SELECT * FROM sos_events WHERE id = ?", (event_id,)).fetchone()
    conn.close()
    return dict(event)

def get_active_sos_events():
    conn = get_db()
    events = conn.execute("SELECT * FROM sos_events WHERE status = 'active' ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(e) for e in events]

def get_all_sos_events(limit=50):
    conn = get_db()
    events = conn.execute("SELECT * FROM sos_events ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(e) for e in events]

def get_sos_event(event_id):
    conn = get_db()
    event = conn.execute("SELECT * FROM sos_events WHERE id = ?", (event_id,)).fetchone()
    conn.close()
    return dict(event) if event else None

def resolve_sos_event(event_id, resolved_by="admin"):
    conn = get_db()
    conn.execute(
        "UPDATE sos_events SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?",
        (datetime.now().isoformat(), resolved_by, event_id)
    )
    conn.commit()
    conn.close()

def mark_false_alarm(event_id):
    conn = get_db()
    conn.execute(
        "UPDATE sos_events SET status = 'false_alarm', resolved_at = ? WHERE id = ?",
        (datetime.now().isoformat(), event_id)
    )
    conn.commit()
    conn.close()


# ============ INCIDENT / HEATMAP OPERATIONS ============

def create_incident(lat, lng, incident_type, severity=1, description="", reported_by=None, is_anonymous=True):
    conn = get_db()
    conn.execute(
        """INSERT INTO incidents (latitude, longitude, incident_type, severity, description, reported_by, is_anonymous)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (lat, lng, incident_type, severity, description, reported_by, is_anonymous)
    )
    conn.commit()
    conn.close()

def get_incidents(lat=None, lng=None, radius_km=5, limit=500):
    conn = get_db()
    if lat and lng:
        # Approximate bounding box (1 degree ≈ 111km)
        delta = radius_km / 111.0
        incidents = conn.execute(
            """SELECT * FROM incidents 
               WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
               ORDER BY created_at DESC LIMIT ?""",
            (lat - delta, lat + delta, lng - delta, lng + delta, limit)
        ).fetchall()
    else:
        incidents = conn.execute("SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(i) for i in incidents]

def get_incident_stats():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as count FROM incidents").fetchone()["count"]
    by_type = conn.execute("SELECT incident_type, COUNT(*) as count FROM incidents GROUP BY incident_type").fetchall()
    by_severity = conn.execute("SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity").fetchall()
    conn.close()
    return {
        "total": total,
        "by_type": {row["incident_type"]: row["count"] for row in by_type},
        "by_severity": {str(row["severity"]): row["count"] for row in by_severity}
    }


# ============ SHADOW SESSION OPERATIONS ============

def create_shadow_session(user_id, lat, lng):
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO shadow_sessions (user_id, start_lat, start_lng) VALUES (?, ?, ?)",
        (user_id, lat, lng)
    )
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return session_id

def update_shadow_trail(session_id, location_trail_json):
    conn = get_db()
    conn.execute("UPDATE shadow_sessions SET location_trail = ? WHERE id = ?", (location_trail_json, session_id))
    conn.commit()
    conn.close()

def end_shadow_session(session_id, end_lat, end_lng):
    conn = get_db()
    conn.execute(
        "UPDATE shadow_sessions SET status = 'ended', end_lat = ?, end_lng = ?, ended_at = ? WHERE id = ?",
        (end_lat, end_lng, datetime.now().isoformat(), session_id)
    )
    conn.commit()
    conn.close()

def get_active_shadow_sessions():
    conn = get_db()
    sessions = conn.execute("SELECT * FROM shadow_sessions WHERE status = 'active' ORDER BY started_at DESC").fetchall()
    conn.close()
    return [dict(s) for s in sessions]


# ============ OFFLINE QUEUE OPERATIONS ============

def queue_offline_event(user_id, payload_json, event_type="sos"):
    conn = get_db()
    conn.execute(
        "INSERT INTO offline_queue (user_id, payload, event_type) VALUES (?, ?, ?)",
        (user_id, payload_json, event_type)
    )
    conn.commit()
    conn.close()

def get_unsynced_events(user_id):
    conn = get_db()
    events = conn.execute(
        "SELECT * FROM offline_queue WHERE user_id = ? AND synced = FALSE ORDER BY created_at ASC",
        (user_id,)
    ).fetchall()
    conn.close()
    return [dict(e) for e in events]

def mark_synced(event_id):
    conn = get_db()
    conn.execute(
        "UPDATE offline_queue SET synced = TRUE, synced_at = ? WHERE id = ?",
        (datetime.now().isoformat(), event_id)
    )
    conn.commit()
    conn.close()


# ============ CONFIDENCE LOG ============

def log_confidence(user_id, signal_type, score_added, total_score, triggered_sos=False):
    conn = get_db()
    conn.execute(
        "INSERT INTO confidence_log (user_id, signal_type, score_added, total_score, triggered_sos) VALUES (?, ?, ?, ?, ?)",
        (user_id, signal_type, score_added, total_score, triggered_sos)
    )
    conn.commit()
    conn.close()


# ============ ADMIN STATS ============

def get_dashboard_stats():
    conn = get_db()
    total_users = conn.execute("SELECT COUNT(*) as c FROM users WHERE is_admin = FALSE").fetchone()["c"]
    active_sos = conn.execute("SELECT COUNT(*) as c FROM sos_events WHERE status = 'active'").fetchone()["c"]
    total_sos = conn.execute("SELECT COUNT(*) as c FROM sos_events").fetchone()["c"]
    resolved_sos = conn.execute("SELECT COUNT(*) as c FROM sos_events WHERE status = 'resolved'").fetchone()["c"]
    false_alarms = conn.execute("SELECT COUNT(*) as c FROM sos_events WHERE status = 'false_alarm'").fetchone()["c"]
    total_incidents = conn.execute("SELECT COUNT(*) as c FROM incidents").fetchone()["c"]
    active_shadows = conn.execute("SELECT COUNT(*) as c FROM shadow_sessions WHERE status = 'active'").fetchone()["c"]
    conn.close()
    return {
        "total_users": total_users,
        "active_sos": active_sos,
        "total_sos": total_sos,
        "resolved_sos": resolved_sos,
        "false_alarms": false_alarms,
        "total_incidents": total_incidents,
        "active_shadows": active_shadows
    }
