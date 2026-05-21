// controllers/projectsController.js
const { pool } = require("../config/database");

// ── Helpers ───────────────────────────────────────────────────────────────────

const authId = (req) => req.user?.id || null;

const okOr404 = (res, rows, msg = "Not found") => {
  if (!rows.length) return res.status(404).json({ error: msg });
  return null; // signal "found"
};

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/projects
const getAllProjects = async (req, res) => {
  try {
    const { status, service, client_id } = req.query;

    let sql = `
      SELECT
        p.*,
        c.name            AS client_name,
        u.name            AS created_by_name,
        COUNT(t.id)       AS task_count,
        SUM(t.status = 'Complete') AS task_done_count
      FROM projects p
      LEFT JOIN customers    c ON c.id = p.client_id
      LEFT JOIN users        u ON u.id = p.created_by
      LEFT JOIN project_tasks t ON t.project_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (status)    { sql += " AND p.status = ?";    params.push(status); }
    if (service)   { sql += " AND p.service = ?";   params.push(service); }
    if (client_id) { sql += " AND p.client_id = ?"; params.push(client_id); }

    sql += " GROUP BY p.id ORDER BY p.created_at DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("getAllProjects:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
};

// GET /api/projects/:id
const getProjectById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         p.*,
         c.name  AS client_name,
         u.name  AS created_by_name,
         COUNT(t.id)                AS task_count,
         SUM(t.status = 'Complete') AS task_done_count
       FROM projects p
       LEFT JOIN customers     c ON c.id = p.client_id
       LEFT JOIN users         u ON u.id = p.created_by
       LEFT JOIN project_tasks t ON t.project_id = p.id
       WHERE p.id = ?
       GROUP BY p.id`,
      [req.params.id]
    );
    if (okOr404(res, rows, "Project not found")) return;
    res.json(rows[0]);
  } catch (err) {
    console.error("getProjectById:", err);
    res.status(500).json({ error: "Failed to fetch project" });
  }
};

// POST /api/projects
const createProject = async (req, res) => {
  try {
    const {
      title, client_id, deal_id, service,
      description, status, start_date, delivery_date,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Project title is required" });
    }

    const [result] = await pool.query(
      `INSERT INTO projects
         (title, client_id, deal_id, service, description,
          status, start_date, delivery_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        client_id   || null,
        deal_id     || null,
        service     || null,
        description || null,
        status      || "Requirement",
        start_date    || null,
        delivery_date || null,
        authId(req),
      ]
    );

    const [rows] = await pool.query(
      `SELECT p.*, c.name AS client_name
       FROM projects p
       LEFT JOIN customers c ON c.id = p.client_id
       WHERE p.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createProject:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
};

// PUT /api/projects/:id
const updateProject = async (req, res) => {
  try {
    const {
      title, client_id, deal_id, service,
      description, status, start_date, delivery_date,
    } = req.body;

    const [check] = await pool.query(
      "SELECT id FROM projects WHERE id = ?", [req.params.id]
    );
    if (okOr404(res, check, "Project not found")) return;

    await pool.query(
      `UPDATE projects SET
         title         = ?,
         client_id     = ?,
         deal_id       = ?,
         service       = ?,
         description   = ?,
         status        = ?,
         start_date    = ?,
         delivery_date = ?
       WHERE id = ?`,
      [
        title,
        client_id     || null,
        deal_id       || null,
        service       || null,
        description   || null,
        status        || "Requirement",
        start_date    || null,
        delivery_date || null,
        req.params.id,
      ]
    );

    const [rows] = await pool.query(
      `SELECT p.*, c.name AS client_name
       FROM projects p
       LEFT JOIN customers c ON c.id = p.client_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("updateProject:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
};

// DELETE /api/projects/:id
const deleteProject = async (req, res) => {
  try {
    const [check] = await pool.query(
      "SELECT id FROM projects WHERE id = ?", [req.params.id]
    );
    if (okOr404(res, check, "Project not found")) return;

    await pool.query("DELETE FROM projects WHERE id = ?", [req.params.id]);
    res.json({ message: "Project deleted successfully" });
  } catch (err) {
    console.error("deleteProject:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/projects/:id/tasks
const getTasks = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         t.*,
         u.name AS assigned_to_name,
         cb.name AS created_by_name
       FROM project_tasks t
       LEFT JOIN users u  ON u.id  = t.assigned_to
       LEFT JOIN users cb ON cb.id = t.created_by
       WHERE t.project_id = ?
       ORDER BY
         FIELD(t.priority, 'High', 'Medium', 'Low'),
         t.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getTasks:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};

// POST /api/projects/:id/tasks
const createTask = async (req, res) => {
  try {
    const {
      title, description, assigned_to,
      status, priority, start_date, due_date,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Task title is required" });
    }

    const [result] = await pool.query(
      `INSERT INTO project_tasks
         (project_id, title, description, assigned_to,
          status, priority, start_date, due_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        title,
        description  || null,
        assigned_to  || null,
        status       || "Pending",
        priority     || "Medium",
        start_date   || null,
        due_date     || null,
        authId(req),
      ]
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createTask:", err);
    res.status(500).json({ error: "Failed to create task" });
  }
};

// PUT /api/projects/:id/tasks/:taskId  (full update)
const updateTask = async (req, res) => {
  try {
    const {
      title, description, assigned_to,
      status, priority, start_date, due_date,
    } = req.body;

    const [check] = await pool.query(
      "SELECT id FROM project_tasks WHERE id = ? AND project_id = ?",
      [req.params.taskId, req.params.id]
    );
    if (okOr404(res, check, "Task not found")) return;

    await pool.query(
      `UPDATE project_tasks SET
         title       = ?,
         description = ?,
         assigned_to = ?,
         status      = ?,
         priority    = ?,
         start_date  = ?,
         due_date    = ?
       WHERE id = ?`,
      [
        title,
        description || null,
        assigned_to || null,
        status      || "Pending",
        priority    || "Medium",
        start_date  || null,
        due_date    || null,
        req.params.taskId,
      ]
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [req.params.taskId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("updateTask:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
};

// PATCH /api/projects/:id/tasks/:taskId  (status-only quick update)
const patchTask = async (req, res) => {
  try {
    const allowed = ["status", "priority", "assigned_to"];
    const updates = [];
    const params  = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    params.push(req.params.taskId, req.params.id);

    await pool.query(
      `UPDATE project_tasks SET ${updates.join(", ")}
       WHERE id = ? AND project_id = ?`,
      params
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [req.params.taskId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("patchTask:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
};

// DELETE /api/projects/:id/tasks/:taskId
const deleteTask = async (req, res) => {
  try {
    const [check] = await pool.query(
      "SELECT id FROM project_tasks WHERE id = ? AND project_id = ?",
      [req.params.taskId, req.params.id]
    );
    if (okOr404(res, check, "Task not found")) return;

    await pool.query("DELETE FROM project_tasks WHERE id = ?", [req.params.taskId]);
    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/projects/:id/notes
const getNotes = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         n.*,
         u.name AS created_by_name
       FROM project_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.project_id = ?
       ORDER BY n.pinned DESC, n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getNotes:", err);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
};

// POST /api/projects/:id/notes
const createNote = async (req, res) => {
  try {
    const { note_type, content, mentioned_users } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: "Note content is required" });
    }

    const [result] = await pool.query(
      `INSERT INTO project_notes
         (project_id, note_type, content, mentioned_users, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        req.params.id,
        note_type       || "General",
        content.trim(),
        mentioned_users ? JSON.stringify(mentioned_users) : null,
        authId(req),
      ]
    );

    const [rows] = await pool.query(
      `SELECT n.*, u.name AS created_by_name
       FROM project_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createNote:", err);
    res.status(500).json({ error: "Failed to create note" });
  }
};

// PATCH /api/projects/:id/notes/:noteId  (pin / unpin)
const patchNote = async (req, res) => {
  try {
    const { pinned } = req.body;

    if (pinned === undefined) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    await pool.query(
      "UPDATE project_notes SET pinned = ? WHERE id = ? AND project_id = ?",
      [pinned ? 1 : 0, req.params.noteId, req.params.id]
    );

    const [rows] = await pool.query(
      `SELECT n.*, u.name AS created_by_name
       FROM project_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.id = ?`,
      [req.params.noteId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("patchNote:", err);
    res.status(500).json({ error: "Failed to update note" });
  }
};

// DELETE /api/projects/:id/notes/:noteId
const deleteNote = async (req, res) => {
  try {
    const userId = authId(req);

    const [check] = await pool.query(
      "SELECT id, created_by FROM project_notes WHERE id = ? AND project_id = ?",
      [req.params.noteId, req.params.id]
    );
    if (okOr404(res, check, "Note not found")) return;

    // Only the author or admin can delete
    if (check[0].created_by !== userId && req.user?.role !== "admin") {
      return res.status(403).json({ error: "Not authorised to delete this note" });
    }

    await pool.query("DELETE FROM project_notes WHERE id = ?", [req.params.noteId]);
    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    console.error("deleteNote:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // projects
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  // tasks
  getTasks,
  createTask,
  updateTask,
  patchTask,
  deleteTask,
  // notes
  getNotes,
  createNote,
  patchNote,
  deleteNote,
};