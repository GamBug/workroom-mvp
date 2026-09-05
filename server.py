"""
server.py - Flask Server for Workroom Mini

Responsibilities:
- Initialize Flask application and configure sessions.
- Serve HTML pages (index.html, workroom.html) and static assets (css, js).
- Handle user authentication with secure password hashing.
- Register modular Blueprints for Project, Task, and Canvas domain APIs.
- Initialize database schema on startup.
"""

import os
from flask import (
    Flask,
    request,
    jsonify,
    session,
    send_from_directory,
    redirect,
)
from werkzeug.security import generate_password_hash, check_password_hash

import database
from backend.common import login_required
from backend.project_api import project_bp
from backend.task_api import task_bp
from backend.canvas_api import canvas_bp

# Initialize Flask application
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=None)

# Configure secret key for session cookies (persisted or development default)
app.secret_key = os.environ.get("SECRET_KEY", "workroom-mini-local-dev-secret-key-2026")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Register Domain Blueprints
app.register_blueprint(project_bp)
app.register_blueprint(task_bp)
app.register_blueprint(canvas_bp)


# =====================================================================
# PAGE & STATIC ROUTES
# =====================================================================

@app.route("/")
def index():
    """
    Home / Login page.
    If already authenticated, redirect immediately to the workroom.
    """
    if "user_id" in session and database.get_user_by_id(session["user_id"]):
        return redirect("/workroom")
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/workroom")
def workroom():
    """
    Workroom application page.
    Requires active authentication session. Redirects to / if not logged in.
    """
    if "user_id" not in session or not database.get_user_by_id(session["user_id"]):
        return redirect("/")
    return send_from_directory(BASE_DIR, "workroom.html")


@app.route("/css/<path:filename>")
def serve_css(filename):
    """Serves CSS stylesheets."""
    return send_from_directory(os.path.join(BASE_DIR, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    """Serves JavaScript application files."""
    return send_from_directory(os.path.join(BASE_DIR, "js"), filename)


# =====================================================================
# AUTHENTICATION API
# =====================================================================

@app.route("/api/signup", methods=["POST"])
def api_signup():
    """
    Register a new user account.
    Expects JSON: { "username": str, "password": str, "confirm_password": str }
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    confirm_password = data.get("confirm_password") or ""

    if not username:
        return jsonify({"ok": False, "error": "Username is required"}), 400
    if len(username) < 2:
        return jsonify({"ok": False, "error": "Username must be at least 2 characters"}), 400
    if len(username) > 30:
        return jsonify({"ok": False, "error": "Username must not exceed 30 characters"}), 400

    if not password:
        return jsonify({"ok": False, "error": "Password is required"}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "Password must be at least 6 characters"}), 400

    if password != confirm_password:
        return jsonify({"ok": False, "error": "Passwords do not match"}), 400

    # Securely hash password using Werkzeug's modern default (scrypt)
    password_hash = generate_password_hash(password)
    user = database.create_user(username, password_hash)

    if not user:
        return jsonify({"ok": False, "error": "Username is already taken"}), 409

    # Set session cookie to log in automatically after signup
    session["user_id"] = user["id"]
    return jsonify({
        "ok": True,
        "data": {
            "id": user["id"],
            "username": user["username"]
        }
    }), 201


@app.route("/api/login", methods=["POST"])
def api_login():
    """
    Authenticate an existing user.
    Expects JSON: { "username": str, "password": str }
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"ok": False, "error": "Username and password are required"}), 400

    user = database.get_user_by_username(username)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401

    session["user_id"] = user["id"]
    return jsonify({
        "ok": True,
        "data": {
            "id": user["id"],
            "username": user["username"]
        }
    }), 200


@app.route("/api/logout", methods=["POST"])
def api_logout():
    """Clears the active session and logs the user out."""
    session.clear()
    return jsonify({"ok": True}), 200


@app.route("/api/me", methods=["GET"])
@login_required
def api_me(current_user):
    """Returns the currently authenticated user profile or 401."""
    return jsonify({
        "ok": True,
        "data": {
            "id": current_user["id"],
            "username": current_user["username"]
        }
    }), 200


# =====================================================================
# APPLICATION STARTUP
# =====================================================================

if __name__ == "__main__":
    # Ensure database schema is initialized on server launch
    database.init_db()
    print("==================================================")
    print(" WORKROOM MINI is starting up")
    print(" Accessible at: http://127.0.0.1:8000")
    print(" Database: SQLite (workroom.db)")
    print("==================================================")
    app.run(host="127.0.0.1", port=8000, debug=True)
