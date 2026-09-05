"""
server.py - Flask Server for Workroom Mini

Responsibilities:
- Initialize Flask application and configure sessions.
- Serve HTML pages (index.html, workroom.html) and static assets (css, js).
- Handle user authentication with secure password hashing.
- Expose REST API for projects and tasks with strict ownership verification.
- Return structured JSON responses for all API routes.
"""

import os
import io
import csv
import json
import re
from datetime import datetime, timezone
from functools import wraps
from flask import (
    Flask,
    request,
    jsonify,
    session,
    send_from_directory,
    redirect,
    url_for,
    Response,
)
from werkzeug.security import generate_password_hash, check_password_hash

import database

# Initialize Flask application
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=None)

# Configure secret key for session cookies (persisted or development default)
app.secret_key = os.environ.get("SECRET_KEY", "workroom-mini-local-dev-secret-key-2026")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


# =====================================================================
# AUTHENTICATION DECORATOR & HELPERS
# =====================================================================

def login_required(f):
    """
    Decorator to protect API routes.
    Returns 401 Unauthorized if the session does not have a valid user_id.
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
# DASHBOARD API (Strict Ownership Scoping)
# =====================================================================

@app.route("/api/dashboard", methods=["GET"])
@login_required
def api_get_dashboard(current_user):
    """
    Returns dashboard overview data (all projects and tasks owned by current user).
    Strictly filtered by session user ID.
    """
    data = database.get_dashboard_data(current_user["id"])
    return jsonify({"ok": True, "data": data}), 200


# =====================================================================
# PROJECT API (Strict Ownership Verification)
# =====================================================================

@app.route("/api/projects", methods=["GET"])
@login_required
def api_get_projects(current_user):
    """Lists all projects owned by the logged-in user."""
    projects = database.get_projects_by_user(current_user["id"])
    return jsonify({"ok": True, "data": projects}), 200


@app.route("/api/projects", methods=["POST"])
@login_required
def api_create_project(current_user):
    """
    Creates a new project for the logged-in user.
    Expects JSON: { "name": str }
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"ok": False, "error": "Project name cannot be empty"}), 400
    if len(name) > 80:
        return jsonify({"ok": False, "error": "Project name cannot exceed 80 characters"}), 400

    project = database.create_project(current_user["id"], name)
    return jsonify({"ok": True, "data": project}), 201


@app.route("/api/projects/<int:project_id>", methods=["PATCH"])
@login_required
def api_rename_project(current_user, project_id):
    """
    Renames an existing project owned by the user.
    Owner only.
    Expects JSON: { "name": str }
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404
    if role != "owner":
        return jsonify({"ok": False, "error": "Only the project owner can rename this project"}), 403

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"ok": False, "error": "Project name cannot be empty"}), 400
    if len(name) > 80:
        return jsonify({"ok": False, "error": "Project name cannot exceed 80 characters"}), 400

    updated_project = database.rename_project(project_id, current_user["id"], name)
    if not updated_project:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    return jsonify({
        "ok": True,
        "data": updated_project,
        "project_revision": updated_project.get("revision")
    }), 200


@app.route("/api/projects/<int:project_id>/revision", methods=["GET"])
@login_required
def api_get_project_revision(current_user, project_id):
    """
    Lightweight polling endpoint to check current project revision.
    Returns revision number, project name, and user role.
    """
    status_code, result = database.get_project_revision(project_id, current_user["id"])
    if status_code != 200:
        return jsonify({"ok": False, "error": result}), status_code
    return jsonify({"ok": True, "data": result}), 200


@app.route("/api/projects/<int:project_id>", methods=["DELETE"])
@login_required
def api_delete_project(current_user, project_id):
    """
    Permanently deletes a project and all its tasks via database CASCADE.
    Owner only.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404
    if role != "owner":
        return jsonify({"ok": False, "error": "Only the project owner can delete this project"}), 403

    success = database.delete_project(project_id, current_user["id"])
    if not success:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    return jsonify({"ok": True}), 200


# =====================================================================
# PROJECT COLLABORATION API
# =====================================================================

@app.route("/api/projects/join", methods=["POST"])
@login_required
def api_join_project(current_user):
    """
    Joins a project via unique join code.
    Expects JSON: { "join_code": str }
    """
    data = request.get_json(silent=True) or {}
    join_code = data.get("join_code")
    status_code, result = database.join_project_by_code(join_code, current_user["id"])
    if status_code != 200:
        return jsonify({"ok": False, "error": result}), status_code
    return jsonify({
        "ok": True,
        "data": result,
        "project_revision": result.get("revision") if isinstance(result, dict) else None
    }), 200


@app.route("/api/projects/<int:project_id>/members", methods=["GET"])
@login_required
def api_get_project_members(current_user, project_id):
    """
    Lists participants of a project (owner and members).
    Accessible to both owner and members.
    If owner, includes join_code. If member, excludes join_code.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    members_data = database.get_project_members(project_id, current_user["id"])
    return jsonify({"ok": True, "data": members_data}), 200


@app.route("/api/projects/<int:project_id>/join-code/regenerate", methods=["POST"])
@login_required
def api_regenerate_join_code(current_user, project_id):
    """
    Generates a new join code for the project.
    Owner only.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404
    if role != "owner":
        return jsonify({"ok": False, "error": "Only the project owner can regenerate the join code"}), 403

    new_code, new_rev = database.regenerate_project_join_code(project_id, current_user["id"])
    if not new_code:
        return jsonify({"ok": False, "error": "Failed to regenerate join code"}), 500
    return jsonify({
        "ok": True,
        "data": {"join_code": new_code},
        "project_revision": new_rev
    }), 200


@app.route("/api/projects/<int:project_id>/members/<int:target_user_id>", methods=["DELETE"])
@login_required
def api_remove_project_member(current_user, project_id, target_user_id):
    """
    Removes a member from a project.
    Owner only. Cannot remove the owner.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404
    if role != "owner":
        return jsonify({"ok": False, "error": "Only the project owner can remove members"}), 403

    status_code, err, new_rev = database.remove_project_member(project_id, current_user["id"], target_user_id)
    if status_code != 200:
        return jsonify({"ok": False, "error": err}), status_code
    return jsonify({"ok": True, "project_revision": new_rev}), 200


# =====================================================================
# CANVAS POSITIONS API (Owner or Member Access)
# =====================================================================

@app.route("/api/projects/<int:project_id>/canvas-positions", methods=["GET"])
@login_required
def api_get_canvas_positions(current_user, project_id):
    """
    Retrieves all task canvas positions for the specified project.
    Accessible to Owner and Members.
    Does not touch project revision.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    positions = database.get_canvas_positions(project_id, current_user["id"])
    return jsonify({
        "ok": True,
        "data": {
            "positions": positions or []
        }
    }), 200


@app.route("/api/projects/<int:project_id>/canvas-positions", methods=["PUT"])
@login_required
def api_save_canvas_positions(current_user, project_id):
    """
    Saves (upserts) one or more task canvas positions for a project.
    Accessible to Owner and Members.
    Transactional & all-or-nothing: validates task ownership, bounds, and project revision.
    Increments project revision exactly once per successful request.
    Expects JSON: { "positions": [ { "task_id": int, "x": float, "y": float }, ... ] }
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    data = request.get_json(silent=True) or {}
    positions = data.get("positions")

    status_code, err_msg, result_data = database.save_canvas_positions(
        project_id, current_user["id"], positions
    )

    if status_code != 200:
        return jsonify({"ok": False, "error": err_msg}), status_code

    return jsonify({
        "ok": True,
        "data": result_data,
        "project_revision": result_data.get("project_revision")
    }), 200


# =====================================================================
# TASK DEPENDENCIES API (Owner or Member Access)
# =====================================================================

@app.route("/api/projects/<int:project_id>/dependencies", methods=["GET"])
@login_required
def api_get_dependencies(current_user, project_id):
    """
    Retrieves all task dependencies for the specified project.
    Accessible to Owner and Members.
    Does not touch project revision.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    deps = database.get_project_dependencies(project_id, current_user["id"])
    return jsonify({
        "ok": True,
        "data": {
            "dependencies": deps or []
        }
    }), 200


@app.route("/api/projects/<int:project_id>/dependencies", methods=["POST"])
@login_required
def api_create_dependency(current_user, project_id):
    """
    Creates a new directed dependency between two tasks in the project.
    Accessible to Owner and Members.
    Validates existence, no self-link, no duplicate, same project.
    Increments project revision exactly once.
    Expects JSON: { "from_task_id": int, "to_task_id": int }
    """
    data = request.get_json(silent=True) or {}
    from_task_id = data.get("from_task_id")
    to_task_id = data.get("to_task_id")

    status_code, err_msg, result_data = database.create_task_dependency(
        project_id, current_user["id"], from_task_id, to_task_id
    )

    if status_code != 201:
        return jsonify({"ok": False, "error": err_msg}), status_code

    return jsonify({
        "ok": True,
        "data": result_data,
        "project_revision": result_data.get("project_revision")
    }), 201


@app.route("/api/projects/<int:project_id>/dependencies", methods=["DELETE"])
@login_required
def api_delete_dependency(current_user, project_id):
    """
    Deletes an existing directed dependency between two tasks in the project.
    Accessible to Owner and Members.
    Increments project revision exactly once.
    Expects JSON: { "from_task_id": int, "to_task_id": int }
    """
    data = request.get_json(silent=True) or {}
    from_task_id = data.get("from_task_id")
    to_task_id = data.get("to_task_id")

    if from_task_id is None and request.args.get("from_task_id"):
        from_task_id = request.args.get("from_task_id")
    if to_task_id is None and request.args.get("to_task_id"):
        to_task_id = request.args.get("to_task_id")

    status_code, err_msg, result_data = database.delete_task_dependency(
        project_id, current_user["id"], from_task_id, to_task_id
    )

    if status_code != 200:
        return jsonify({"ok": False, "error": err_msg}), status_code

    return jsonify({
        "ok": True,
        "project_revision": result_data.get("project_revision")
    }), 200


# =====================================================================
# TASK API (Owner or Member Access Verification)
# =====================================================================

@app.route("/api/projects/<int:project_id>/tasks", methods=["GET"])
@login_required
def api_get_tasks(current_user, project_id):
    """
    Returns all tasks belonging to the specified project.
    Verifies the logged-in user has access (owner or member).
    If user lost access, returns 403.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    tasks = database.get_tasks_by_project(project_id, current_user["id"])
    return jsonify({"ok": True, "data": tasks}), 200


@app.route("/api/projects/<int:project_id>/tasks", methods=["POST"])
@login_required
def api_create_task(current_user, project_id):
    """
    Creates a new task in the specified project.
    Expects JSON: {
        "title": str,
        "description": Optional[str],
        "status": Optional[str],
        "due_date": Optional[str] ('YYYY-MM-DD' or null),
        "assignee_id": Optional[int/null]
    }
    """
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    status = data.get("status", "Todo")
    due_date_raw = data.get("due_date")
    assignee_id_raw = data.get("assignee_id")

    if not title:
        return jsonify({"ok": False, "error": "Task title cannot be empty"}), 400
    if len(title) > 200:
        return jsonify({"ok": False, "error": "Task title cannot exceed 200 characters"}), 400
    if len(description) > 2000:
        return jsonify({"ok": False, "error": "Task description cannot exceed 2000 characters"}), 400

    if status not in ("Todo", "Doing", "Review", "Done"):
        return jsonify({"ok": False, "error": "Invalid task status"}), 400

    is_valid_date, normalized_due_date = validate_due_date(due_date_raw)
    if not is_valid_date:
        return jsonify({"ok": False, "error": "Invalid due date format. Must be YYYY-MM-DD or null"}), 400

    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    assignee_id = None
    if assignee_id_raw is not None and assignee_id_raw != "":
        try:
            assignee_id = int(assignee_id_raw)
        except (ValueError, TypeError):
            return jsonify({"ok": False, "error": "Invalid assignee ID"}), 400
        if not database.is_project_participant(project_id, assignee_id):
            return jsonify({"ok": False, "error": "Assignee must be an active member or owner of this project"}), 400

    task = database.create_task(
        project_id,
        current_user["id"],
        title,
        description=description,
        status=status,
        due_date=normalized_due_date,
        assignee_id=assignee_id
    )
    if not task:
        return jsonify({"ok": False, "error": "Failed to create task"}), 500

    return jsonify({
        "ok": True,
        "data": task,
        "project_revision": task.get("project_revision")
    }), 201


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
@login_required
def api_update_task(current_user, task_id):
    """
    Updates a task's title, description, status, due_date, and/or assignee_id.
    Expects JSON: {
        "title": Optional[str],
        "description": Optional[str],
        "status": Optional[str],
        "due_date": Optional[str/null],
        "assignee_id": Optional[int/null]
    }
    Verifies project access (owner or member).
    """
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id FROM tasks WHERE id = ?;", (task_id,))
        t_row = cursor.fetchone()
        if not t_row:
            return jsonify({"ok": False, "error": "Task not found"}), 404
        project_id = t_row["project_id"]
        if not database.can_access_project(project_id, current_user["id"]):
            return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403

    data = request.get_json(silent=True) or {}
    title = data.get("title")
    description = data.get("description")
    status = data.get("status")
    has_due_date = "due_date" in data
    due_date_raw = data.get("due_date")
    has_assignee = "assignee_id" in data
    assignee_id_raw = data.get("assignee_id")

    if title is None and description is None and status is None and not has_due_date and not has_assignee:
        return jsonify({"ok": False, "error": "No fields to update provided"}), 400

    if title is not None:
        title = title.strip()
        if not title:
            return jsonify({"ok": False, "error": "Task title cannot be empty"}), 400
        if len(title) > 200:
            return jsonify({"ok": False, "error": "Task title cannot exceed 200 characters"}), 400

    if description is not None:
        description = description.strip()
        if len(description) > 2000:
            return jsonify({"ok": False, "error": "Task description cannot exceed 2000 characters"}), 400

    if status is not None and status not in ("Todo", "Doing", "Review", "Done"):
        return jsonify({"ok": False, "error": f"Invalid status '{status}'. Must be Todo, Doing, Review, or Done"}), 400

    if has_due_date:
        is_valid_date, normalized_due_date = validate_due_date(due_date_raw)
        if not is_valid_date:
            return jsonify({"ok": False, "error": "Invalid due date format. Must be YYYY-MM-DD or null"}), 400
        due_date_arg = normalized_due_date
    else:
        due_date_arg = database.UNSET

    if has_assignee:
        if assignee_id_raw is None or assignee_id_raw == "":
            assignee_id_arg = None
        else:
            try:
                assignee_id_arg = int(assignee_id_raw)
            except (ValueError, TypeError):
                return jsonify({"ok": False, "error": "Invalid assignee ID"}), 400
            if not database.is_project_participant(project_id, assignee_id_arg):
                return jsonify({"ok": False, "error": "Assignee must be an active member or owner of this project"}), 400
    else:
        assignee_id_arg = database.UNSET

    updated_task = database.update_task(
        task_id,
        current_user["id"],
        title=title,
        description=description,
        status=status,
        due_date=due_date_arg,
        assignee_id=assignee_id_arg
    )
    if not updated_task:
        return jsonify({"ok": False, "error": "Task not found or unauthorized"}), 404

    return jsonify({
        "ok": True,
        "data": updated_task,
        "project_revision": updated_task.get("project_revision")
    }), 200


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def api_delete_task(current_user, task_id):
    """
    Permanently deletes a task.
    Verifies project access (owner or member).
    """
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id FROM tasks WHERE id = ?;", (task_id,))
        t_row = cursor.fetchone()
        if not t_row:
            return jsonify({"ok": False, "error": "Task not found"}), 404
        if not database.can_access_project(t_row["project_id"], current_user["id"]):
            return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403

    success, new_rev = database.delete_task(task_id, current_user["id"])
    if not success:
        return jsonify({"ok": False, "error": "Task not found or unauthorized"}), 404

    return jsonify({"ok": True, "project_revision": new_rev}), 200


# =====================================================================
# TASK COMMENT API (Owner or Member access)
# =====================================================================

@app.route("/api/tasks/<int:task_id>/comments", methods=["GET"])
@login_required
def api_get_task_comments(current_user, task_id):
    """
    Returns all comments for a task.
    Requires participant access to parent project.
    """
    comments = database.get_task_comments(task_id, current_user["id"])
    if comments is None:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT project_id FROM tasks WHERE id = ?;", (task_id,))
            t_row = cursor.fetchone()
            if not t_row:
                return jsonify({"ok": False, "error": "Task not found"}), 404
            if not database.can_access_project(t_row["project_id"], current_user["id"]):
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Could not retrieve comments"}), 500

    return jsonify({"ok": True, "data": comments}), 200


@app.route("/api/tasks/<int:task_id>/comments", methods=["POST"])
@login_required
def api_create_task_comment(current_user, task_id):
    """
    Creates a new plain-text comment on a task.
    Author is strictly taken from the session (current_user["id"]).
    """
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()

    if not content:
        return jsonify({"ok": False, "error": "Comment content cannot be empty"}), 400
    if len(content) > 5000:
        return jsonify({"ok": False, "error": "Comment content cannot exceed 5000 characters"}), 400

    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id FROM tasks WHERE id = ?;", (task_id,))
        t_row = cursor.fetchone()
        if not t_row:
            return jsonify({"ok": False, "error": "Task not found"}), 404
        if not database.can_access_project(t_row["project_id"], current_user["id"]):
            return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403

    comment = database.create_task_comment(task_id, current_user["id"], content)
    if not comment:
        return jsonify({"ok": False, "error": "Failed to create comment"}), 500

    return jsonify({
        "ok": True,
        "data": comment,
        "project_revision": comment.get("project_revision")
    }), 201


@app.route("/api/comments/<int:comment_id>", methods=["DELETE"])
@login_required
def api_delete_comment(current_user, comment_id):
    """
    Deletes a comment.
    Allowed only for:
    - Author of the comment (if they still have project access)
    OR
    - Project Owner
    """
    status_code, err, new_rev = database.delete_comment(comment_id, current_user["id"])
    if status_code != 200:
        return jsonify({"ok": False, "error": err}), status_code

    return jsonify({"ok": True, "project_revision": new_rev}), 200


# =====================================================================
# DATA EXPORT API (CSV & JSON)
# =====================================================================

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


@app.route("/api/projects/<int:project_id>/export.csv", methods=["GET"])
@login_required
def api_export_project_csv(current_user, project_id):
    """
    Exports all tasks of an owned project as a UTF-8 CSV attachment (with BOM for Excel compatibility).
    Enforces project ownership strictly.
    Includes full description, assignee, status, due_date, and creation timestamp.
    Handles empty projects (returns header row).
    Generates CSV entirely in-memory using Python's standard csv module.
    """
    role = database.get_project_role(project_id, current_user["id"])
    if not role:
        with database.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return jsonify({"ok": False, "error": "You no longer have access to this Project"}), 403
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    project = database.get_project(project_id, current_user["id"])
    if not project:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    tasks = database.get_tasks_by_project(project_id, current_user["id"])
    if tasks is None:
        return jsonify({"ok": False, "error": "Project not found or unauthorized"}), 404

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")

    # Header row
    writer.writerow([
        "project_name",
        "task_id",
        "title",
        "description",
        "assignee",
        "status",
        "due_date",
        "created_at"
    ])

    for task in tasks:
        writer.writerow([
            project["name"],
            task["id"],
            task["title"],
            task["description"] or "",
            task.get("assignee_username") or "",
            task["status"],
            task["due_date"] or "",
            task["created_at"]
        ])

    csv_data = output.getvalue().encode("utf-8-sig")
    slug = sanitize_export_slug(project["name"], fallback=f"project-{project_id}")
    filename = f"{slug}-tasks.csv"

    response = Response(csv_data, mimetype="text/csv")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.route("/api/export.json", methods=["GET"])
@login_required
def api_export_all_json(current_user):
    """
    Exports all projects and tasks owned by the authenticated user as a structured JSON snapshot.
    Excludes sensitive credentials (passwords, hashes, user_id).
    Avoids N+1 queries.
    Generates payload entirely in-memory.
    """
    projects_data = database.get_all_projects_and_tasks_for_export(current_user["id"])
    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "format": "workroom-mini-export",
        "version": 1,
        "exported_at": exported_at,
        "projects": projects_data
    }

    json_data = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"workroom-mini-export-{date_str}.json"

    response = Response(json_data, mimetype="application/json")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


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
