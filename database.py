"""
database.py - SQLite Database Management for Workroom Mini

Responsibilities:
- Establish SQLite database connections with foreign keys enabled.
- Initialize database schema (users, projects, tasks) and perform safe migrations.
- Provide explicit CRUD functions using vanilla SQL.
- Enforce data integrity and user-ownership verification on every query.
- No Flask route logic or ORM abstraction.
"""

import sqlite3
import os
import secrets
import math
from datetime import datetime, timezone

# Path to the SQLite database file in the same directory
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workroom.db")

# Sentinel for distinguishing omitted parameters from explicitly passed None
UNSET = object()

# Characters for generating secure, human-friendly join codes (excluding 0, O, 1, I)
JOIN_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def generate_join_code():
    """Generates an 8-character cryptographically secure join code in XXXX-XXXX format."""
    p1 = "".join(secrets.choice(JOIN_CODE_CHARS) for _ in range(4))
    p2 = "".join(secrets.choice(JOIN_CODE_CHARS) for _ in range(4))
    return f"{p1}-{p2}"


def generate_unique_join_code(cursor):
    """Generates a join code guaranteed to be unique within the projects table."""
    while True:
        code = generate_join_code()
        cursor.execute("SELECT 1 FROM projects WHERE join_code = ?;", (code,))
        if not cursor.fetchone():
            return code


def get_connection():
    """
    Creates and returns a connection to the SQLite database.
    - Enables foreign keys (disabled by default in SQLite).
    - Sets row_factory to sqlite3.Row so columns can be accessed by name.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def get_current_timestamp():
    """Returns ISO 8601 formatted UTC timestamp string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    """
    Initializes the database schema if tables do not already exist.
    Tables:
    1. users: stores account credentials (password_hash via Werkzeug)
    2. projects: belongs to a user (user_id foreign key with CASCADE delete)
    3. tasks: belongs to a project (project_id foreign key with CASCADE delete)
       Allowed statuses: 'Todo', 'Doing', 'Review', 'Done'
       Optional fields:
         - description (TEXT NOT NULL DEFAULT '')
         - due_date (TEXT DEFAULT NULL, formatted as 'YYYY-MM-DD')
    
    Safe Migration:
    Inspects tasks table columns and performs ALTER TABLE for any missing columns
    (description, due_date) without data loss.
    """
    with get_connection() as conn:
        cursor = conn.cursor()

        # Users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)

        # Projects table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                join_code TEXT,
                revision INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        # Tasks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL CHECK(status IN ('Todo', 'Doing', 'Review', 'Done')),
                due_date TEXT DEFAULT NULL,
                assignee_id INTEGER DEFAULT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
        """)

        # Project Members table (Collaborators joined via join_code)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS project_members (
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                joined_at TEXT NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        # Task Comments table (Plain-text task discussion)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS task_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        # Task Canvas Positions table (Presentation layout for Canvas view)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS task_canvas_positions (
                task_id INTEGER PRIMARY KEY,
                x REAL NOT NULL,
                y REAL NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
        """)

        # Task Dependencies table (Directed prerequisite edges: from_task_id -> to_task_id)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS task_dependencies (
                from_task_id INTEGER NOT NULL,
                to_task_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (from_task_id, to_task_id),
                FOREIGN KEY (from_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (to_task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
        """)

        # =================================================================
        # SCHEMA MIGRATIONS: Safe check for columns & indexes
        # =================================================================
        # 1. tasks migrations (description, due_date, assignee_id)
        cursor.execute("PRAGMA table_info(tasks);")
        t_columns = [row["name"] for row in cursor.fetchall()]

        if "description" not in t_columns:
            cursor.execute("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';")

        if "due_date" not in t_columns:
            cursor.execute("ALTER TABLE tasks ADD COLUMN due_date TEXT DEFAULT NULL;")

        if "assignee_id" not in t_columns:
            cursor.execute("ALTER TABLE tasks ADD COLUMN assignee_id INTEGER DEFAULT NULL;")

        # 2. projects migrations (join_code, revision)
        cursor.execute("PRAGMA table_info(projects);")
        p_columns = [row["name"] for row in cursor.fetchall()]

        if "join_code" not in p_columns:
            cursor.execute("ALTER TABLE projects ADD COLUMN join_code TEXT;")

        if "revision" not in p_columns:
            cursor.execute("ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;")

        # 3. Backfill any existing projects that do not yet have a join_code
        cursor.execute("SELECT id FROM projects WHERE join_code IS NULL OR join_code = '';")
        rows_missing_code = cursor.fetchall()
        for row in rows_missing_code:
            code = generate_unique_join_code(cursor)
            cursor.execute("UPDATE projects SET join_code = ? WHERE id = ?;", (code, row["id"]))

        # Indexes for query performance and join code uniqueness
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_join_code ON projects(join_code);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_canvas_positions_task_id ON task_canvas_positions(task_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_dependencies_from ON task_dependencies(from_task_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_dependencies_to ON task_dependencies(to_task_id);")

        conn.commit()


# =====================================================================
# USER OPERATIONS
# =====================================================================

def create_user(username, password_hash):
    """
    Inserts a new user into the database.
    Returns the created user dict or None if username already exists.
    """
    timestamp = get_current_timestamp()
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?);",
                (username.strip(), password_hash, timestamp)
            )
            user_id = cursor.lastrowid
            conn.commit()
            return {
                "id": user_id,
                "username": username.strip(),
                "created_at": timestamp
            }
    except sqlite3.IntegrityError:
        # Username collision
        return None


def get_user_by_username(username):
    """Retrieves a user record by username (case-insensitive due to COLLATE NOCASE)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?;", (username.strip(),))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id):
    """Retrieves a user record by ID (excluding password_hash for safety)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, created_at FROM users WHERE id = ?;", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


# =====================================================================
# PROJECT ACCESS & COLLABORATION HELPERS
# =====================================================================

def get_project_role(project_id, user_id):
    """
    Returns 'owner' if the user is the creator of the project,
    'member' if the user has joined via join code in project_members,
    or None if the user is an outsider or the project does not exist.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id FROM projects WHERE id = ?;", (project_id,))
        row = cursor.fetchone()
        if not row:
            return None
        if row["user_id"] == user_id:
            return "owner"

        cursor.execute(
            "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?;",
            (project_id, user_id)
        )
        if cursor.fetchone():
            return "member"
        return None


def can_access_project(project_id, user_id):
    """Returns True if the user is either the Owner or a Member of the project."""
    return get_project_role(project_id, user_id) is not None


def is_project_participant(project_id, user_id):
    """Returns True if the user is either the Owner or a Member of the project."""
    return can_access_project(project_id, user_id)


def is_project_owner(project_id, user_id):
    """Returns True if the user is the Owner (creator) of the project."""
    return get_project_role(project_id, user_id) == "owner"


# =====================================================================
# PROJECT OPERATIONS (Accessible: Owned + Joined)
# =====================================================================

def touch_project(cursor, project_id):
    """
    Increments the project's monotonic revision counter by 1.
    Must be called inside an active transaction.
    Returns the new revision integer.
    """
    cursor.execute(
        "UPDATE projects SET revision = revision + 1 WHERE id = ?;",
        (project_id,)
    )
    cursor.execute(
        "SELECT revision FROM projects WHERE id = ?;",
        (project_id,)
    )
    row = cursor.fetchone()
    return row["revision"] if row else 0


def get_project_revision(project_id, user_id):
    """
    Retrieves the project revision for lightweight synchronization.
    Returns (status_code: int, data_or_error: dict | str).
    - 200: {"project_id": project_id, "revision": rev, "name": name, "relationship": role}
    - 403: "You no longer have access to this Project" (if project exists but user has no role)
    - 404: "Project not found or deleted" (if project does not exist)
    """
    role = get_project_role(project_id, user_id)
    if not role:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return 403, "You no longer have access to this Project"
        return 404, "Project not found or deleted"

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, revision FROM projects WHERE id = ?;", (project_id,))
        row = cursor.fetchone()
        if not row:
            return 404, "Project not found or deleted"
        return 200, {
            "project_id": row["id"],
            "revision": row["revision"],
            "name": row["name"],
            "relationship": role
        }


def get_projects_by_user(user_id):
    """
    Returns all projects accessible to the user (owned or joined), ordered by ID ASC.
    Each item contains: id, name, relationship ('owner' or 'member'), revision, created_at.
    DOES NOT leak join_code.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT p.id, p.name, p.revision, p.created_at,
                CASE
                    WHEN p.user_id = ? THEN 'owner'
                    ELSE 'member'
                END AS relationship
            FROM projects p
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               )
            ORDER BY p.id ASC;
        """, (user_id, user_id, user_id))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_project(project_id, user_id):
    """
    Retrieves a single project by ID if accessible by user (owner or member).
    Returns dict with id, name, created_at, revision, relationship ('owner' or 'member').
    DOES NOT include join_code.
    Returns None if not found or unauthorized.
    """
    role = get_project_role(project_id, user_id)
    if not role:
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, revision, created_at FROM projects WHERE id = ?;", (project_id,))
        row = cursor.fetchone()
        if not row:
            return None
        p = dict(row)
        p["relationship"] = role
        return p


def create_project(user_id, name):
    """
    Creates a new project for user_id as owner with a unique join_code.
    Returns dict with id, name, relationship ('owner'), revision (0), created_at.
    """
    timestamp = get_current_timestamp()
    with get_connection() as conn:
        cursor = conn.cursor()
        join_code = generate_unique_join_code(cursor)
        cursor.execute(
            "INSERT INTO projects (user_id, name, join_code, revision, created_at) VALUES (?, ?, ?, 0, ?);",
            (user_id, name.strip(), join_code, timestamp)
        )
        project_id = cursor.lastrowid
        conn.commit()
        return {
            "id": project_id,
            "name": name.strip(),
            "relationship": "owner",
            "revision": 0,
            "created_at": timestamp
        }


def rename_project(project_id, user_id, new_name):
    """
    Renames a project, enforcing owner-only permission.
    Updates revision counter.
    Returns the updated project dict, or None if unauthorized/not found.
    """
    if not is_project_owner(project_id, user_id):
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE projects SET name = ? WHERE id = ? AND user_id = ?;",
            (new_name.strip(), project_id, user_id)
        )
        if cursor.rowcount == 0:
            return None
        touch_project(cursor, project_id)
        conn.commit()
        return get_project(project_id, user_id)


def delete_project(project_id, user_id):
    """
    Deletes a project belonging to user_id, enforcing owner-only permission.
    Due to ON DELETE CASCADE, tasks and memberships are automatically deleted.
    Returns True if deleted, False if unauthorized/not found.
    """
    if not is_project_owner(project_id, user_id):
        return False

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM projects WHERE id = ? AND user_id = ?;",
            (project_id, user_id)
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


# =====================================================================
# PROJECT MEMBERSHIP & JOIN CODE OPERATIONS
# =====================================================================

def join_project_by_code(join_code, user_id):
    """
    Joins a project using its unique join code.
    Normalizes code: uppercase, whitespace trimmed.
    Returns (status_code: int, result_or_error: dict | str).
    """
    clean_code = (join_code or "").strip().upper()
    if not clean_code:
        return 400, "Join code is required."

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, user_id, name, created_at FROM projects WHERE join_code = ?;", (clean_code,))
        project = cursor.fetchone()
        if not project:
            return 404, "Invalid Join Code."

        pid = project["id"]
        owner_id = project["user_id"]

        if owner_id == user_id:
            return 400, "You already own this Project."

        cursor.execute("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?;", (pid, user_id))
        if cursor.fetchone():
            return 409, "You are already a member of this Project."

        timestamp = get_current_timestamp()
        cursor.execute(
            "INSERT INTO project_members (project_id, user_id, joined_at) VALUES (?, ?, ?);",
            (pid, user_id, timestamp)
        )
        new_rev = touch_project(cursor, pid)
        conn.commit()

        return 200, {
            "id": pid,
            "name": project["name"],
            "relationship": "member",
            "revision": new_rev,
            "created_at": project["created_at"]
        }


def get_project_members(project_id, user_id):
    """
    Returns the project participant list: owner first, then members.
    Accessible to both Owner and Members.
    If user is owner, returns 'join_code'. If member, 'join_code' is not included.
    Returns None if unauthorized or project does not exist.
    """
    role = get_project_role(project_id, user_id)
    if not role:
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        # Owner
        cursor.execute("""
            SELECT u.id, u.username
            FROM users u
            JOIN projects p ON p.user_id = u.id
            WHERE p.id = ?;
        """, (project_id,))
        owner_row = cursor.fetchone()
        if not owner_row:
            return None

        members = [{
            "id": owner_row["id"],
            "username": owner_row["username"],
            "relationship": "owner"
        }]

        # Members (excluding owner if somehow present)
        cursor.execute("""
            SELECT u.id, u.username, pm.joined_at
            FROM users u
            JOIN project_members pm ON pm.user_id = u.id
            WHERE pm.project_id = ? AND u.id != ?
            ORDER BY u.username COLLATE NOCASE ASC;
        """, (project_id, owner_row["id"]))
        for row in cursor.fetchall():
            members.append({
                "id": row["id"],
                "username": row["username"],
                "relationship": "member"
            })

        data = {"members": members}
        if role == "owner":
            cursor.execute("SELECT join_code FROM projects WHERE id = ?;", (project_id,))
            p_row = cursor.fetchone()
            data["join_code"] = p_row["join_code"] if p_row else None

        return data


def regenerate_project_join_code(project_id, user_id):
    """
    Generates a new unique join code for the project. Owner only!
    Updates revision counter.
    Returns (join_code, revision) or (None, 0) if unauthorized.
    """
    if not is_project_owner(project_id, user_id):
        return None, 0

    with get_connection() as conn:
        cursor = conn.cursor()
        new_code = generate_unique_join_code(cursor)
        cursor.execute(
            "UPDATE projects SET join_code = ? WHERE id = ? AND user_id = ?;",
            (new_code, project_id, user_id)
        )
        if cursor.rowcount == 0:
            return None, 0
        new_rev = touch_project(cursor, project_id)
        conn.commit()
        return new_code, new_rev


def remove_project_member(project_id, owner_id, target_user_id):
    """
    Removes a member from project_members. Owner only!
    Cannot remove the owner.
    Transactionally unassigns all tasks in this project assigned to target_user_id
    and increments the project revision counter.
    Returns (status_code: int, error_message: str | None, project_revision: int).
    """
    if not is_project_owner(project_id, owner_id):
        return 403, "Only the project owner can remove members.", 0

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id FROM projects WHERE id = ?;", (project_id,))
        p_row = cursor.fetchone()
        if not p_row:
            return 404, "Project not found.", 0

        if p_row["user_id"] == target_user_id:
            return 400, "Cannot remove project owner from project.", 0

        cursor.execute(
            "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?;",
            (project_id, target_user_id)
        )
        if not cursor.fetchone():
            return 404, "Member not found in this project.", 0

        # 1. Unassign all tasks in this project assigned to target_user_id
        cursor.execute(
            "UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?;",
            (project_id, target_user_id)
        )

        # 2. Delete membership
        cursor.execute(
            "DELETE FROM project_members WHERE project_id = ? AND user_id = ?;",
            (project_id, target_user_id)
        )

        # 3. Increment revision
        new_rev = touch_project(cursor, project_id)
        conn.commit()
        return 200, None, new_rev


# =====================================================================
# TASK OPERATIONS (Owner or Member access)
# =====================================================================

def get_tasks_by_project(project_id, user_id):
    """
    Returns all tasks for a project, verifying the user has access (owner or member).
    Includes assignee_id and assignee_username via LEFT JOIN.
    Returns None if project not found or unauthorized.
    """
    if not can_access_project(project_id, user_id):
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.project_id, t.title, t.description, t.status, t.due_date,
                   t.assignee_id, u.username AS assignee_username, t.created_at
            FROM tasks t
            LEFT JOIN users u ON t.assignee_id = u.id
            WHERE t.project_id = ?
            ORDER BY t.id ASC;
        """, (project_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_task(task_id, user_id):
    """
    Retrieves a single task by ID, verifying that the user has access
    to its parent project (as owner or member).
    Includes assignee_id and assignee_username via LEFT JOIN.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.project_id, t.title, t.description, t.status, t.due_date,
                   t.assignee_id, u.username AS assignee_username, t.created_at
            FROM tasks t
            LEFT JOIN users u ON t.assignee_id = u.id
            WHERE t.id = ?;
        """, (task_id,))
        row = cursor.fetchone()
        if not row:
            return None
        task = dict(row)
        if not can_access_project(task["project_id"], user_id):
            return None
        return task


def create_task(project_id, user_id, title, description="", status="Todo", due_date=None, assignee_id=None):
    """
    Creates a new task in project_id, verifying user has access (owner or member).
    Allowed statuses: 'Todo', 'Doing', 'Review', 'Done'.
    Validates assignee_id is a project participant if provided.
    """
    if status not in ("Todo", "Doing", "Review", "Done"):
        return None

    clean_title = (title or "").strip()
    if not clean_title:
        return None

    clean_desc = (description or "").strip()
    clean_due_date = due_date.strip() if (due_date and isinstance(due_date, str) and due_date.strip()) else None

    # Verify project access (owner or member)
    if not can_access_project(project_id, user_id):
        return None

    # Verify assignee is participant if provided
    clean_assignee_id = None
    if assignee_id is not None:
        if not is_project_participant(project_id, assignee_id):
            return None
        clean_assignee_id = assignee_id

    timestamp = get_current_timestamp()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO tasks (project_id, title, description, status, due_date, assignee_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (project_id, clean_title, clean_desc, status, clean_due_date, clean_assignee_id, timestamp))
        task_id = cursor.lastrowid
        new_rev = touch_project(cursor, project_id)
        conn.commit()

    task = get_task(task_id, user_id)
    if task:
        task["project_revision"] = new_rev
    return task


def update_task(task_id, user_id, title=None, description=None, status=None, due_date=UNSET, assignee_id=UNSET):
    """
    Updates a task's title, description, status, due_date, and/or assignee_id.
    Verifies user has project access and validates assignee_id if specified.
    Updates revision counter.
    """
    existing_task = get_task(task_id, user_id)
    if not existing_task:
        return None

    new_title = title.strip() if title is not None else existing_task["title"]
    new_desc = description.strip() if description is not None else existing_task["description"]
    new_status = status if status is not None else existing_task["status"]

    if due_date is UNSET:
        new_due_date = existing_task["due_date"]
    else:
        new_due_date = due_date.strip() if (due_date and isinstance(due_date, str) and due_date.strip()) else None

    if assignee_id is UNSET:
        new_assignee_id = existing_task["assignee_id"]
    else:
        if assignee_id is not None:
            if not is_project_participant(existing_task["project_id"], assignee_id):
                return None
            new_assignee_id = assignee_id
        else:
            new_assignee_id = None

    if new_status not in ("Todo", "Doing", "Review", "Done"):
        return None

    if not new_title:
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE tasks
            SET title = ?, description = ?, status = ?, due_date = ?, assignee_id = ?
            WHERE id = ?;
        """, (new_title, new_desc, new_status, new_due_date, new_assignee_id, task_id))
        new_rev = touch_project(cursor, existing_task["project_id"])
        conn.commit()
        updated_task = get_task(task_id, user_id)
        if updated_task:
            updated_task["project_revision"] = new_rev
        return updated_task


def delete_task(task_id, user_id):
    """
    Deletes a task by ID, verifying user has access to parent project.
    Updates project revision counter.
    Returns (success: bool, project_revision: int).
    """
    existing_task = get_task(task_id, user_id)
    if not existing_task:
        return False, 0

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = ?;", (task_id,))
        deleted = cursor.rowcount > 0
        new_rev = touch_project(cursor, existing_task["project_id"]) if deleted else 0
        conn.commit()
        return deleted, new_rev


# =====================================================================
# TASK COMMENT OPERATIONS (Owner or Member access)
# =====================================================================

def get_task_comments(task_id, user_id):
    """
    Returns all comments for a task ordered by created_at ASC, id ASC.
    Verifies user has access to task's project.
    Includes can_delete flag (True if user is comment author or project owner).
    Returns None if unauthorized or task not found.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.project_id, p.user_id AS project_owner_id
            FROM tasks t
            JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?;
        """, (task_id,))
        task_row = cursor.fetchone()
        if not task_row:
            return None

        if not can_access_project(task_row["project_id"], user_id):
            return None

        project_owner_id = task_row["project_owner_id"]
        is_owner = (project_owner_id == user_id)

        cursor.execute("""
            SELECT c.id, c.task_id, c.user_id, u.username, c.content, c.created_at
            FROM task_comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.task_id = ?
            ORDER BY c.created_at ASC, c.id ASC;
        """, (task_id,))
        rows = cursor.fetchall()
        comments = []
        for row in rows:
            c = dict(row)
            c["author"] = c["username"]
            c["can_delete"] = is_owner or (c["user_id"] == user_id)
            comments.append(c)
        return comments


def create_task_comment(task_id, user_id, content):
    """
    Creates a new comment on task_id for user_id.
    Verifies user has access to task's project.
    Validates content (1 to 5000 chars).
    Returns created comment dict or None on error/unauthorized.
    """
    clean_content = (content or "").strip()
    if not clean_content or len(clean_content) > 5000:
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.project_id, p.user_id AS project_owner_id
            FROM tasks t
            JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?;
        """, (task_id,))
        task_row = cursor.fetchone()
        if not task_row:
            return None

        if not can_access_project(task_row["project_id"], user_id):
            return None

        timestamp = get_current_timestamp()
        cursor.execute("""
            INSERT INTO task_comments (task_id, user_id, content, created_at)
            VALUES (?, ?, ?, ?);
        """, (task_id, user_id, clean_content, timestamp))
        comment_id = cursor.lastrowid
        new_rev = touch_project(cursor, task_row["project_id"])
        conn.commit()

        cursor.execute("SELECT username FROM users WHERE id = ?;", (user_id,))
        user_row = cursor.fetchone()
        username = user_row["username"] if user_row else ""

        return {
            "id": comment_id,
            "task_id": task_id,
            "user_id": user_id,
            "username": username,
            "author": username,
            "content": clean_content,
            "created_at": timestamp,
            "can_delete": True,
            "project_revision": new_rev
        }


def delete_comment(comment_id, user_id):
    """
    Deletes a comment by comment_id.
    Authorized ONLY if:
    - User still has access to the project
    AND
    - User is the comment author OR user is the project owner.
    Updates revision counter.
    Returns (status_code: int, error_message: str | None, project_revision: int).
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.id, c.user_id, t.project_id, p.user_id AS project_owner_id
            FROM task_comments c
            JOIN tasks t ON c.task_id = t.id
            JOIN projects p ON t.project_id = p.id
            WHERE c.id = ?;
        """, (comment_id,))
        row = cursor.fetchone()
        if not row:
            return 404, "Comment not found.", 0

        project_id = row["project_id"]
        # User must still have project access
        if not can_access_project(project_id, user_id):
            return 403, "You no longer have access to this Project.", 0

        project_owner_id = row["project_owner_id"]
        is_owner = (project_owner_id == user_id)
        is_author = (row["user_id"] == user_id)

        if not (is_owner or is_author):
            return 403, "You do not have permission to delete this comment.", 0

        cursor.execute("DELETE FROM task_comments WHERE id = ?;", (comment_id,))
        new_rev = touch_project(cursor, project_id)
        conn.commit()
        return 200, None, new_rev


# =====================================================================
# DASHBOARD OPERATIONS (All accessible projects: Owned + Joined)
# =====================================================================

def get_dashboard_data(user_id):
    """
    Fetches raw dashboard data (all accessible projects and tasks for user_id).
    Includes projects owned and projects joined.
    DOES NOT leak join_code.
    Includes assignee_id and assignee_username on tasks.
    Returns:
    {
        "projects": [ {"id": ..., "name": ..., "relationship": "owner"|"member", "created_at": ...}, ... ],
        "tasks": [ {"id": ..., "project_id": ..., "project_name": ..., "title": ..., "description": ..., "status": ..., "due_date": ..., "assignee_id": ..., "assignee_username": ..., "created_at": ...}, ... ]
    }
    """
    with get_connection() as conn:
        cursor = conn.cursor()

        # 1. Projects accessible by user (owned or joined)
        cursor.execute("""
            SELECT p.id, p.name, p.revision, p.created_at,
                CASE
                    WHEN p.user_id = ? THEN 'owner'
                    ELSE 'member'
                END AS relationship
            FROM projects p
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               )
            ORDER BY p.id ASC;
        """, (user_id, user_id, user_id))
        projects = [dict(row) for row in cursor.fetchall()]

        # 2. Tasks belonging to those accessible projects
        cursor.execute("""
            SELECT t.id, t.project_id, p.name AS project_name, t.title, t.description,
                   t.status, t.due_date, t.assignee_id, u.username AS assignee_username, t.created_at
            FROM tasks t
            JOIN projects p ON t.project_id = p.id
            LEFT JOIN users u ON t.assignee_id = u.id
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               )
            ORDER BY t.id ASC;
        """, (user_id, user_id))
        tasks = [dict(row) for row in cursor.fetchall()]

        return {
            "projects": projects,
            "tasks": tasks
        }


# =====================================================================
# DATA EXPORT OPERATIONS (All accessible projects: Owned + Joined)
# =====================================================================

def get_all_projects_and_tasks_for_export(user_id):
    """
    Retrieves all accessible projects (owned and joined) and their tasks for a user,
    structured for JSON export.
    Avoids N+1 queries by executing exactly three bulk queries (projects, tasks, comments).
    Includes 'relationship' ('owner' or 'member') on each project.
    Includes 'assignee' (username or null) and 'comments' (author, content, created_at) on each task.
    Excludes sensitive credentials and join codes.
    Stable sorting by ID ascending.
    """
    with get_connection() as conn:
        cursor = conn.cursor()

        # 1. Accessible projects
        cursor.execute("""
            SELECT p.id, p.name, p.created_at,
                CASE
                    WHEN p.user_id = ? THEN 'owner'
                    ELSE 'member'
                END AS relationship
            FROM projects p
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               )
            ORDER BY p.id ASC;
        """, (user_id, user_id, user_id))
        projects = [dict(row) for row in cursor.fetchall()]

        # 2. Tasks belonging to those projects
        cursor.execute("""
            SELECT t.id, t.project_id, t.title, t.description, t.status, t.due_date,
                   u.username AS assignee_username, t.created_at
            FROM tasks t
            JOIN projects p ON t.project_id = p.id
            LEFT JOIN users u ON t.assignee_id = u.id
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               )
            ORDER BY t.id ASC;
        """, (user_id, user_id))
        tasks = [dict(row) for row in cursor.fetchall()]

        # 3. Comments belonging to those accessible tasks
        cursor.execute("""
            SELECT c.id, c.task_id, u.username AS author, c.content, c.created_at
            FROM task_comments c
            JOIN users u ON c.user_id = u.id
            JOIN tasks t ON c.task_id = t.id
            JOIN projects p ON t.project_id = p.id
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               )
            ORDER BY c.id ASC;
        """, (user_id, user_id))
        comments = [dict(row) for row in cursor.fetchall()]

        # 4. Canvas positions belonging to those accessible tasks
        cursor.execute("""
            SELECT tcp.task_id, tcp.x, tcp.y
            FROM task_canvas_positions tcp
            JOIN tasks t ON tcp.task_id = t.id
            JOIN projects p ON t.project_id = p.id
            WHERE p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               );
        """, (user_id, user_id))
        pos_rows = cursor.fetchall()
        positions_by_task = {
            row["task_id"]: {
                "x": round(float(row["x"]), 1),
                "y": round(float(row["y"]), 1)
            }
            for row in pos_rows
        }

        # Group comments under corresponding task
        comments_by_task = {}
        for comment in comments:
            tid = comment["task_id"]
            if tid not in comments_by_task:
                comments_by_task[tid] = []
            comments_by_task[tid].append({
                "id": comment["id"],
                "author": comment["author"],
                "content": comment["content"],
                "created_at": comment["created_at"]
            })

        # Group tasks under corresponding project
        tasks_by_project = {}
        for task in tasks:
            pid = task["project_id"]
            if pid not in tasks_by_project:
                tasks_by_project[pid] = []
            tasks_by_project[pid].append({
                "id": task["id"],
                "title": task["title"],
                "description": task["description"] or "",
                "status": task["status"],
                "due_date": task["due_date"],
                "assignee": task["assignee_username"],
                "canvas_position": positions_by_task.get(task["id"]),
                "created_at": task["created_at"],
                "comments": comments_by_task.get(task["id"], [])
            })

        # 5. Dependencies belonging to those accessible projects
        cursor.execute("""
            SELECT td.from_task_id, td.to_task_id, td.created_at, t1.project_id
            FROM task_dependencies td
            JOIN tasks t1 ON td.from_task_id = t1.id
            JOIN tasks t2 ON td.to_task_id = t2.id
            JOIN projects p ON t1.project_id = p.id
            WHERE (p.user_id = ?
               OR EXISTS (
                   SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id AND pm.user_id = ?
               ))
               AND t1.project_id = t2.project_id
            ORDER BY td.created_at ASC, td.from_task_id ASC, td.to_task_id ASC;
        """, (user_id, user_id))
        dep_rows = cursor.fetchall()
        dependencies_by_project = {}
        for row in dep_rows:
            pid = row["project_id"]
            if pid not in dependencies_by_project:
                dependencies_by_project[pid] = []
            dependencies_by_project[pid].append({
                "from_task_id": row["from_task_id"],
                "to_task_id": row["to_task_id"],
                "created_at": row["created_at"]
            })

        for project in projects:
            project["tasks"] = tasks_by_project.get(project["id"], [])
            project["dependencies"] = dependencies_by_project.get(project["id"], [])

        return projects


# =====================================================================
# CANVAS POSITION OPERATIONS (Owner or Member access)
# =====================================================================

def get_canvas_positions(project_id, user_id):
    """
    Retrieves all task canvas positions for a project, verifying the user has access (owner or member).
    Returns list of dicts: [{"task_id": int, "x": float, "y": float}, ...]
    Returns None if unauthorized or project not found.
    """
    if not can_access_project(project_id, user_id):
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT tcp.task_id, tcp.x, tcp.y
            FROM task_canvas_positions tcp
            JOIN tasks t ON tcp.task_id = t.id
            WHERE t.project_id = ?
            ORDER BY tcp.task_id ASC;
        """, (project_id,))
        rows = cursor.fetchall()
        return [
            {
                "task_id": row["task_id"],
                "x": round(float(row["x"]), 1),
                "y": round(float(row["y"]), 1)
            }
            for row in rows
        ]


def save_canvas_positions(project_id, user_id, positions):
    """
    Saves (upserts) one or more task canvas positions for a project.
    Accessible to both Owner and Members.
    Transactional & all-or-nothing: validates every task belongs to project_id and coordinates are safe.
    Increments project revision exactly once.
    Returns: (status_code: int, error_message: str | None, result_data: dict | None)
    """
    role = get_project_role(project_id, user_id)
    if not role:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return 403, "You no longer have access to this Project.", None
        return 404, "Project not found or unauthorized.", None

    if not isinstance(positions, list) or len(positions) == 0:
        return 400, "Positions list cannot be empty.", None

    # Check for duplicate task_ids in the batch
    seen_task_ids = set()
    validated_items = []
    for item in positions:
        if not isinstance(item, dict):
            return 400, "Each position entry must be an object.", None

        task_id = item.get("task_id")
        if task_id is None or isinstance(task_id, bool):
            return 400, "Invalid or missing task_id.", None
        try:
            task_id = int(task_id)
        except (ValueError, TypeError):
            return 400, "task_id must be an integer.", None

        if task_id in seen_task_ids:
            return 400, f"Duplicate task_id {task_id} in positions payload.", None
        seen_task_ids.add(task_id)

        x_raw = item.get("x")
        y_raw = item.get("y")
        if x_raw is None or y_raw is None or isinstance(x_raw, bool) or isinstance(y_raw, bool):
            return 400, f"x and y coordinates are required for task {task_id}.", None

        try:
            x_val = float(x_raw)
            y_val = float(y_raw)
        except (ValueError, TypeError):
            return 400, f"Coordinates must be numeric for task {task_id}.", None

        if math.isnan(x_val) or math.isinf(x_val) or math.isnan(y_val) or math.isinf(y_val):
            return 400, f"Coordinates must be finite numbers for task {task_id}.", None

        if x_val < 0 or y_val < 0:
            return 400, f"Coordinates cannot be negative for task {task_id}.", None

        if x_val > 100000 or y_val > 100000:
            return 400, f"Coordinates exceed maximum bounds (100000) for task {task_id}.", None

        validated_items.append({
            "task_id": task_id,
            "x": round(x_val, 1),
            "y": round(y_val, 1)
        })

    with get_connection() as conn:
        cursor = conn.cursor()

        # Verify all tasks exist and belong to this project
        placeholders = ",".join("?" for _ in validated_items)
        task_id_list = [item["task_id"] for item in validated_items]
        cursor.execute(f"SELECT id, project_id FROM tasks WHERE id IN ({placeholders});", task_id_list)
        found_tasks = {row["id"]: row["project_id"] for row in cursor.fetchall()}

        for item in validated_items:
            tid = item["task_id"]
            if tid not in found_tasks:
                return 404, f"Task {tid} not found.", None
            if found_tasks[tid] != project_id:
                return 400, f"Task {tid} does not belong to Project {project_id}.", None

        # All-or-nothing batch upsert
        for item in validated_items:
            cursor.execute("""
                INSERT INTO task_canvas_positions (task_id, x, y)
                VALUES (?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    x = excluded.x,
                    y = excluded.y;
            """, (item["task_id"], item["x"], item["y"]))

        new_rev = touch_project(cursor, project_id)
        conn.commit()

        return 200, None, {
            "positions": validated_items,
            "project_revision": new_rev
        }


# =====================================================================
# TASK DEPENDENCY OPERATIONS (Owner or Member access)
# =====================================================================

def get_project_dependencies(project_id, user_id):
    """
    Retrieves all task dependencies for a project, verifying the user has access (owner or member).
    Returns list of dicts: [{"from_task_id": int, "to_task_id": int, "created_at": str}, ...]
    Returns None if unauthorized or project not found.
    Does not touch project revision.
    """
    if not can_access_project(project_id, user_id):
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT td.from_task_id, td.to_task_id, td.created_at
            FROM task_dependencies td
            JOIN tasks t1 ON td.from_task_id = t1.id
            JOIN tasks t2 ON td.to_task_id = t2.id
            WHERE t1.project_id = ? AND t2.project_id = ?
            ORDER BY td.created_at ASC, td.from_task_id ASC, td.to_task_id ASC;
        """, (project_id, project_id))
        rows = cursor.fetchall()
        return [
            {
                "from_task_id": row["from_task_id"],
                "to_task_id": row["to_task_id"],
                "created_at": row["created_at"]
            }
            for row in rows
        ]


def create_task_dependency(project_id, user_id, from_task_id, to_task_id):
    """
    Creates a new directed dependency: from_task_id -> to_task_id (to_task_id depends on from_task_id).
    Accessible to both Owner and Members.
    Validations:
    - User has project access (403 if lost access, 404 if project missing)
    - Valid integer IDs
    - No self-link (400)
    - Both tasks exist and belong to project_id (404/400)
    - No cross-project dependency (400)
    - No duplicate dependency (409)
    Transactional: increments project revision exactly once.
    Returns: (status_code: int, error_message: str | None, result_data: dict | None)
    """
    role = get_project_role(project_id, user_id)
    if not role:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return 403, "You no longer have access to this Project.", None
        return 404, "Project not found or unauthorized.", None

    if from_task_id is None or to_task_id is None or isinstance(from_task_id, bool) or isinstance(to_task_id, bool):
        return 400, "from_task_id and to_task_id are required.", None

    try:
        from_task_id = int(from_task_id)
        to_task_id = int(to_task_id)
    except (ValueError, TypeError):
        return 400, "Task IDs must be integers.", None

    # No self-link (Section 11)
    if from_task_id == to_task_id:
        return 400, "A task cannot depend on itself.", None

    timestamp = get_current_timestamp()

    with get_connection() as conn:
        cursor = conn.cursor()

        # Check tasks existence and project assignment (Section 14, 16)
        cursor.execute("SELECT id, project_id FROM tasks WHERE id IN (?, ?);", (from_task_id, to_task_id))
        found = {row["id"]: row["project_id"] for row in cursor.fetchall()}

        if from_task_id not in found:
            return 404, f"Prerequisite task {from_task_id} not found.", None
        if to_task_id not in found:
            return 404, f"Target task {to_task_id} not found.", None

        if found[from_task_id] != project_id or found[to_task_id] != project_id:
            return 400, "Both tasks must belong to this Project.", None

        # Check for duplicate edge (Section 12)
        cursor.execute(
            "SELECT 1 FROM task_dependencies WHERE from_task_id = ? AND to_task_id = ?;",
            (from_task_id, to_task_id)
        )
        if cursor.fetchone():
            return 409, "Dependency already exists.", None

        try:
            cursor.execute("""
                INSERT INTO task_dependencies (from_task_id, to_task_id, created_at)
                VALUES (?, ?, ?);
            """, (from_task_id, to_task_id, timestamp))
        except sqlite3.IntegrityError:
            return 409, "Dependency already exists.", None

        new_rev = touch_project(cursor, project_id)
        conn.commit()

        return 201, None, {
            "from_task_id": from_task_id,
            "to_task_id": to_task_id,
            "created_at": timestamp,
            "project_revision": new_rev
        }


def delete_task_dependency(project_id, user_id, from_task_id, to_task_id):
    """
    Deletes an existing directed dependency: from_task_id -> to_task_id.
    Accessible to both Owner and Members.
    Transactional: increments project revision exactly once.
    Returns: (status_code: int, error_message: str | None, result_data: dict | None)
    """
    role = get_project_role(project_id, user_id)
    if not role:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM projects WHERE id = ?;", (project_id,))
            if cursor.fetchone():
                return 403, "You no longer have access to this Project.", None
        return 404, "Project not found or unauthorized.", None

    if from_task_id is None or to_task_id is None or isinstance(from_task_id, bool) or isinstance(to_task_id, bool):
        return 400, "from_task_id and to_task_id are required.", None

    try:
        from_task_id = int(from_task_id)
        to_task_id = int(to_task_id)
    except (ValueError, TypeError):
        return 400, "Task IDs must be integers.", None

    with get_connection() as conn:
        cursor = conn.cursor()

        # Check tasks belong to this project
        cursor.execute("SELECT id, project_id FROM tasks WHERE id IN (?, ?);", (from_task_id, to_task_id))
        found = {row["id"]: row["project_id"] for row in cursor.fetchall()}

        if from_task_id not in found or to_task_id not in found:
            return 404, "Task not found.", None

        if found[from_task_id] != project_id or found[to_task_id] != project_id:
            return 400, "Both tasks must belong to this Project.", None

        cursor.execute("""
            DELETE FROM task_dependencies
            WHERE from_task_id = ? AND to_task_id = ?;
        """, (from_task_id, to_task_id))

        if cursor.rowcount == 0:
            return 404, "Dependency not found.", None

        new_rev = touch_project(cursor, project_id)
        conn.commit()

        return 200, None, {
            "project_revision": new_rev
        }


