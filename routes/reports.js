const express = require("express");
const { query, validationResult } = require("express-validator");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// ─── HELPER: date filter SQL ──────────────────────────────────────────────────
const getDateFilter = (period = "30") => {
  const days = parseInt(period, 10);
  if (isNaN(days) || days <= 0) return "DATE_SUB(NOW(), INTERVAL 30 DAY)";
  return `DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
};

// ─── ROLE FILTER ──────────────────────────────────────────────────────────────
const roleFilter = (req, tableAlias = "") => {
  const col = tableAlias ? `${tableAlias}.assigned_to` : "assigned_to";
  if (req.user.role !== "admin") {
    return { clause: `AND ${col} = ?`, params: [req.user.userId] };
  }
  return { clause: "", params: [] };
};

// =============================================================================
// GET /reports/dashboard  — Main dashboard overview (Renalease medical context)
// =============================================================================
router.get("/dashboard", authenticateToken, async (req, res) => {
  try {
    const { period = "30" } = req.query;
    const dateFilter = getDateFilter(period);
    const rf = roleFilter(req, "c");

    // ── Active patients ───────────────────────────────────────────────────────
    const [[{ activePatients }]] = await pool.execute(
      `SELECT COUNT(*) AS activePatients FROM customers WHERE status = 'active' ${rf.clause}`,
      sanitize(...rf.params)
    );

    // ── New leads (in period) ─────────────────────────────────────────────────
    const rfL = roleFilter(req, "l");
    const [[{ newLeads }]] = await pool.execute(
      `SELECT COUNT(*) AS newLeads FROM leads l
       WHERE l.created_at >= ${dateFilter} ${rfL.clause}`,
      sanitize(...rfL.params)
    );

    // ── Converted leads ───────────────────────────────────────────────────────
    const [[{ convertedLeads }]] = await pool.execute(
      `SELECT COUNT(*) AS convertedLeads FROM leads l
       WHERE l.status = 'converted' AND l.created_at >= ${dateFilter} ${rfL.clause}`,
      sanitize(...rfL.params)
    );

    // ── Revenue stats (invoices) ──────────────────────────────────────────────
    const [[revenueStats]] = await pool.execute(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid'    THEN total ELSE 0 END), 0) AS paidRevenue,
        COALESCE(SUM(CASE WHEN status IN ('sent','pending') THEN total ELSE 0 END), 0) AS pendingRevenue,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END), 0) AS overdueRevenue,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END)  AS overdueCount,
        COUNT(CASE WHEN status = 'paid'    THEN 1 END)  AS paidCount,
        COUNT(*)                                         AS totalInvoices,
        COALESCE(SUM(total), 0)                          AS totalBilled
      FROM invoices
      WHERE created_at >= ${dateFilter}
    `);

    // ── GST collected ─────────────────────────────────────────────────────────
    const [[{ totalGstCollected }]] = await pool.execute(`
      SELECT COALESCE(SUM(amount * tax / 100), 0) AS totalGstCollected
      FROM invoices WHERE status = 'paid' AND created_at >= ${dateFilter}
    `);

    // ── Recurring vs one-time invoices ────────────────────────────────────────
    const [recurringStats] = await pool.execute(`
      SELECT
        SUM(CASE WHEN is_recurring = 1 THEN 1 ELSE 0 END) AS recurringCount,
        SUM(CASE WHEN is_recurring = 0 THEN 1 ELSE 0 END) AS oneTimeCount,
        SUM(CASE WHEN is_recurring = 1 THEN total ELSE 0 END) AS recurringRevenue
      FROM invoices WHERE created_at >= ${dateFilter}
    `);

    // ── Leads by status ───────────────────────────────────────────────────────
    const [leadsByStatus] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM leads l
       WHERE l.created_at >= ${dateFilter} ${rfL.clause}
       GROUP BY status`,
      sanitize(...rfL.params)
    );

    // ── Leads by source ───────────────────────────────────────────────────────
    const [leadsBySource] = await pool.execute(
      `SELECT
         COALESCE(source, 'unknown') AS source,
         COUNT(*) AS count
       FROM leads l
       WHERE l.created_at >= ${dateFilter} ${rfL.clause}
       GROUP BY source`,
      sanitize(...rfL.params)
    );

    // ── Leads by service ──────────────────────────────────────────────────────
    const [leadsByService] = await pool.execute(
      `SELECT
         COALESCE(service, 'other') AS service,
         COUNT(*) AS count
       FROM leads l
       WHERE l.created_at >= ${dateFilter} ${rfL.clause}
       GROUP BY service`,
      sanitize(...rfL.params)
    );

    // ── Follow-ups due ────────────────────────────────────────────────────────
    const [[{ followUpsDue }]] = await pool.execute(`
      SELECT COUNT(*) AS followUpsDue FROM leads
      WHERE follow_up_date <= CURDATE()
      AND status NOT IN ('converted','closed-lost')
    `);

    // ── Monthly revenue trend (last 6 months) ─────────────────────────────────
    const [monthlyRevenue] = await pool.execute(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        DATE_FORMAT(created_at, '%b %Y') AS label,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0)  AS paid,
        COALESCE(SUM(CASE WHEN status != 'paid' THEN total ELSE 0 END), 0) AS pending,
        COUNT(*) AS invoiceCount
      FROM invoices
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
      ORDER BY month ASC
    `);

    // ── Lead acquisition daily trend (in period) ──────────────────────────────
    const [leadTrend] = await pool.execute(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
         DATE_FORMAT(created_at, '%d %b')     AS label,
         COUNT(*) AS count,
         SUM(CASE WHEN source = 'whatsapp'       THEN 1 ELSE 0 END) AS whatsapp,
         SUM(CASE WHEN source = 'booking-engine' THEN 1 ELSE 0 END) AS booking,
         SUM(CASE WHEN source = 'website'        THEN 1 ELSE 0 END) AS website,
         SUM(CASE WHEN source = 'referral'       THEN 1 ELSE 0 END) AS referral,
         SUM(CASE WHEN source = 'manual'         THEN 1 ELSE 0 END) AS manual
       FROM leads l
       WHERE l.created_at >= ${dateFilter} ${rfL.clause}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d'), DATE_FORMAT(created_at, '%d %b')
       ORDER BY day ASC`,
      sanitize(...rfL.params)
    );

    // ── Service demand breakdown ──────────────────────────────────────────────
    const [serviceDemand] = await pool.execute(`
      SELECT
        COALESCE(service, 'other') AS service,
        COUNT(*) AS leadCount,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS convertedCount
      FROM leads
      GROUP BY service
      ORDER BY leadCount DESC
    `);

    // ── Top referring sources (patients referred) ─────────────────────────────
    const [topReferrals] = await pool.execute(`
      SELECT referred_by, COUNT(*) AS count
      FROM leads
      WHERE referred_by IS NOT NULL AND referred_by != ''
      GROUP BY referred_by
      ORDER BY count DESC
      LIMIT 10
    `);

    // ── Payment collection rate ───────────────────────────────────────────────
    const [[{ collectionRate }]] = await pool.execute(`
      SELECT
        CASE WHEN SUM(total) > 0
          THEN ROUND(SUM(CASE WHEN status='paid' THEN total ELSE 0 END) / SUM(total) * 100, 1)
          ELSE 0
        END AS collectionRate
      FROM invoices
      WHERE created_at >= ${dateFilter}
    `);

    // ── Overdue invoices list (top 5) ─────────────────────────────────────────
    const [overdueInvoices] = await pool.execute(`
      SELECT i.invoice_number, c.name AS customerName,
             i.total, i.due_date,
             DATEDIFF(CURDATE(), i.due_date) AS daysOverdue
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.status = 'overdue'
      ORDER BY i.due_date ASC
      LIMIT 5
    `);

    // ── Recent leads (last 5) ─────────────────────────────────────────────────
    const [recentLeads] = await pool.execute(`
      SELECT name, source, service, status, created_at
      FROM leads
      ORDER BY created_at DESC
      LIMIT 5
    `);

    res.json({
      summary: {
        activePatients,
        newLeads,
        convertedLeads,
        followUpsDue,
        conversionRate: newLeads > 0 ? +((convertedLeads / newLeads) * 100).toFixed(1) : 0,
        collectionRate: collectionRate || 0,
      },
      revenue: {
        paid:        +revenueStats.paidRevenue,
        pending:     +revenueStats.pendingRevenue,
        overdue:     +revenueStats.overdueRevenue,
        totalBilled: +revenueStats.totalBilled,
        overdueCount: revenueStats.overdueCount,
        paidCount:    revenueStats.paidCount,
        totalInvoices: revenueStats.totalInvoices,
        gstCollected:  +totalGstCollected,
        recurringCount:   +(recurringStats[0]?.recurringCount || 0),
        oneTimeCount:     +(recurringStats[0]?.oneTimeCount   || 0),
        recurringRevenue: +(recurringStats[0]?.recurringRevenue || 0),
      },
      charts: {
        monthlyRevenue,
        leadTrend,
        leadsByStatus,
        leadsBySource,
        leadsByService,
        serviceDemand,
      },
      lists: {
        topReferrals,
        overdueInvoices,
        recentLeads,
      },
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard statistics" });
  }
});

// =============================================================================
// GET /reports/leads  — Detailed lead analytics
// =============================================================================
router.get("/leads", authenticateToken, async (req, res) => {
  try {
    const { period = "30" } = req.query;
    const dateFilter = getDateFilter(period);
    const rfL = roleFilter(req, "l");

    const [byStatus] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM leads l
       WHERE l.created_at >= ${dateFilter} ${rfL.clause} GROUP BY status`,
      sanitize(...rfL.params)
    );

    const [bySource] = await pool.execute(
      `SELECT COALESCE(source,'unknown') AS source, COUNT(*) AS count
       FROM leads l WHERE l.created_at >= ${dateFilter} ${rfL.clause} GROUP BY source`,
      sanitize(...rfL.params)
    );

    const [byService] = await pool.execute(
      `SELECT COALESCE(service,'other') AS service, COUNT(*) AS count
       FROM leads l WHERE l.created_at >= ${dateFilter} ${rfL.clause} GROUP BY service`,
      sanitize(...rfL.params)
    );

    const [byPriority] = await pool.execute(
      `SELECT priority, COUNT(*) AS count
       FROM leads l WHERE l.created_at >= ${dateFilter} ${rfL.clause} GROUP BY priority`,
      sanitize(...rfL.params)
    );

    const [conversionFunnel] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('qualified','quotation-sent','converted') THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN status = 'quotation-sent' THEN 1 ELSE 0 END) AS quotationSent,
         SUM(CASE WHEN status = 'converted'      THEN 1 ELSE 0 END) AS converted,
         SUM(CASE WHEN status = 'closed-lost'    THEN 1 ELSE 0 END) AS lost
       FROM leads l WHERE l.created_at >= ${dateFilter} ${rfL.clause}`,
      sanitize(...rfL.params)
    );

    res.json({ byStatus, bySource, byService, byPriority, conversionFunnel: conversionFunnel[0] });
  } catch (err) {
    console.error("Lead analytics error:", err);
    res.status(500).json({ error: "Failed to generate lead analytics" });
  }
});

// =============================================================================
// GET /reports/revenue  — Invoice / billing analytics
// =============================================================================
router.get("/revenue", authenticateToken, async (req, res) => {
  try {
    const { period = "90" } = req.query;
    const dateFilter = getDateFilter(period);

    const [monthly] = await pool.execute(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        DATE_FORMAT(created_at, '%b %Y') AS label,
        COALESCE(SUM(amount), 0) AS subtotal,
        COALESCE(SUM(amount * tax / 100), 0) AS gstAmount,
        COALESCE(SUM(total), 0)  AS totalWithGst,
        COALESCE(SUM(CASE WHEN status = 'paid'    THEN total ELSE 0 END), 0) AS paid,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END), 0) AS overdue,
        COUNT(*) AS invoiceCount,
        COUNT(CASE WHEN is_recurring = 1 THEN 1 END) AS recurringCount
      FROM invoices
      WHERE created_at >= ${dateFilter}
      GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
      ORDER BY month
    `);

    const [byStatus] = await pool.execute(`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS totalAmount
      FROM invoices WHERE created_at >= ${dateFilter}
      GROUP BY status
    `);

    const [topPatients] = await pool.execute(`
      SELECT c.name, c.company,
             COUNT(i.id) AS invoiceCount,
             COALESCE(SUM(i.total), 0) AS totalBilled,
             COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total ELSE 0 END), 0) AS totalPaid
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.created_at >= ${dateFilter}
      GROUP BY i.customer_id, c.name, c.company
      ORDER BY totalBilled DESC
      LIMIT 10
    `);

    res.json({ monthly, byStatus, topPatients });
  } catch (err) {
    console.error("Revenue analytics error:", err);
    res.status(500).json({ error: "Failed to generate revenue analytics" });
  }
});

// =============================================================================
// GET /reports/patients  — Patient / customer analytics
// =============================================================================
router.get("/patients", authenticateToken, async (req, res) => {
  try {
    const rf = roleFilter(req, "c");

    const [byStatus] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM customers c
       WHERE 1=1 ${rf.clause} GROUP BY status`,
      sanitize(...rf.params)
    );

    const [byService] = await pool.execute(
      `SELECT COALESCE(service,'other') AS service, COUNT(*) AS count
       FROM customers c WHERE 1=1 ${rf.clause} GROUP BY service`,
      sanitize(...rf.params)
    );

    const [acquisitionTrend] = await pool.execute(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m') AS month,
         DATE_FORMAT(created_at, '%b %Y') AS label,
         COUNT(*) AS count
       FROM customers c
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) ${rf.clause}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
       ORDER BY month`,
      sanitize(...rf.params)
    );

    const [topByValue] = await pool.execute(
      `SELECT name, company, total_value, status
       FROM customers c WHERE 1=1 ${rf.clause}
       ORDER BY total_value DESC LIMIT 10`,
      sanitize(...rf.params)
    );

    res.json({ byStatus, byService, acquisitionTrend, topByValue });
  } catch (err) {
    console.error("Patient analytics error:", err);
    res.status(500).json({ error: "Failed to generate patient analytics" });
  }
});

module.exports = router;