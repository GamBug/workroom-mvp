"""
backend/canvas_api.py - Canvas Positions & Dependencies REST API Blueprint

Responsibilities:
- Canvas positions retrieval and batch upsert.
- Task dependencies CRUD (list dependencies, create directed edge, delete directed edge).
- Project revision increment on topology or spatial coordinate changes.
"""

from flask import Blueprint, request, jsonify

import database
from backend.common import login_required

canvas_bp = Blueprint("canvas_api", __name__)


# =====================================================================
# CANVAS POSITIONS API
# =====================================================================

@canvas_bp.route("/api/projects/<int:project_id>/canvas-positions", methods=["GET"])
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


@canvas_bp.route("/api/projects/<int:project_id>/canvas-positions", methods=["PUT"])
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
# TASK DEPENDENCIES API
# =====================================================================

@canvas_bp.route("/api/projects/<int:project_id>/dependencies", methods=["GET"])
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


@canvas_bp.route("/api/projects/<int:project_id>/dependencies", methods=["POST"])
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


@canvas_bp.route("/api/projects/<int:project_id>/dependencies", methods=["DELETE"])
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
