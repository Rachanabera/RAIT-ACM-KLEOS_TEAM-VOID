import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "sentinel.db")

def clear_all():
    if not os.path.exists(DB_PATH):
        print("ℹ️ Database file does not exist.")
        return
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Clean tables
    cursor.execute("DELETE FROM incidents")
    cursor.execute("DELETE FROM sos_events")
    cursor.execute("DELETE FROM offline_queue")
    cursor.execute("DELETE FROM shadow_sessions")
    cursor.execute("DELETE FROM confidence_log")
    
    conn.commit()
    
    print("✅ All fake incidents, SOS events, and offline queues have been completely erased.")
    
    # Count verification
    for t in ["incidents", "sos_events", "offline_queue"]:
        count = cursor.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"Table '{t}' count: {count}")
        
    conn.close()

if __name__ == "__main__":
    clear_all()
