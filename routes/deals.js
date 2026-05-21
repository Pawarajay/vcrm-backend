// routes/deals.js
// BUG 7 fix: creates /api/deals
// Register in app.js with: app.use('/api/deals', require('./routes/deals'));

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// ─── helpers ──────────────────────────────────────────────────────────────

async function tableExists() {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'deals'`
  );
  return rows[0].cnt > 0;
}

async function getDealCols() {
  const [cols] = await pool.execute("SHOW COLUMNS FROM deals");
  return new Set(cols.map((c) => c.Field));
}

/**
 * BUG 4 pattern: verify a FK row exists before trusting the caller's id.
 * Returns the id if valid, null otherwise.
 */
async function safeFK(table, id) {
  if (!id) return null;
  const [rows] = await pool.execute(
    `SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length ? id : null;
}

// ─── GET /api/deals ───────────────────────────────────────────────────────

router.get("/", authenticateToken, async (req, res) => {
  try {
    if (!(await tableExists())) {
      return res.json({ deals: [], total: 0 });
    }

    const [rows] = await pool.execute(
      `SELECT * FROM deals ORDER BY created_at DESC`
    );
    return res.json({ deals: rows, total: rows.length });
  } catch (err) {
    console.error("deals GET /:", err);
    return res.status(500).json({ error: "Failed to fetch deals", detail: err.message });
  }
});

// ─── GET /api/deals/:id ───────────────────────────────────────────────────

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM deals WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Deal not found" });
    return res.json({ deal: rows[0] });
  } catch (err) {
    console.error("deals GET /:id:", err);
    return res.status(500).json({ error: "Failed to fetch deal", detail: err.message });
  }
});

// ─── POST /api/deals ──────────────────────────────────────────────────────

router.post("/", authenticateToken, async (req, res) => {
  try {
    if (!(await tableExists())) {
      return res.status(503).json({ error: "deals table does not exist yet" });
    }

    const cols = await getDealCols();

    // Validate FK columns before INSERT (mirrors BUG 4 fix in projects.js)
    const body = { ...req.body };

    if (cols.has("customer_id")) {
      body.customer_id = await safeFK("customers", body.customer_id);
    }
    if (cols.has("lead_id")) {
      body.lead_id = await safeFK("leads", body.lead_id);
    }
    if (cols.has("assigned_to")) {
      body.assigned_to = await safeFK("users", body.assigned_to);
    }

    const id = uuidv4();
    const data = { id, ...body };

    const fields = Object.keys(data).filter((k) => cols.has(k));
    const values = fields.map((f) => data[f]);
    const placeholders = fields.map(() => "?").join(", ");

    await pool.execute(
      `INSERT INTO deals (${fields.join(", ")}) VALUES (${placeholders})`,
      values
    );

    const [inserted] = await pool.execute(
      `SELECT * FROM deals WHERE id = ?`,
      [id]
    );
    return res.status(201).json({ deal: inserted[0] });
  } catch (err) {
    console.error("deals POST /:", err);
    return res.status(500).json({ error: "Failed to create deal", detail: err.message });
  }
});

// ─── PUT /api/deals/:id ───────────────────────────────────────────────────

router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const cols = await getDealCols();
    const allowed = Object.keys(req.body).filter(
      (k) => cols.has(k) && k !== "id"
    );
    if (!allowed.length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const setClause = allowed.map((f) => `${f} = ?`).join(", ");
    const values = [...allowed.map((f) => req.body[f]), req.params.id];

    await pool.execute(
      `UPDATE deals SET ${setClause} WHERE id = ?`,
      values
    );

    const [updated] = await pool.execute(
      `SELECT * FROM deals WHERE id = ?`,
      [req.params.id]
    );
    if (!updated.length) return res.status(404).json({ error: "Deal not found" });
    return res.json({ deal: updated[0] });
  } catch (err) {
    console.error("deals PUT /:id:", err);
    return res.status(500).json({ error: "Failed to update deal", detail: err.message });
  }
});

// ─── DELETE /api/deals/:id ────────────────────────────────────────────────

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM deals WHERE id = ?`,
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Deal not found" });
    }
    return res.json({ message: "Deal deleted" });
  } catch (err) {
    console.error("deals DELETE /:id:", err);
    return res.status(500).json({ error: "Failed to delete deal", detail: err.message });
  }
});

module.exports = router;