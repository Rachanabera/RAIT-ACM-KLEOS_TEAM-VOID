"""
Sentinel v2.0 — Authentication Module
JWT-based auth with salted SHA-256 password hashing for user and admin login.
"""

import hashlib
import hmac
import json
import time
import base64
import os
import secrets
from datetime import datetime, timedelta

# JWT secret — uses environment variable in production, safe fallback for dev
JWT_SECRET = os.environ.get("SENTINEL_JWT_SECRET", "sentinel_safety_secret_key_2024_ultra_secure")
JWT_EXPIRY_HOURS = 72  # Extended for mobile app convenience

# Default admin credentials
ADMIN_EMAIL = "admin@sentinel.app"
ADMIN_PASSWORD = "sentinel_admin_2024"
ADMIN_NAME = "Sentinel Admin"


def hash_password(password: str, salt: str = None) -> str:
    """Hash password using SHA-256 with a unique salt. Returns 'salt$hash'."""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}${hashed}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against its stored 'salt$hash' value."""
    # Support legacy format (no salt separator)
    if "$" not in stored_hash:
        # Legacy: static salt
        legacy_salt = "sentinel_salt_v2"
        return hashlib.sha256(f"{legacy_salt}{password}".encode()).hexdigest() == stored_hash
    
    salt, _ = stored_hash.split("$", 1)
    return hash_password(password, salt) == stored_hash


def create_jwt(user_id: int, email: str, is_admin: bool = False) -> str:
    """Create a simple JWT token."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
    
    payload_data = {
        "user_id": user_id,
        "email": email,
        "is_admin": is_admin,
        "exp": time.time() + (JWT_EXPIRY_HOURS * 3600),
        "iat": time.time()
    }
    payload = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).decode()
    
    signature_input = f"{header}.{payload}"
    signature = hmac.new(JWT_SECRET.encode(), signature_input.encode(), hashlib.sha256).hexdigest()
    
    return f"{header}.{payload}.{signature}"


def decode_jwt(token: str) -> dict:
    """Decode and verify a JWT token."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        
        header, payload, signature = parts
        
        # Verify signature
        expected_sig = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        
        # Decode payload
        # Add padding if needed
        padded = payload + "=" * (4 - len(payload) % 4)
        payload_data = json.loads(base64.urlsafe_b64decode(padded).decode())
        
        # Check expiry
        if payload_data.get("exp", 0) < time.time():
            return None
        
        return payload_data
    except Exception:
        return None


def get_user_from_token(token: str) -> dict:
    """Extract user info from Bearer token."""
    if not token:
        return None
    
    # Handle "Bearer <token>" format
    if token.startswith("Bearer "):
        token = token[7:]
    
    return decode_jwt(token)
