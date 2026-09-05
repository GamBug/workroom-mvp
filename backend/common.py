"""
backend/common.py - Shared Backend Helpers and Middleware

Responsibilities:
- Authentication decorator (login_required).
- Input validation helpers (validate_due_date).
- String sanitization utilities (sanitize_export_slug).
"""

import re
from datetime import datetime
from functools import wraps
from flask import session, jsonify

import database


def login_required(f):
    """
    Decorator to protect API routes.
    Returns 401 Unauthorized if the session does not have a valid user_id.
    Passes current_user dict as the first argument to the decorated route.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"ok": False, "error": "Authentication required"}), 401

        # Verify the user exists in database
        current_user = database.get_user_by_id(user_id)
        if not current_user:
            session.clear()
            return jsonify({"ok": False, "error": "User account no longer exists"}), 401

        return f(current_user, *args, **kwargs)
    return decorated_function


def validate_due_date(due_date_value):
    """
    Validates that due_date_value is None, empty string, or 'YYYY-MM-DD'.
    Returns (is_valid: bool, normalized_date: str or None).
    """
    if due_date_value is None:
        return True, None
    if not isinstance(due_date_value, str):
        return False, None

    clean_val = due_date_value.strip()
    if not clean_val:
        return True, None

    try:
        parsed = datetime.strptime(clean_val, "%Y-%m-%d")
        if parsed.strftime("%Y-%m-%d") != clean_val:
            return False, None
        return True, clean_val
    except ValueError:
        return False, None


def sanitize_export_slug(text, fallback="export"):
    """
    Sanitizes project name into a safe, alphanumeric hyphenated filename slug.
    Prevents header injection and directory traversal in Content-Disposition.
    """
    if not text or not isinstance(text, str):
        return fallback
    clean = re.sub(r"[^\w\s-]", "", text).strip()
    clean = re.sub(r"[-\s]+", "-", clean).strip("-")
    return clean[:50].lower() if clean else fallback
