import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "sentinel.db")

def check():
    if not os.path.exists(DB_PATH):
        print("Database file does not exist.")
        return
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    tables = ["users", "sos_events", "incidents", "shadow_sessions", "offline_queue"]
    for t in tables:
        try:
            count = cursor.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"Table '{t}': {count} records")
            if count > 0:
                rows = cursor.execute(f"SELECT * FROM {t} LIMIT 3").fetchall()
                print(f"  Sample: {rows}")
        except Exception as e:
            print(f"Error checking table '{t}': {e}")
            
    conn.close()

if __name__ == "__main__":
    check()
