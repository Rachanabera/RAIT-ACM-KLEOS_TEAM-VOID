"""
Sentinel v2.0 — Seed Data
Realistic heatmap incident data for Indian cities (Mumbai focus for demo).
"""

import random
from datetime import datetime, timedelta
from database import create_incident, get_db

# Mumbai hotspots with realistic danger zones
MUMBAI_DANGER_ZONES = [
    {"name": "Andheri Station East Exit", "lat": 19.1197, "lng": 72.8464, "radius": 0.003},
    {"name": "Jogeshwari Link Road", "lat": 19.1364, "lng": 72.8497, "radius": 0.004},
    {"name": "Goregaon Aarey Road", "lat": 19.1551, "lng": 72.8670, "radius": 0.005},
    {"name": "Bandra Reclamation", "lat": 19.0544, "lng": 72.8261, "radius": 0.003},
    {"name": "Dadar Bridge Underpass", "lat": 19.0178, "lng": 72.8432, "radius": 0.002},
    {"name": "Kurla LBS Road", "lat": 19.0726, "lng": 72.8793, "radius": 0.004},
    {"name": "Malad West Industrial", "lat": 19.1868, "lng": 72.8484, "radius": 0.005},
    {"name": "Borivali National Park Edge", "lat": 19.2288, "lng": 72.8568, "radius": 0.006},
    {"name": "Chembur Eastern Express", "lat": 19.0522, "lng": 72.8994, "radius": 0.003},
    {"name": "Thane Station Footover", "lat": 19.1860, "lng": 72.9756, "radius": 0.003},
    {"name": "Vikhroli Pipeline Road", "lat": 19.1100, "lng": 72.9275, "radius": 0.004},
    {"name": "Mulund Creek Road", "lat": 19.1725, "lng": 72.9569, "radius": 0.003},
    {"name": "Powai Hiranandani Back", "lat": 19.1176, "lng": 72.9060, "radius": 0.003},
    {"name": "Ghatkopar Station West", "lat": 19.0862, "lng": 72.9080, "radius": 0.002},
    {"name": "Santacruz Market Lane", "lat": 19.0831, "lng": 72.8410, "radius": 0.002},
]

INCIDENT_TYPES = [
    "stalking", "harassment", "eve_teasing", "assault",
    "robbery", "unsafe_transport", "poorly_lit_area",
    "suspicious_activity", "catcalling", "following"
]

DESCRIPTIONS = {
    "stalking": ["Reported being followed for 3 blocks", "Man following on motorcycle", "Same person seen at multiple stops"],
    "harassment": ["Verbal harassment near station", "Group of men making comments", "Harassed while waiting for auto"],
    "eve_teasing": ["Catcalling from passing vehicle", "Inappropriate comments at bus stop", "Whistling and following"],
    "assault": ["Physical confrontation reported", "Attempted grab near parking", "Push/shove incident"],
    "robbery": ["Phone snatching attempt", "Bag grabbed from behind", "Threatened for valuables"],
    "unsafe_transport": ["Auto driver took different route", "Shared cab driver suspicious", "Rickshaw refused meter"],
    "poorly_lit_area": ["No streetlights for 200m stretch", "Broken lights near underpass", "Dark alley with no cameras"],
    "suspicious_activity": ["Group loitering at night", "Suspicious vehicle parked", "Unknown person watching building"],
    "catcalling": ["Shouted at from car", "Comments while walking", "Followed with comments"],
    "following": ["Noticed same person for 10 min", "Vehicle following slowly", "Person changing route to match"],
}


def seed_heatmap_data(count=200):
    """Seed the database with realistic incident data."""
    print(f"🗺️  Seeding {count} incidents across Mumbai danger zones...")
    
    for i in range(count):
        # Pick a random danger zone
        zone = random.choice(MUMBAI_DANGER_ZONES)
        
        # Random offset within zone radius
        lat = zone["lat"] + random.uniform(-zone["radius"], zone["radius"])
        lng = zone["lng"] + random.uniform(-zone["radius"], zone["radius"])
        
        # Random incident type
        inc_type = random.choice(INCIDENT_TYPES)
        severity = random.choices([1, 2, 3, 4, 5], weights=[10, 25, 35, 20, 10])[0]
        desc_list = DESCRIPTIONS.get(inc_type, ["Incident reported"])
        description = random.choice(desc_list)
        
        create_incident(
            lat=lat,
            lng=lng,
            incident_type=inc_type,
            severity=severity,
            description=description,
            is_anonymous=True
        )
    
    print(f"✅ Seeded {count} incidents successfully!")


def seed_admin_user():
    """Create default admin user."""
    from auth import hash_password, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
    from database import create_user, get_user_by_email
    
    existing = get_user_by_email(ADMIN_EMAIL)
    if not existing:
        create_user(
            name=ADMIN_NAME,
            email=ADMIN_EMAIL,
            password_hash=hash_password(ADMIN_PASSWORD),
            is_admin=True
        )
        print(f"✅ Admin user created: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    else:
        print(f"ℹ️  Admin user already exists.")


if __name__ == "__main__":
    from database import init_db
    init_db()
    seed_admin_user()
    seed_heatmap_data(200)
    print("\n🎉 Database seeded and ready for demo!")
