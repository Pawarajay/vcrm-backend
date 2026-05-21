// routes/projects.js  —  v4 (FK-safe, column-safe)
const express = require("express");
const router  = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

const STATUS_OPTIONS   = ["Requirement", "In Progress", "Delivered", "On Hold"];
const SERVICE_OPTIONS  = ["Website", "WhatsApp API", "LMS", "CRM", "Social Media", "Other"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Critical"];

const authId   = (req) => req.user?.id || null;
const safeDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const ok404 = (res, rows, msg = "Not found") => {
  if (!rows.length) { res.status(404).json({ error: msg }); return true; }
  return false;
};

// ─── Verify FK exists before using it ────────────────────────────────────────
// Prevents "Cannot add or update a child row: a foreign key constraint fails"
// when client_id / deal_id are stale or don't exist in the DB.

async function safeFK(table, id) {
  if (!id) return null;
  try {
    const [rows] = await pool.query(`SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
    return rows.length ? id : null;
  } catch {
    return null;
  }
}

// ─── Check which optional columns exist in the projects table ─────────────────
// This prevents 500s when the schema doesn't have `notes` yet.
let _projectCols = null;
async function getProjectCols() {
  if (_projectCols) return _projectCols;
  const [rows] = await pool.query("SHOW COLUMNS FROM projects");
  _projectCols = new Set(rows.map(r => r.Field));
  return _projectCols;
}

// ─── SELECT helper ─────────────────────────────────────────────────────────────

const PROJECT_SELECT = `
  SELECT
    p.*,
    p.completion_percentage     AS progress_percentage,
    c.name                      AS client_name,
    cb.name                     AS created_by_name,
    COUNT(t.id)                 AS task_count,
    SUM(t.status = 'Complete')  AS task_done_count
  FROM projects p
  LEFT JOIN customers     c  ON c.id  = p.client_id
  LEFT JOIN users         cb ON cb.id = p.created_by
  LEFT JOIN project_tasks t  ON t.project_id = p.id
`;

// =============================================================================
// GET ALL
// =============================================================================
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { status, service, priority, search, client_id } = req.query;
    let where = "WHERE 1=1";
    const params = [];

    if (status)    { where += " AND p.status = ?";    params.push(status); }
    if (service)   { where += " AND p.service = ?";   params.push(service); }
    if (priority)  { where += " AND p.priority = ?";  params.push(priority); }
    if (client_id) { where += " AND p.client_id = ?"; params.push(client_id); }
    if (search) {
      where += " AND (p.title LIKE ? OR c.name LIKE ? OR p.sales_owner LIKE ? OR p.project_manager LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [rows] = await pool.query(
      `${PROJECT_SELECT} ${where} GROUP BY p.id ORDER BY p.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("getAllProjects:", err);
    res.status(500).json({ error: "Failed to fetch projects", detail: err.message });
  }
});

// =============================================================================
// GET BY ID
// =============================================================================
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`,
      [req.params.id]
    );
    if (ok404(res, rows, "Project not found")) return;
    res.json(rows[0]);
  } catch (err) {
    console.error("getProjectById:", err);
    res.status(500).json({ error: "Failed to fetch project", detail: err.message });
  }
});

// =============================================================================
// CREATE
// =============================================================================
router.post("/", authenticateToken, async (req, res) => {
  try {
    const {
      title,
      client_id,
      deal_id,
      service,
      description,
      status              = "Requirement",
      start_date,
      delivery_date,
      sales_owner,
      project_manager,
      developer_assigned,
      priority            = "Medium",
      progress_percentage,
      completion_percentage,
      update_note,
      project_update,
      notes,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: "Project title is required" });
    }

    const resolvedProgress = Number(progress_percentage ?? completion_percentage ?? 0);
    const resolvedNote     = update_note || project_update || null;

    // Validate FKs — pass null if the referenced row doesn't exist
    const safeClientId = await safeFK("customers", client_id);
    const safeDealId   = await safeFK("deals",     deal_id);

    const cols  = await getProjectCols();
    const hasNotes = cols.has("notes");

    const projectId = uuidv4();

    const insertCols = [
      "id", "title", "client_id", "deal_id", "service",
      "description", "status", "start_date", "delivery_date",
      "sales_owner", "project_manager", "developer_assigned",
      "priority", "completion_percentage", "project_update",
      "created_by", "created_at", "updated_at",
    ];
    const insertVals = [
      projectId,
      title.trim(),
      safeClientId,
      safeDealId,
      service            || null,
      description        || null,
      status,
      safeDate(start_date),
      safeDate(delivery_date),
      sales_owner        || null,
      project_manager    || null,
      developer_assigned || null,
      priority,
      resolvedProgress,
      resolvedNote,
      authId(req),
    ];

    // Only add `notes` column if it exists in the schema
    if (hasNotes) {
      insertCols.splice(insertCols.indexOf("created_by"), 0, "notes");
      insertVals.splice(insertCols.indexOf("created_by"), 0, notes || null);
    }

    // Push timestamps values (already appended above as strings in cols)
    insertVals.push("CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP");

    // Build placeholders — replace CURRENT_TIMESTAMP literals with NOW()
    const placeholders = insertVals.map((v, i) => {
      const col = insertCols[i];
      return (col === "created_at" || col === "updated_at") ? "CURRENT_TIMESTAMP" : "?";
    });

    // Filter out the timestamp cols from ? values
    const filteredVals = insertVals.filter((_, i) => {
      const col = insertCols[i];
      return col !== "created_at" && col !== "updated_at";
    });

    await pool.query(
      `INSERT INTO projects (${insertCols.join(", ")})
       VALUES (${placeholders.join(", ")})`,
      filteredVals
    );

    const [rows] = await pool.query(
      `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`,
      [projectId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createProject:", err);
    res.status(500).json({ error: "Failed to create project", detail: err.message });
  }
});

// =============================================================================
// UPDATE (PUT)
// =============================================================================
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const [check] = await pool.query("SELECT id FROM projects WHERE id = ?", [req.params.id]);
    if (ok404(res, check, "Project not found")) return;

    const {
      title, client_id, deal_id, service, description,
      status, start_date, delivery_date,
      sales_owner, project_manager, developer_assigned,
      priority, progress_percentage, completion_percentage,
      update_note, project_update, notes,
    } = req.body;

    const resolvedProgress = progress_percentage !== undefined
      ? Number(progress_percentage)
      : completion_percentage !== undefined
      ? Number(completion_percentage)
      : null;

    const resolvedNote = update_note || project_update || null;

    const safeClientId = await safeFK("customers", client_id);
    const safeDealId   = await safeFK("deals",     deal_id);

    const cols     = await getProjectCols();
    const hasNotes = cols.has("notes");

    const sets = [
      "title                 = COALESCE(?, title)",
      "client_id             = ?",
      "deal_id               = ?",
      "service               = ?",
      "description           = ?",
      "status                = COALESCE(?, status)",
      "start_date            = ?",
      "delivery_date         = ?",
      "sales_owner           = ?",
      "project_manager       = ?",
      "developer_assigned    = ?",
      "priority              = COALESCE(?, priority)",
      "completion_percentage = COALESCE(?, completion_percentage)",
      "project_update        = ?",
      "updated_at            = CURRENT_TIMESTAMP",
    ];

    const vals = [
      title?.trim()      || null,
      safeClientId,
      safeDealId,
      service            || null,
      description        || null,
      status             || null,
      safeDate(start_date),
      safeDate(delivery_date),
      sales_owner        || null,
      project_manager    || null,
      developer_assigned || null,
      priority           || null,
      resolvedProgress,
      resolvedNote,
    ];

    if (hasNotes) {
      sets.splice(sets.indexOf("updated_at            = CURRENT_TIMESTAMP"), 0, "notes = ?");
      vals.push(notes || null);
    }

    vals.push(req.params.id);

    await pool.query(
      `UPDATE projects SET ${sets.join(", ")} WHERE id = ?`,
      vals
    );

    const [rows] = await pool.query(
      `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("updateProject:", err);
    res.status(500).json({ error: "Failed to update project", detail: err.message });
  }
});

// =============================================================================
// PATCH
// =============================================================================
router.patch("/:id", authenticateToken, async (req, res) => {
  try {
    const PATCHABLE = [
      "status", "priority", "project_update", "notes",
      "sales_owner", "project_manager", "developer_assigned",
    ];
    const sets = [], vals = [];

    const cols     = await getProjectCols();
    for (const key of PATCHABLE) {
      if (req.body[key] !== undefined && cols.has(key)) {
        sets.push(`${key} = ?`);
        vals.push(req.body[key] === "" ? null : req.body[key]);
      }
    }

    const rawPct = req.body.progress_percentage ?? req.body.completion_percentage;
    if (rawPct !== undefined) {
      sets.push("completion_percentage = ?");
      vals.push(Number(rawPct));
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    vals.push(req.params.id);
    await pool.query(
      `UPDATE projects SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      vals
    );

    const [rows] = await pool.query(
      `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("patchProject:", err);
    res.status(500).json({ error: "Failed to update project", detail: err.message });
  }
});

// =============================================================================
// DELETE
// =============================================================================
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const [check] = await pool.query("SELECT id FROM projects WHERE id = ?", [req.params.id]);
    if (ok404(res, check, "Project not found")) return;
    await pool.query("DELETE FROM projects WHERE id = ?", [req.params.id]);
    res.json({ message: "Project deleted successfully" });
  } catch (err) {
    console.error("deleteProject:", err);
    res.status(500).json({ error: "Failed to delete project", detail: err.message });
  }
});

// =============================================================================
// TASKS
// =============================================================================
router.get("/:id/tasks", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name, cb.name AS created_by_name
       FROM project_tasks t
       LEFT JOIN users u  ON u.id = t.assigned_to
       LEFT JOIN users cb ON cb.id = t.created_by
       WHERE t.project_id = ?
       ORDER BY FIELD(t.priority, 'Critical', 'High', 'Medium', 'Low'), t.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getTasks:", err);
    res.status(500).json({ error: "Failed to fetch tasks", detail: err.message });
  }
});

router.post("/:id/tasks", authenticateToken, async (req, res) => {
  try {
    const {
      title, description, assigned_to,
      status = "Pending", priority = "Medium",
      start_date, due_date,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: "Task title is required" });

    const taskId = uuidv4();
    await pool.query(
      `INSERT INTO project_tasks
         (id, project_id, title, description, assigned_to,
          status, priority, start_date, due_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId, req.params.id, title.trim(),
        description || null,
        assigned_to || null,
        status, priority,
        safeDate(start_date),
        safeDate(due_date),
        authId(req),
      ]
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [taskId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createTask:", err);
    res.status(500).json({ error: "Failed to create task", detail: err.message });
  }
});

router.put("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const { title, description, assigned_to, status, priority, start_date, due_date } = req.body;
    const [check] = await pool.query(
      "SELECT id FROM project_tasks WHERE id = ? AND project_id = ?",
      [req.params.taskId, req.params.id]
    );
    if (ok404(res, check, "Task not found")) return;

    await pool.query(
      `UPDATE project_tasks SET
         title = ?, description = ?, assigned_to = ?,
         status = ?, priority = ?, start_date = ?, due_date = ?
       WHERE id = ?`,
      [
        title, description || null, assigned_to || null,
        status || "Pending", priority || "Medium",
        safeDate(start_date), safeDate(due_date),
        req.params.taskId,
      ]
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [req.params.taskId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("updateTask:", err);
    res.status(500).json({ error: "Failed to update task", detail: err.message });
  }
});

router.patch("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const allowed = ["status", "priority", "assigned_to"];
    const sets = [], vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(req.body[key]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });

    vals.push(req.params.taskId, req.params.id);
    await pool.query(
      `UPDATE project_tasks SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`,
      vals
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [req.params.taskId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("patchTask:", err);
    res.status(500).json({ error: "Failed to update task", detail: err.message });
  }
});

router.delete("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const [check] = await pool.query(
      "SELECT id FROM project_tasks WHERE id = ? AND project_id = ?",
      [req.params.taskId, req.params.id]
    );
    if (ok404(res, check, "Task not found")) return;
    await pool.query("DELETE FROM project_tasks WHERE id = ?", [req.params.taskId]);
    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask:", err);
    res.status(500).json({ error: "Failed to delete task", detail: err.message });
  }
});

// =============================================================================
// NOTES
// =============================================================================
router.get("/:id/notes", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.*, u.name AS created_by_name
       FROM project_notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.project_id = ?
       ORDER BY n.pinned DESC, n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getNotes:", err);
    res.status(500).json({ error: "Failed to fetch notes", detail: err.message });
  }
});

router.post("/:id/notes", authenticateToken, async (req, res) => {
  try {
    const { note_type = "General", content, mentioned_users } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Note content is required" });

    const noteId = uuidv4();
    await pool.query(
      `INSERT INTO project_notes
         (id, project_id, note_type, content, mentioned_users, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        noteId, req.params.id, note_type, content.trim(),
        mentioned_users ? JSON.stringify(mentioned_users) : null,
        authId(req),
      ]
    );

    const [rows] = await pool.query(
      `SELECT n.*, u.name AS created_by_name
       FROM project_notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.id = ?`,
      [noteId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createNote:", err);
    res.status(500).json({ error: "Failed to create note", detail: err.message });
  }
});

router.patch("/:id/notes/:noteId", authenticateToken, async (req, res) => {
  try {
    const { pinned } = req.body;
    if (pinned === undefined) return res.status(400).json({ error: "No valid fields to update" });

    await pool.query(
      "UPDATE project_notes SET pinned = ? WHERE id = ? AND project_id = ?",
      [pinned ? 1 : 0, req.params.noteId, req.params.id]
    );

    const [rows] = await pool.query(
      `SELECT n.*, u.name AS created_by_name
       FROM project_notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.id = ?`,
      [req.params.noteId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("patchNote:", err);
    res.status(500).json({ error: "Failed to update note", detail: err.message });
  }
});

router.delete("/:id/notes/:noteId", authenticateToken, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM project_notes WHERE id = ? AND project_id = ?",
      [req.params.noteId, req.params.id]
    );
    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    console.error("deleteNote:", err);
    res.status(500).json({ error: "Failed to delete note", detail: err.message });
  }
});

// =============================================================================
// TIME LOGS
// =============================================================================
router.get("/:id/time-logs", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT tl.*, u.name AS user_name
       FROM project_time_logs tl
       LEFT JOIN users u ON u.id = tl.logged_by
       WHERE tl.project_id = ?
       ORDER BY tl.log_date DESC, tl.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getTimeLogs:", err);
    res.status(500).json({ error: "Failed to fetch time logs", detail: err.message });
  }
});

router.post("/:id/time-logs", authenticateToken, async (req, res) => {
  try {
    const { hours_logged, log_date, is_billable = true, description } = req.body;
    if (!hours_logged || isNaN(Number(hours_logged))) {
      return res.status(400).json({ error: "Valid hours_logged is required" });
    }

    const logId = uuidv4();
    await pool.query(
      `INSERT INTO project_time_logs
         (id, project_id, hours_logged, log_date, is_billable, description, logged_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        logId, req.params.id, Number(hours_logged),
        safeDate(log_date) || new Date().toISOString().slice(0, 10),
        is_billable ? 1 : 0,
        description || null,
        authId(req),
      ]
    );

    const [rows] = await pool.query(
      `SELECT tl.*, u.name AS user_name
       FROM project_time_logs tl LEFT JOIN users u ON u.id = tl.logged_by
       WHERE tl.id = ?`,
      [logId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createTimeLog:", err);
    res.status(500).json({ error: "Failed to create time log", detail: err.message });
  }
});

router.delete("/:id/time-logs/:logId", authenticateToken, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM project_time_logs WHERE id = ? AND project_id = ?",
      [req.params.logId, req.params.id]
    );
    res.json({ message: "Time log deleted successfully" });
  } catch (err) {
    console.error("deleteTimeLog:", err);
    res.status(500).json({ error: "Failed to delete time log", detail: err.message });
  }
});

// =============================================================================
// TEAM ALLOCATION
// =============================================================================
router.get("/:id/team", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pt.*, u.name, u.email, u.phone
       FROM project_team pt
       LEFT JOIN users u ON u.id = pt.user_id
       WHERE pt.project_id = ?
       ORDER BY pt.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getTeam:", err);
    res.status(500).json({ error: "Failed to fetch team", detail: err.message });
  }
});

router.post("/:id/team", authenticateToken, async (req, res) => {
  try {
    const { user_id, role, skills_assigned, workload_capacity = 100, hours_per_week = 40 } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id is required" });

    const [existing] = await pool.query(
      "SELECT id FROM project_team WHERE project_id = ? AND user_id = ?",
      [req.params.id, user_id]
    );
    if (existing.length) {
      return res.status(409).json({ error: "User is already assigned to this project" });
    }

    const entryId = uuidv4();
    await pool.query(
      `INSERT INTO project_team
         (id, project_id, user_id, role, skills_assigned,
          workload_capacity, hours_per_week, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        entryId, req.params.id, user_id,
        role || null, skills_assigned || null,
        Number(workload_capacity), Number(hours_per_week),
      ]
    );

    const [rows] = await pool.query(
      `SELECT pt.*, u.name, u.email, u.phone
       FROM project_team pt LEFT JOIN users u ON u.id = pt.user_id
       WHERE pt.id = ?`,
      [entryId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("addTeamMember:", err);
    res.status(500).json({ error: "Failed to add team member", detail: err.message });
  }
});

router.delete("/:id/team/:userId", authenticateToken, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM project_team WHERE project_id = ? AND user_id = ?",
      [req.params.id, req.params.userId]
    );
    res.json({ message: "Team member removed successfully" });
  } catch (err) {
    console.error("removeTeamMember:", err);
    res.status(500).json({ error: "Failed to remove team member", detail: err.message });
  }
});

module.exports = router;