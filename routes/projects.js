
// const express = require("express");
// const router  = express.Router();
// const { authenticateToken } = require("../middleware/auth");
// const { pool } = require("../config/database");
// const { v4: uuidv4 } = require("uuid");

// const authId   = (req) => req.user?.id || null;
// const safeDate = (v) => {
//   if (!v) return null;
//   const d = new Date(v);
//   return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
// };
// const ok404 = (res, rows, msg = "Not found") => {
//   if (!rows.length) { res.status(404).json({ error: msg }); return true; }
//   return false;
// };

// // ─── FK safety ────────────────────────────────────────────────────────────────
// async function safeFK(table, id) {
//   if (!id) return null;
//   try {
//     const [rows] = await pool.query(`SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
//     return rows.length ? id : null;
//   } catch { return null; }
// }

// // ─── Parse ENUM allowed values ────────────────────────────────────────────────
// function parseEnum(typeStr) {
//   if (!typeStr || !typeStr.toLowerCase().startsWith("enum")) return null;
//   const match = typeStr.match(/^enum\((.+)\)$/i);
//   if (!match) return null;
//   return match[1].split(",").map(v => v.trim().replace(/^'|'$/g, ""));
// }

// // ─── Schema cache — ALWAYS null on module load (fresh every restart) ──────────
// let _schema = null;

// async function getSchema() {
//   if (_schema) return _schema;

//   const [rows] = await pool.query("SHOW COLUMNS FROM projects");
//   const cols    = new Set(rows.map(r => r.Field));
//   const colMeta = {};
//   for (const r of rows) colMeta[r.Field] = r;

//   // id: UUID only if VARCHAR(36)
//   const idType   = (colMeta.id?.Type || "").toLowerCase();
//   const idIsUUID = idType.includes("varchar") && idType.includes("36");

//   // ENUM allowed-values map
//   const enumValues = {};
//   for (const r of rows) {
//     const allowed = parseEnum(r.Type);
//     if (allowed) enumValues[r.Field] = allowed;
//   }

//   // delivery date column name
//   const deliveryDateCol = cols.has("delivery_date") ? "delivery_date"
//                         : cols.has("end_date")       ? "end_date"
//                         : null;

//   // ── serviceCol: ONLY use a column explicitly named "service" or "project_type"
//   // ── NEVER use "category" — category is its own ENUM field with different values
//   const serviceCol = cols.has("service")      ? "service"
//                    : cols.has("project_type") ? "project_type"
//                    : null;   // <-- your DB has neither, so this will be null

//   _schema = { cols, colMeta, idIsUUID, enumValues, deliveryDateCol, serviceCol };

//   console.log("─── [projects] schema loaded ───────────────────────────");
//   console.log("  id col       :", colMeta.id?.Type, "| UUID insert:", idIsUUID);
//   console.log("  delivery col :", deliveryDateCol ?? "(none)");
//   console.log("  service col  :", serviceCol ?? "(none — 'service' field from frontend will be IGNORED)");
//   console.log("  ENUM cols    :", Object.keys(enumValues).join(", ") || "(none)");
//   if (enumValues.category) {
//     console.log("  category ENUM:", enumValues.category.join(", "));
//   }
//   console.log("  all columns  :", [...cols].join(", "));
//   console.log("────────────────────────────────────────────────────────");

//   return _schema;
// }

// // ─── ENUM guard ───────────────────────────────────────────────────────────────
// // Returns value if valid for that ENUM, otherwise null (never throws).
// function safeEnum(schema, col, val) {
//   if (val === null || val === undefined || val === "") return null;
//   const allowed = schema.enumValues[col];
//   if (!allowed) return val;                        // not an ENUM column
//   return allowed.includes(String(val)) ? val : null;
// }

// // ─── SELECT helper ────────────────────────────────────────────────────────────
// const PROJECT_SELECT = `
//   SELECT
//     p.*,
//     p.completion_percentage  AS progress_percentage,
//     c.name                   AS client_name,
//     cb.name                  AS created_by_name,
//     COUNT(t.id)              AS task_count,
//     SUM(t.status = 'Complete') AS task_done_count
//   FROM projects p
//   LEFT JOIN customers     c  ON c.id  = p.client_id
//   LEFT JOIN users         cb ON cb.id = p.created_by
//   LEFT JOIN project_tasks t  ON t.project_id = p.id
// `;

// // ─── Helper: build and execute a safe INSERT ──────────────────────────────────
// // Takes an ordered array of [colName, value] pairs.
// // Appends CURRENT_TIMESTAMP for created_at / updated_at automatically.
// async function safeInsert(table, pairs) {
//   const colNames     = [...pairs.map(p => p[0]), "created_at", "updated_at"];
//   const colValues    = pairs.map(p => p[1]);
//   const placeholders = [...pairs.map(() => "?"), "CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP"];
//   return pool.query(
//     `INSERT INTO \`${table}\` (${colNames.join(", ")}) VALUES (${placeholders.join(", ")})`,
//     colValues
//   );
// }

// // ─── Helper: add optional column only when it exists and value is defined ─────
// function addOptional(pairs, seen, schema, col, val) {
//   if (!col) return;                          // null col name
//   if (!schema.cols.has(col)) return;         // column doesn't exist in DB
//   if (seen.has(col)) return;                 // already added
//   if (val === undefined) return;             // explicitly excluded
//   seen.add(col);
//   pairs.push([col, val]);
// }

// // =============================================================================
// // GET ALL
// // =============================================================================
// router.get("/", authenticateToken, async (req, res) => {
//   try {
//     const { status, service, priority, search, client_id } = req.query;
//     const { cols, serviceCol } = await getSchema();
//     let where = "WHERE 1=1";
//     const params = [];

//     if (status)    { where += " AND p.status = ?";    params.push(status); }
//     if (priority)  { where += " AND p.priority = ?";  params.push(priority); }
//     if (client_id) { where += " AND p.client_id = ?"; params.push(client_id); }
//     if (service && serviceCol) {
//       where += ` AND p.${serviceCol} = ?`; params.push(service);
//     }
//     if (search) {
//       const sc = ["p.title", "c.name"];
//       if (cols.has("sales_owner"))     sc.push("p.sales_owner");
//       if (cols.has("project_manager")) sc.push("p.project_manager");
//       where += ` AND (${sc.map(c => `${c} LIKE ?`).join(" OR ")})`;
//       sc.forEach(() => params.push(`%${search}%`));
//     }

//     const [rows] = await pool.query(
//       `${PROJECT_SELECT} ${where} GROUP BY p.id ORDER BY p.created_at DESC`, params
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error("getAllProjects:", err);
//     res.status(500).json({ error: "Failed to fetch projects", detail: err.message });
//   }
// });

// // =============================================================================
// // GET BY ID
// // =============================================================================
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`, [req.params.id]
//     );
//     if (ok404(res, rows, "Project not found")) return;
//     res.json(rows[0]);
//   } catch (err) {
//     console.error("getProjectById:", err);
//     res.status(500).json({ error: "Failed to fetch project", detail: err.message });
//   }
// });

// // =============================================================================
// // CREATE
// // =============================================================================
// router.post("/", authenticateToken, async (req, res) => {
//   try {
//     const {
//       title, client_id, deal_id,
//       service,            // frontend "Project Type" field — stored in serviceCol if available
//       description, status = "Requirement", start_date, delivery_date,
//       sales_owner, project_manager, developer_assigned,
//       priority = "Medium", progress_percentage, completion_percentage,
//       update_note, project_update, notes,
//       department, scope_of_work,
//       category,           // separate ENUM field — only stored if value is valid for that ENUM
//       estimated_budget, actual_cost, health_rating,
//     } = req.body;

//     if (!title?.trim()) return res.status(400).json({ error: "Project title is required" });

//     const resolvedPct  = Number(progress_percentage ?? completion_percentage ?? 0);
//     const resolvedNote = update_note || project_update || null;

//     const schema = await getSchema();
//     const { cols, idIsUUID, serviceCol, deliveryDateCol } = schema;

//     const safeClientId = await safeFK("customers", client_id);
//     const safeDealId   = cols.has("deal_id") ? await safeFK("deals", deal_id) : undefined;

//     // // ── Required columns ──────────────────────────────────────────────────────
//     // const pairs = [];
//     // if (idIsUUID) pairs.push(["id", uuidv4()]);
//     // pairs.push(["title",     title.trim()]);
//     // pairs.push(["client_id", safeClientId]);

//     // const seen = new Set(pairs.map(p => p[0]));

//     // ── Required columns ──────────────────────────────────────────────────────
// const pairs = [];
// if (idIsUUID) pairs.push(["id", uuidv4()]);
// pairs.push(["title",     title.trim()]);
// pairs.push(["client_id", safeClientId]);

// const seen = new Set(pairs.map(p => p[0]));

// // ── project_id: auto-generate if column exists and no value provided ──────
// addOptional(pairs, seen, schema, "project_id",
//   `PROJ-${Date.now()}`
// );

//     // ── Optional columns ──────────────────────────────────────────────────────
//     // service → only goes into a dedicated "service" or "project_type" column.
//     // It NEVER goes into "category" — category is a separate ENUM.
//     addOptional(pairs, seen, schema, "deal_id",               safeDealId);
//     addOptional(pairs, seen, schema, serviceCol,              service || null);   // null if serviceCol===null
//     addOptional(pairs, seen, schema, "description",           description || null);
//     addOptional(pairs, seen, schema, "scope_of_work",         scope_of_work || null);
//     addOptional(pairs, seen, schema, "department",            department || null);
//     addOptional(pairs, seen, schema, "status",                safeEnum(schema, "status",   status));
//     addOptional(pairs, seen, schema, "priority",              safeEnum(schema, "priority", priority));
//     // category: only insert if frontend explicitly sent a valid ENUM value
//     addOptional(pairs, seen, schema, "category",              safeEnum(schema, "category", category ?? null));
//     addOptional(pairs, seen, schema, "health_rating",         safeEnum(schema, "health_rating", health_rating ?? null));
//     addOptional(pairs, seen, schema, "start_date",            safeDate(start_date));
//     addOptional(pairs, seen, schema, deliveryDateCol,         safeDate(delivery_date));
//     addOptional(pairs, seen, schema, "sales_owner",           sales_owner || null);
//     addOptional(pairs, seen, schema, "project_manager",       project_manager || null);
//     addOptional(pairs, seen, schema, "developer_assigned",    developer_assigned || null);
//     addOptional(pairs, seen, schema, "completion_percentage", resolvedPct);
//     addOptional(pairs, seen, schema, "progress_percentage",   resolvedPct);
//     addOptional(pairs, seen, schema, "project_update",        resolvedNote);
//     addOptional(pairs, seen, schema, "notes",                 notes || null);
//     addOptional(pairs, seen, schema, "estimated_budget",      estimated_budget || null);
//     addOptional(pairs, seen, schema, "actual_cost",           actual_cost || null);
//     addOptional(pairs, seen, schema, "created_by",            authId(req));

//     const [result] = await safeInsert("projects", pairs);

//     const newId = idIsUUID ? pairs.find(p => p[0] === "id")[1] : result.insertId;
//     const [rows] = await pool.query(
//       `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`, [newId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     console.error("createProject:", err);
//     res.status(500).json({ error: "Failed to create project", detail: err.message });
//   }
// });

// // =============================================================================
// // UPDATE (PUT)
// // =============================================================================
// router.put("/:id", authenticateToken, async (req, res) => {
//   try {
//     const [check] = await pool.query("SELECT id FROM projects WHERE id = ?", [req.params.id]);
//     if (ok404(res, check, "Project not found")) return;

//     const {
//       title, client_id, deal_id, service, description,
//       status, start_date, delivery_date,
//       sales_owner, project_manager, developer_assigned,
//       priority, progress_percentage, completion_percentage,
//       update_note, project_update, notes,
//       department, scope_of_work, category,
//       estimated_budget, actual_cost, health_rating,
//     } = req.body;

//     const resolvedPct  = progress_percentage  !== undefined ? Number(progress_percentage)
//                        : completion_percentage !== undefined ? Number(completion_percentage)
//                        : null;
//     const resolvedNote = update_note || project_update || null;

//     const schema = await getSchema();
//     const { cols, serviceCol, deliveryDateCol } = schema;

//     const safeClientId = await safeFK("customers", client_id);
//     const safeDealId   = cols.has("deal_id") ? await safeFK("deals", deal_id) : undefined;

//     const pairs = [
//       ["title",     title?.trim() || null],
//       ["client_id", safeClientId],
//     ];
//     const seen = new Set(pairs.map(p => p[0]));

//     addOptional(pairs, seen, schema, "deal_id",               safeDealId);
//     addOptional(pairs, seen, schema, serviceCol,              service || null);
//     addOptional(pairs, seen, schema, "description",           description || null);
//     addOptional(pairs, seen, schema, "scope_of_work",         scope_of_work || null);
//     addOptional(pairs, seen, schema, "department",            department || null);
//     addOptional(pairs, seen, schema, "status",                safeEnum(schema, "status",   status ?? null));
//     addOptional(pairs, seen, schema, "priority",              safeEnum(schema, "priority", priority ?? null));
//     addOptional(pairs, seen, schema, "category",              safeEnum(schema, "category", category ?? null));
//     addOptional(pairs, seen, schema, "health_rating",         safeEnum(schema, "health_rating", health_rating ?? null));
//     addOptional(pairs, seen, schema, "start_date",            safeDate(start_date));
//     addOptional(pairs, seen, schema, deliveryDateCol,         safeDate(delivery_date));
//     addOptional(pairs, seen, schema, "sales_owner",           sales_owner || null);
//     addOptional(pairs, seen, schema, "project_manager",       project_manager || null);
//     addOptional(pairs, seen, schema, "developer_assigned",    developer_assigned || null);
//     addOptional(pairs, seen, schema, "completion_percentage", resolvedPct);
//     addOptional(pairs, seen, schema, "progress_percentage",   resolvedPct);
//     addOptional(pairs, seen, schema, "project_update",        resolvedNote);
//     addOptional(pairs, seen, schema, "notes",                 notes || null);
//     addOptional(pairs, seen, schema, "estimated_budget",      estimated_budget || null);
//     addOptional(pairs, seen, schema, "actual_cost",           actual_cost || null);

//     const setClause = pairs.map(([col]) => `${col} = ?`).join(", ");
//     const setValues = [...pairs.map(([, v]) => v), req.params.id];

//     await pool.query(
//       `UPDATE projects SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//       setValues
//     );

//     const [rows] = await pool.query(
//       `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`, [req.params.id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     console.error("updateProject:", err);
//     res.status(500).json({ error: "Failed to update project", detail: err.message });
//   }
// });

// // =============================================================================
// // PATCH
// // =============================================================================
// router.patch("/:id", authenticateToken, async (req, res) => {
//   try {
//     const schema = await getSchema();
//     const { cols, serviceCol } = schema;

//     const PATCHABLE = ["status", "priority", "project_update", "notes",
//                        "sales_owner", "project_manager", "developer_assigned"];
//     const sets = [], vals = [];

//     for (const key of PATCHABLE) {
//       if (req.body[key] !== undefined && cols.has(key)) {
//         sets.push(`${key} = ?`);
//         vals.push(safeEnum(schema, key, req.body[key] === "" ? null : req.body[key]));
//       }
//     }
//     const rawPct = req.body.progress_percentage ?? req.body.completion_percentage;
//     if (rawPct !== undefined) {
//       if (cols.has("completion_percentage")) { sets.push("completion_percentage = ?"); vals.push(Number(rawPct)); }
//       if (cols.has("progress_percentage"))   { sets.push("progress_percentage = ?");   vals.push(Number(rawPct)); }
//     }
//     if (req.body.service !== undefined && serviceCol) {
//       sets.push(`${serviceCol} = ?`); vals.push(req.body.service || null);
//     }
//     if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });

//     vals.push(req.params.id);
//     await pool.query(
//       `UPDATE projects SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, vals
//     );
//     const [rows] = await pool.query(
//       `${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`, [req.params.id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     console.error("patchProject:", err);
//     res.status(500).json({ error: "Failed to update project", detail: err.message });
//   }
// });

// // =============================================================================
// // DELETE
// // =============================================================================
// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const [check] = await pool.query("SELECT id FROM projects WHERE id = ?", [req.params.id]);
//     if (ok404(res, check, "Project not found")) return;
//     await pool.query("DELETE FROM projects WHERE id = ?", [req.params.id]);
//     res.json({ message: "Project deleted successfully" });
//   } catch (err) {
//     console.error("deleteProject:", err);
//     res.status(500).json({ error: "Failed to delete project", detail: err.message });
//   }
// });

// // =============================================================================
// // TASKS
// // =============================================================================
// router.get("/:id/tasks", authenticateToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `SELECT t.*, u.name AS assigned_to_name, cb.name AS created_by_name
//        FROM project_tasks t
//        LEFT JOIN users u  ON u.id = t.assigned_to
//        LEFT JOIN users cb ON cb.id = t.created_by
//        WHERE t.project_id = ?
//        ORDER BY FIELD(t.priority,'Critical','High','Medium','Low'), t.created_at ASC`,
//       [req.params.id]
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error("getTasks:", err);
//     res.status(500).json({ error: "Failed to fetch tasks", detail: err.message });
//   }
// });

// router.post("/:id/tasks", authenticateToken, async (req, res) => {
//   try {
//     const { title, description, assigned_to, status="Pending", priority="Medium", start_date, due_date } = req.body;
//     if (!title?.trim()) return res.status(400).json({ error: "Task title is required" });
//     const taskId = uuidv4();
//     await pool.query(
//       `INSERT INTO project_tasks (id,project_id,title,description,assigned_to,status,priority,start_date,due_date,created_by)
//        VALUES (?,?,?,?,?,?,?,?,?,?)`,
//       [taskId,req.params.id,title.trim(),description||null,assigned_to||null,
//        status,priority,safeDate(start_date),safeDate(due_date),authId(req)]
//     );
//     const [rows] = await pool.query(
//       `SELECT t.*, u.name AS assigned_to_name FROM project_tasks t
//        LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?`, [taskId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     console.error("createTask:", err);
//     res.status(500).json({ error: "Failed to create task", detail: err.message });
//   }
// });

// router.put("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
//   try {
//     const { title, description, assigned_to, status, priority, start_date, due_date } = req.body;
//     const [check] = await pool.query(
//       "SELECT id FROM project_tasks WHERE id=? AND project_id=?", [req.params.taskId,req.params.id]
//     );
//     if (ok404(res, check, "Task not found")) return;
//     await pool.query(
//       `UPDATE project_tasks SET title=?,description=?,assigned_to=?,status=?,priority=?,start_date=?,due_date=? WHERE id=?`,
//       [title,description||null,assigned_to||null,status||"Pending",priority||"Medium",
//        safeDate(start_date),safeDate(due_date),req.params.taskId]
//     );
//     const [rows] = await pool.query(
//       `SELECT t.*, u.name AS assigned_to_name FROM project_tasks t
//        LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?`, [req.params.taskId]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     console.error("updateTask:", err);
//     res.status(500).json({ error: "Failed to update task", detail: err.message });
//   }
// });

// router.patch("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
//   try {
//     const allowed = ["status","priority","assigned_to"];
//     const sets = [], vals = [];
//     for (const key of allowed) {
//       if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
//     }
//     if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });
//     vals.push(req.params.taskId, req.params.id);
//     await pool.query(`UPDATE project_tasks SET ${sets.join(", ")} WHERE id=? AND project_id=?`, vals);
//     const [rows] = await pool.query(
//       `SELECT t.*, u.name AS assigned_to_name FROM project_tasks t
//        LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?`, [req.params.taskId]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     console.error("patchTask:", err);
//     res.status(500).json({ error: "Failed to update task", detail: err.message });
//   }
// });

// router.delete("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
//   try {
//     const [check] = await pool.query(
//       "SELECT id FROM project_tasks WHERE id=? AND project_id=?", [req.params.taskId,req.params.id]
//     );
//     if (ok404(res, check, "Task not found")) return;
//     await pool.query("DELETE FROM project_tasks WHERE id=?", [req.params.taskId]);
//     res.json({ message: "Task deleted successfully" });
//   } catch (err) {
//     console.error("deleteTask:", err);
//     res.status(500).json({ error: "Failed to delete task", detail: err.message });
//   }
// });

// // =============================================================================
// // NOTES
// // =============================================================================
// router.get("/:id/notes", authenticateToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `SELECT n.*, u.name AS created_by_name FROM project_notes n
//        LEFT JOIN users u ON u.id = n.created_by
//        WHERE n.project_id = ? ORDER BY n.pinned DESC, n.created_at DESC`, [req.params.id]
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error("getNotes:", err);
//     res.status(500).json({ error: "Failed to fetch notes", detail: err.message });
//   }
// });

// router.post("/:id/notes", authenticateToken, async (req, res) => {
//   try {
//     const { note_type="General", content, mentioned_users } = req.body;
//     if (!content?.trim()) return res.status(400).json({ error: "Note content is required" });
//     const noteId = uuidv4();
//     await pool.query(
//       `INSERT INTO project_notes (id,project_id,note_type,content,mentioned_users,created_by) VALUES (?,?,?,?,?,?)`,
//       [noteId,req.params.id,note_type,content.trim(),
//        mentioned_users?JSON.stringify(mentioned_users):null,authId(req)]
//     );
//     const [rows] = await pool.query(
//       `SELECT n.*, u.name AS created_by_name FROM project_notes n
//        LEFT JOIN users u ON u.id = n.created_by WHERE n.id = ?`, [noteId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     console.error("createNote:", err);
//     res.status(500).json({ error: "Failed to create note", detail: err.message });
//   }
// });

// router.patch("/:id/notes/:noteId", authenticateToken, async (req, res) => {
//   try {
//     const { pinned } = req.body;
//     if (pinned === undefined) return res.status(400).json({ error: "No valid fields to update" });
//     await pool.query("UPDATE project_notes SET pinned=? WHERE id=? AND project_id=?",
//       [pinned?1:0, req.params.noteId, req.params.id]);
//     const [rows] = await pool.query(
//       `SELECT n.*, u.name AS created_by_name FROM project_notes n
//        LEFT JOIN users u ON u.id = n.created_by WHERE n.id = ?`, [req.params.noteId]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     console.error("patchNote:", err);
//     res.status(500).json({ error: "Failed to update note", detail: err.message });
//   }
// });

// router.delete("/:id/notes/:noteId", authenticateToken, async (req, res) => {
//   try {
//     await pool.query("DELETE FROM project_notes WHERE id=? AND project_id=?",
//       [req.params.noteId, req.params.id]);
//     res.json({ message: "Note deleted successfully" });
//   } catch (err) {
//     console.error("deleteNote:", err);
//     res.status(500).json({ error: "Failed to delete note", detail: err.message });
//   }
// });

// // =============================================================================
// // TIME LOGS
// // =============================================================================
// router.get("/:id/time-logs", authenticateToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `SELECT tl.*, u.name AS user_name FROM project_time_logs tl
//        LEFT JOIN users u ON u.id = tl.logged_by
//        WHERE tl.project_id = ? ORDER BY tl.log_date DESC, tl.created_at DESC`, [req.params.id]
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error("getTimeLogs:", err);
//     res.status(500).json({ error: "Failed to fetch time logs", detail: err.message });
//   }
// });

// router.post("/:id/time-logs", authenticateToken, async (req, res) => {
//   try {
//     const { hours_logged, log_date, is_billable=true, description } = req.body;
//     if (!hours_logged || isNaN(Number(hours_logged)))
//       return res.status(400).json({ error: "Valid hours_logged is required" });
//     const logId = uuidv4();
//     await pool.query(
//       `INSERT INTO project_time_logs (id,project_id,hours_logged,log_date,is_billable,description,logged_by,created_at)
//        VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
//       [logId,req.params.id,Number(hours_logged),
//        safeDate(log_date)||new Date().toISOString().slice(0,10),
//        is_billable?1:0, description||null, authId(req)]
//     );
//     const [rows] = await pool.query(
//       `SELECT tl.*, u.name AS user_name FROM project_time_logs tl
//        LEFT JOIN users u ON u.id = tl.logged_by WHERE tl.id = ?`, [logId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     console.error("createTimeLog:", err);
//     res.status(500).json({ error: "Failed to create time log", detail: err.message });
//   }
// });

// router.delete("/:id/time-logs/:logId", authenticateToken, async (req, res) => {
//   try {
//     await pool.query("DELETE FROM project_time_logs WHERE id=? AND project_id=?",
//       [req.params.logId, req.params.id]);
//     res.json({ message: "Time log deleted successfully" });
//   } catch (err) {
//     console.error("deleteTimeLog:", err);
//     res.status(500).json({ error: "Failed to delete time log", detail: err.message });
//   }
// });

// // =============================================================================
// // TEAM ALLOCATION
// // =============================================================================
// router.get("/:id/team", authenticateToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `SELECT pt.*, u.name, u.email, u.phone FROM project_team pt
//        LEFT JOIN users u ON u.id = pt.user_id
//        WHERE pt.project_id = ? ORDER BY pt.created_at ASC`, [req.params.id]
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error("getTeam:", err);
//     res.status(500).json({ error: "Failed to fetch team", detail: err.message });
//   }
// });

// router.post("/:id/team", authenticateToken, async (req, res) => {
//   try {
//     const { user_id, role, skills_assigned, workload_capacity=100, hours_per_week=40 } = req.body;
//     if (!user_id) return res.status(400).json({ error: "user_id is required" });
//     const [existing] = await pool.query(
//       "SELECT id FROM project_team WHERE project_id=? AND user_id=?", [req.params.id, user_id]
//     );
//     if (existing.length) return res.status(409).json({ error: "User already assigned to this project" });
//     const entryId = uuidv4();
//     await pool.query(
//       `INSERT INTO project_team (id,project_id,user_id,role,skills_assigned,workload_capacity,hours_per_week,created_at)
//        VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
//       [entryId,req.params.id,user_id,role||null,skills_assigned||null,
//        Number(workload_capacity),Number(hours_per_week)]
//     );
//     const [rows] = await pool.query(
//       `SELECT pt.*, u.name, u.email, u.phone FROM project_team pt
//        LEFT JOIN users u ON u.id = pt.user_id WHERE pt.id = ?`, [entryId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     console.error("addTeamMember:", err);
//     res.status(500).json({ error: "Failed to add team member", detail: err.message });
//   }
// });

// router.delete("/:id/team/:userId", authenticateToken, async (req, res) => {
//   try {
//     await pool.query("DELETE FROM project_team WHERE project_id=? AND user_id=?",
//       [req.params.id, req.params.userId]);
//     res.json({ message: "Team member removed successfully" });
//   } catch (err) {
//     console.error("removeTeamMember:", err);
//     res.status(500).json({ error: "Failed to remove team member", detail: err.message });
//   }
// });

// module.exports = router;



//testing(28-05-2026)

const express = require("express");
const router  = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

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

// ─── FK safety ────────────────────────────────────────────────────────────────
async function safeFK(table, id) {
  if (!id) return null;
  try {
    const [rows] = await pool.query(`SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
    return rows.length ? id : null;
  } catch { return null; }
}

// ─── Parse ENUM allowed values ────────────────────────────────────────────────
function parseEnum(typeStr) {
  if (!typeStr || !typeStr.toLowerCase().startsWith("enum")) return null;
  const match = typeStr.match(/^enum\((.+)\)$/i);
  if (!match) return null;
  return match[1].split(",").map(v => v.trim().replace(/^'|'$/g, ""));
}

// ─── Schema TTL ───────────────────────────────────────────────────────────────
// Caches refresh every 60 s so ALTER TABLE changes are picked up automatically
// without needing a server restart.
const SCHEMA_TTL_MS = 60_000;

// ─── Projects schema cache ────────────────────────────────────────────────────
let _schema     = null;
let _schemaTime = 0;

async function getSchema() {
  if (_schema && (Date.now() - _schemaTime) < SCHEMA_TTL_MS) return _schema;

  const [rows] = await pool.query("SHOW COLUMNS FROM projects");
  const cols    = new Set(rows.map(r => r.Field));
  const colMeta = {};
  for (const r of rows) colMeta[r.Field] = r;

  const idType   = (colMeta.id?.Type || "").toLowerCase();
  const idIsUUID = idType.includes("varchar") && idType.includes("36");

  const enumValues = {};
  for (const r of rows) {
    const allowed = parseEnum(r.Type);
    if (allowed) enumValues[r.Field] = allowed;
  }

  const deliveryDateCol = cols.has("delivery_date") ? "delivery_date"
                        : cols.has("end_date")       ? "end_date"
                        : null;

  const serviceCol = cols.has("service")      ? "service"
                   : cols.has("project_type") ? "project_type"
                   : null;

  _schema     = { cols, colMeta, idIsUUID, enumValues, deliveryDateCol, serviceCol };
  _schemaTime = Date.now();

  console.log("─── [projects] schema loaded ───────────────────────────");
  console.log("  id col       :", colMeta.id?.Type, "| UUID insert:", idIsUUID);
  console.log("  delivery col :", deliveryDateCol ?? "(none)");
  console.log("  service col  :", serviceCol ?? "(none)");
  console.log("  ENUM cols    :", Object.keys(enumValues).join(", ") || "(none)");
  if (enumValues.category) console.log("  category ENUM:", enumValues.category.join(", "));
  console.log("  all columns  :", [...cols].join(", "));
  console.log("────────────────────────────────────────────────────────");

  return _schema;
}

// ─── Tasks schema cache ───────────────────────────────────────────────────────
let _taskSchema     = null;
let _taskSchemaTime = 0;

async function getTaskSchema() {
  if (_taskSchema && (Date.now() - _taskSchemaTime) < SCHEMA_TTL_MS) return _taskSchema;

  const [rows] = await pool.query("SHOW COLUMNS FROM project_tasks");
  const cols   = new Set(rows.map(r => r.Field));

  _taskSchema     = { cols };
  _taskSchemaTime = Date.now();

  console.log("─── [project_tasks] schema loaded ──────────────────────");
  console.log("  all columns  :", [...cols].join(", "));
  console.log("────────────────────────────────────────────────────────");

  return _taskSchema;
}

// ─── ENUM guard ───────────────────────────────────────────────────────────────
function safeEnum(schema, col, val) {
  if (val === null || val === undefined || val === "") return null;
  const allowed = schema.enumValues[col];
  if (!allowed) return val;
  return allowed.includes(String(val)) ? val : null;
}

// ─── Dynamic PROJECT_SELECT (no hardcoded column names, no GROUP BY) ──────────
async function buildProjectSelect() {
  const { cols } = await getSchema();
  const progressAlias = cols.has("completion_percentage")
    ? "p.completion_percentage AS progress_percentage,"
    : "p.progress_percentage   AS progress_percentage,";

  return `
    SELECT
      p.*,
      ${progressAlias}
      c.name  AS client_name,
      cb.name AS created_by_name,
      COALESCE(tc.task_count,      0) AS task_count,
      COALESCE(tc.task_done_count, 0) AS task_done_count
    FROM projects p
    LEFT JOIN customers c  ON c.id  = p.client_id
    LEFT JOIN users     cb ON cb.id = p.created_by
    LEFT JOIN (
      SELECT
        project_id,
        COUNT(id)                AS task_count,
        SUM(status = 'Complete') AS task_done_count
      FROM project_tasks
      GROUP BY project_id
    ) tc ON tc.project_id = p.id
  `;
}

// ─── Safe INSERT helper ───────────────────────────────────────────────────────
async function safeInsert(table, pairs) {
  const colNames     = [...pairs.map(p => p[0]), "created_at", "updated_at"];
  const colValues    = pairs.map(p => p[1]);
  const placeholders = [...pairs.map(() => "?"), "CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP"];
  return pool.query(
    `INSERT INTO \`${table}\` (${colNames.join(", ")}) VALUES (${placeholders.join(", ")})`,
    colValues
  );
}

// ─── addOptional: only inserts column when it exists in the DB schema ─────────
function addOptional(pairs, seen, schema, col, val) {
  if (!col) return;
  if (!schema.cols.has(col)) return;
  if (seen.has(col)) return;
  if (val === undefined) return;
  seen.add(col);
  pairs.push([col, val]);
}

// =============================================================================
// GET ALL
// =============================================================================
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { status, service, priority, search, client_id } = req.query;
    const { cols, serviceCol } = await getSchema();
    const PROJECT_SELECT = await buildProjectSelect();

    let where = "WHERE 1=1";
    const params = [];

    if (status)    { where += " AND p.status = ?";    params.push(status); }
    if (priority)  { where += " AND p.priority = ?";  params.push(priority); }
    if (client_id) { where += " AND p.client_id = ?"; params.push(client_id); }
    if (service && serviceCol) {
      where += ` AND p.${serviceCol} = ?`; params.push(service);
    }
    if (search) {
      const sc = ["p.title", "c.name"];
      if (cols.has("sales_owner"))     sc.push("p.sales_owner");
      if (cols.has("project_manager")) sc.push("p.project_manager");
      where += ` AND (${sc.map(c => `${c} LIKE ?`).join(" OR ")})`;
      sc.forEach(() => params.push(`%${search}%`));
    }

    const [rows] = await pool.query(
      `${PROJECT_SELECT} ${where} ORDER BY p.created_at DESC`, params
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
    const PROJECT_SELECT = await buildProjectSelect();
    const [rows] = await pool.query(`${PROJECT_SELECT} WHERE p.id = ?`, [req.params.id]);
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
      title, client_id, deal_id,
      service, description, status = "Not Started", start_date, delivery_date,
      sales_owner, project_manager, developer_assigned,
      priority = "Medium", progress_percentage, completion_percentage,
      update_note, project_update, notes,
      department, scope_of_work, category,
      estimated_budget, actual_cost, health_rating,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: "Project title is required" });

    const resolvedPct  = Number(progress_percentage ?? completion_percentage ?? 0);
    const resolvedNote = update_note || project_update || null;

    const schema = await getSchema();
    const { cols, idIsUUID, serviceCol, deliveryDateCol } = schema;

    const safeClientId = await safeFK("customers", client_id);
    const safeDealId   = cols.has("deal_id") ? await safeFK("deals", deal_id) : undefined;

    const pairs = [];
    if (idIsUUID) pairs.push(["id", uuidv4()]);
    pairs.push(["title",     title.trim()]);
    pairs.push(["client_id", safeClientId]);

    const seen = new Set(pairs.map(p => p[0]));

    addOptional(pairs, seen, schema, "project_id",            `PROJ-${Date.now()}`);
    addOptional(pairs, seen, schema, "deal_id",               safeDealId);
    addOptional(pairs, seen, schema, serviceCol,              service || null);
    addOptional(pairs, seen, schema, "description",           description || null);
    addOptional(pairs, seen, schema, "scope_of_work",         scope_of_work || null);
    addOptional(pairs, seen, schema, "department",            department || null);
    addOptional(pairs, seen, schema, "status",                safeEnum(schema, "status",        status));
    addOptional(pairs, seen, schema, "priority",              safeEnum(schema, "priority",      priority));
    addOptional(pairs, seen, schema, "category",              safeEnum(schema, "category",      category ?? null));
    addOptional(pairs, seen, schema, "health_rating",         safeEnum(schema, "health_rating", health_rating ?? null));
    addOptional(pairs, seen, schema, "start_date",            safeDate(start_date));
    addOptional(pairs, seen, schema, deliveryDateCol,         safeDate(delivery_date));
    addOptional(pairs, seen, schema, "sales_owner",           sales_owner || null);
    addOptional(pairs, seen, schema, "project_manager",       project_manager || null);
    addOptional(pairs, seen, schema, "developer_assigned",    developer_assigned || null);
    addOptional(pairs, seen, schema, "completion_percentage", resolvedPct);
    addOptional(pairs, seen, schema, "progress_percentage",   resolvedPct);
    addOptional(pairs, seen, schema, "project_update",        resolvedNote);
    addOptional(pairs, seen, schema, "notes",                 notes || null);
    addOptional(pairs, seen, schema, "estimated_budget",      estimated_budget || null);
    addOptional(pairs, seen, schema, "actual_cost",           actual_cost || null);
    addOptional(pairs, seen, schema, "created_by",            authId(req));

    const [result] = await safeInsert("projects", pairs);

    const newId = idIsUUID ? pairs.find(p => p[0] === "id")[1] : result.insertId;
    const PROJECT_SELECT = await buildProjectSelect();
    const [rows] = await pool.query(`${PROJECT_SELECT} WHERE p.id = ?`, [newId]);
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
      department, scope_of_work, category,
      estimated_budget, actual_cost, health_rating,
    } = req.body;

    const resolvedPct  = progress_percentage  !== undefined ? Number(progress_percentage)
                       : completion_percentage !== undefined ? Number(completion_percentage)
                       : null;
    const resolvedNote = update_note || project_update || null;

    const schema = await getSchema();
    const { cols, serviceCol, deliveryDateCol } = schema;

    const safeClientId = await safeFK("customers", client_id);
    const safeDealId   = cols.has("deal_id") ? await safeFK("deals", deal_id) : undefined;

    const pairs = [
      ["title",     title?.trim() || null],
      ["client_id", safeClientId],
    ];
    const seen = new Set(pairs.map(p => p[0]));

    addOptional(pairs, seen, schema, "deal_id",               safeDealId);
    addOptional(pairs, seen, schema, serviceCol,              service || null);
    addOptional(pairs, seen, schema, "description",           description || null);
    addOptional(pairs, seen, schema, "scope_of_work",         scope_of_work || null);
    addOptional(pairs, seen, schema, "department",            department || null);
    addOptional(pairs, seen, schema, "status",                safeEnum(schema, "status",        status ?? null));
    addOptional(pairs, seen, schema, "priority",              safeEnum(schema, "priority",      priority ?? null));
    addOptional(pairs, seen, schema, "category",              safeEnum(schema, "category",      category ?? null));
    addOptional(pairs, seen, schema, "health_rating",         safeEnum(schema, "health_rating", health_rating ?? null));
    addOptional(pairs, seen, schema, "start_date",            safeDate(start_date));
    addOptional(pairs, seen, schema, deliveryDateCol,         safeDate(delivery_date));
    addOptional(pairs, seen, schema, "sales_owner",           sales_owner || null);
    addOptional(pairs, seen, schema, "project_manager",       project_manager || null);
    addOptional(pairs, seen, schema, "developer_assigned",    developer_assigned || null);
    addOptional(pairs, seen, schema, "completion_percentage", resolvedPct);
    addOptional(pairs, seen, schema, "progress_percentage",   resolvedPct);
    addOptional(pairs, seen, schema, "project_update",        resolvedNote);
    addOptional(pairs, seen, schema, "notes",                 notes || null);
    addOptional(pairs, seen, schema, "estimated_budget",      estimated_budget || null);
    addOptional(pairs, seen, schema, "actual_cost",           actual_cost || null);

    const setClause = pairs.map(([col]) => `${col} = ?`).join(", ");
    const setValues = [...pairs.map(([, v]) => v), req.params.id];

    await pool.query(
      `UPDATE projects SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      setValues
    );

    const PROJECT_SELECT = await buildProjectSelect();
    const [rows] = await pool.query(`${PROJECT_SELECT} WHERE p.id = ?`, [req.params.id]);
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
    const schema = await getSchema();
    const { cols, serviceCol } = schema;

    const PATCHABLE = ["status", "priority", "project_update", "notes",
                       "sales_owner", "project_manager", "developer_assigned"];
    const sets = [], vals = [];

    for (const key of PATCHABLE) {
      if (req.body[key] !== undefined && cols.has(key)) {
        sets.push(`${key} = ?`);
        vals.push(safeEnum(schema, key, req.body[key] === "" ? null : req.body[key]));
      }
    }
    const rawPct = req.body.progress_percentage ?? req.body.completion_percentage;
    if (rawPct !== undefined) {
      if (cols.has("completion_percentage")) { sets.push("completion_percentage = ?"); vals.push(Number(rawPct)); }
      if (cols.has("progress_percentage"))   { sets.push("progress_percentage = ?");   vals.push(Number(rawPct)); }
    }
    if (req.body.service !== undefined && serviceCol) {
      sets.push(`${serviceCol} = ?`); vals.push(req.body.service || null);
    }
    if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });

    vals.push(req.params.id);
    await pool.query(
      `UPDATE projects SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, vals
    );

    const PROJECT_SELECT = await buildProjectSelect();
    const [rows] = await pool.query(`${PROJECT_SELECT} WHERE p.id = ?`, [req.params.id]);
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
       ORDER BY FIELD(t.priority,'Critical','High','Medium','Low'), t.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("getTasks:", err);
    res.status(500).json({ error: "Failed to fetch tasks", detail: err.message });
  }
});

// ─── CREATE TASK ──────────────────────────────────────────────────────────────
router.post("/:id/tasks", authenticateToken, async (req, res) => {
  try {
    const {
      title, description, assigned_to,
      status = "Pending", priority = "Medium",
      start_date, due_date,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: "Task title is required" });

    // Always fetch a fresh task schema (respects TTL cache)
    const { cols } = await getTaskSchema();
    const taskId = uuidv4();

    // Build pairs dynamically — only columns that exist in DB are included
    const pairs = [
      ["id",         taskId],
      ["project_id", req.params.id],
      ["title",      title.trim()],
    ];
    const seen = new Set(pairs.map(p => p[0]));

    const addTask = (col, val) => {
      if (!col || !cols.has(col) || seen.has(col) || val === undefined) return;
      seen.add(col);
      pairs.push([col, val]);
    };

    addTask("description", description || null);
    addTask("assigned_to", assigned_to || null);
    addTask("status",      status);
    addTask("priority",    priority);
    addTask("start_date",  safeDate(start_date));
    addTask("due_date",    safeDate(due_date));
    addTask("created_by",  authId(req));

    const colNames     = [...pairs.map(p => p[0]), "created_at"];
    const colValues    = pairs.map(p => p[1]);
    const placeholders = [...pairs.map(() => "?"), "CURRENT_TIMESTAMP"];

    await pool.query(
      `INSERT INTO project_tasks (${colNames.join(", ")}) VALUES (${placeholders.join(", ")})`,
      colValues
    );

    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM project_tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [taskId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createTask:", err);
    res.status(500).json({ error: "Failed to create task", detail: err.message });
  }
});

// ─── UPDATE TASK ──────────────────────────────────────────────────────────────
router.put("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const { title, description, assigned_to, status, priority, start_date, due_date } = req.body;

    const [check] = await pool.query(
      "SELECT id FROM project_tasks WHERE id = ? AND project_id = ?",
      [req.params.taskId, req.params.id]
    );
    if (ok404(res, check, "Task not found")) return;

    const { cols } = await getTaskSchema();

    const pairs = [
      ["title",       title || null],
      ["description", description || null],
      ["assigned_to", assigned_to || null],
      ["status",      status   || "Pending"],
      ["priority",    priority || "Medium"],
    ];
    const seen = new Set(pairs.map(p => p[0]));

    // Only include date cols if they exist in DB
    if (cols.has("start_date") && !seen.has("start_date")) {
      seen.add("start_date");
      pairs.push(["start_date", safeDate(start_date)]);
    }
    if (cols.has("due_date") && !seen.has("due_date")) {
      seen.add("due_date");
      pairs.push(["due_date", safeDate(due_date)]);
    }

    const setClause = pairs.map(([col]) => `${col} = ?`).join(", ");
    const setValues = [...pairs.map(([, v]) => v), req.params.taskId];

    await pool.query(
      `UPDATE project_tasks SET ${setClause} WHERE id = ?`,
      setValues
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
    res.status(500).json({ error: "Failed to update task", detail: err.message });
  }
});

router.patch("/:id/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const allowed = ["status", "priority", "assigned_to"];
    const sets = [], vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
    }
    if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });
    vals.push(req.params.taskId, req.params.id);
    await pool.query(
      `UPDATE project_tasks SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`, vals
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
      `SELECT n.*, u.name AS created_by_name FROM project_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.project_id = ? ORDER BY n.pinned DESC, n.created_at DESC`,
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
      `INSERT INTO project_notes (id, project_id, note_type, content, mentioned_users, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [noteId, req.params.id, note_type, content.trim(),
       mentioned_users ? JSON.stringify(mentioned_users) : null, authId(req)]
    );
    const [rows] = await pool.query(
      `SELECT n.*, u.name AS created_by_name FROM project_notes n
       LEFT JOIN users u ON u.id = n.created_by WHERE n.id = ?`,
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
      `SELECT n.*, u.name AS created_by_name FROM project_notes n
       LEFT JOIN users u ON u.id = n.created_by WHERE n.id = ?`,
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
      `SELECT tl.*, u.name AS user_name FROM project_time_logs tl
       LEFT JOIN users u ON u.id = tl.logged_by
       WHERE tl.project_id = ? ORDER BY tl.log_date DESC, tl.created_at DESC`,
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
    if (!hours_logged || isNaN(Number(hours_logged)))
      return res.status(400).json({ error: "Valid hours_logged is required" });
    const logId = uuidv4();
    await pool.query(
      `INSERT INTO project_time_logs
         (id, project_id, hours_logged, log_date, is_billable, description, logged_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [logId, req.params.id, Number(hours_logged),
       safeDate(log_date) || new Date().toISOString().slice(0, 10),
       is_billable ? 1 : 0, description || null, authId(req)]
    );
    const [rows] = await pool.query(
      `SELECT tl.*, u.name AS user_name FROM project_time_logs tl
       LEFT JOIN users u ON u.id = tl.logged_by WHERE tl.id = ?`,
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
      `SELECT pt.*, u.name, u.email, u.phone FROM project_team pt
       LEFT JOIN users u ON u.id = pt.user_id
       WHERE pt.project_id = ? ORDER BY pt.created_at ASC`,
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
    if (existing.length) return res.status(409).json({ error: "User already assigned to this project" });

    // Do NOT insert id — let auto_increment handle it
    const [insertResult] = await pool.query(
      `INSERT INTO project_team
         (project_id, user_id, role, skills_assigned, workload_capacity, hours_per_week, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [req.params.id, user_id, role || null, skills_assigned || null,
       Number(workload_capacity), Number(hours_per_week)]
    );

    // Use auto-generated integer id to fetch the new row
    const [rows] = await pool.query(
      `SELECT pt.*, u.name, u.email, u.phone FROM project_team pt
       LEFT JOIN users u ON u.id = pt.user_id WHERE pt.id = ?`,
      [insertResult.insertId]
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