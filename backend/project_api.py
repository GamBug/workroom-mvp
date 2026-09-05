"""
backend/project_api.py - Project & Collaboration REST API Blueprint

Responsibilities:
- Dashboard overview endpoint.
- Project CRUD (list, create, rename, delete).
- Project revision polling endpoint.
- Collaboration features (join code, join project, member list, member removal).
- Data export endpoints (CSV project export, JSON full export).
"""

import io
import csv
import json
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, Response

import database
from backend.common import login_required, sanitize_export_slug

project_bp = Blueprint("project_api", __name__)


# =====================================================================
# DASHBOARD API
# =====================================================================

@project_bp.route("/api/dashboard", methods=["GET"])
@login_required
def api_get_dashboard(current_user):
    """
    Returns dashboard overview data (all projects and tasks owned by current user).
    Strictly filtered by session user ID.
    """
    data = database.get_dashboard_data(current_user["id"])
    return jsonify({"ok": True, "data": data}), 200


# =====================================================================
# PROJECT CRUD & REVISION API
# =====================================================================

@project_bp.route("/api/projects", methods=["GET"])
@login_required
def api_get_projects(current_user):
    """Lists all projects owned or collaborated on by the logged-in user."""
    projects = database.get_projects_by_user(current_user["id"])
    return jsonify({"ok": True, "data": projects}), 200


@project_bp.route("/api/projects", methods=["POST"])
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


@project_bp.route("/api/projects/<int:project_id>", methods=["PATCH"])
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


@project_bp.route("/api/projects/<int:project_id>/revision", methods=["GET"])
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


@project_bp.route("/api/projects/<int:project_id>", methods=["DELETE"])
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

@project_bp.route("/api/projects/join", methods=["POST"])
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


@project_bp.route("/api/projects/<int:project_id>/members", methods=["GET"])
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


@project_bp.route("/api/projects/<int:project_id>/join-code/regenerate", methods=["POST"])
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


@project_bp.route("/api/projects/<int:project_id>/members/<int:target_user_id>", methods=["DELETE"])
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
# DATA EXPORT API (CSV & JSON)
# =====================================================================

@project_bp.route("/api/projects/<int:project_id>/export.csv", methods=["GET"])
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


@project_bp.route("/api/export.json", methods=["GET"])
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
