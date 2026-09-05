"""
backend/task_api.py - Task & Comment REST API Blueprint

Responsibilities:
- Task CRUD operations (list project tasks, create task, patch/update task, delete task).
- Assignee validation against project participant roster.
- Due date validation and normalization.
- Task Comments (list comments, post comment, delete comment).
"""

from flask import Blueprint, request, jsonify

import database
from backend.common import login_required, validate_due_date

task_bp = Blueprint("task_api", __name__)


# =====================================================================
# TASK API
# =====================================================================

@task_bp.route("/api/projects/<int:project_id>/tasks", methods=["GET"])
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


@task_bp.route("/api/projects/<int:project_id>/tasks", methods=["POST"])
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


@task_bp.route("/api/tasks/<int:task_id>", methods=["PATCH"])
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

    if status not in (None, "Todo", "Doing", "Review", "Done"):
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


@task_bp.route("/api/tasks/<int:task_id>", methods=["DELETE"])
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
# TASK COMMENT API
# =====================================================================

@task_bp.route("/api/tasks/<int:task_id>/comments", methods=["GET"])
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


@task_bp.route("/api/tasks/<int:task_id>/comments", methods=["POST"])
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


@task_bp.route("/api/comments/<int:comment_id>", methods=["DELETE"])
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
