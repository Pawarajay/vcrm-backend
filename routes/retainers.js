// const express = require("express");
// const { body, validationResult, query } = require("express-validator");
// const { pool } = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");
// const { v4: uuidv4 } = require("uuid");

// const router = express.Router();

// // ─── SOW §2.5 + §2.6: RETAINER CONFIG ────────────────────────────────────────

// // SOW §2.5: Retainer status options
// const RETAINER_STATUSES = ["active", "inactive", "expired"];

// // SOW §2.5: Services for recurring clients
// const RETAINER_SERVICES = [
//   "whatsapp",
//   "website",
//   "digital_marketing",
//   "crm",
//   "lms",
//   "mobile_app",
//   "admin_panel",
//   "devops",
//   "social-media",
//   "other",
// ];

// // SOW §2.5: Renewal warning thresholds (days)
// const RENEWAL_WARN_DAYS  = 30;
// const RENEWAL_ALERT_DAYS = 7;

// // ─── HELPERS ──────────────────────────────────────────────────────────────────

// const sanitizeParams = (...params) =>
//   params.map((p) => (p === undefined ? null : p));

// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({ error: "Validation failed", details: errors.array() });
//     return true;
//   }
//   return false;
// };

// // Safe date parser — returns YYYY-MM-DD string or null
// const safeDate = (value) => {
//   if (!value) return null;
//   const d = new Date(value);
//   if (isNaN(d.getTime())) return null;
//   return d.toISOString().slice(0, 10);
// };

// // ─── FIELD MAP ─────────────────────────────────────────────────────────────────
// // camelCase frontend keys → snake_case DB columns (both formats accepted)

// const retainerFieldMap = {
//   clientName:      "client_name",
//   client_name:     "client_name",
//   service:         "service",
//   monthlyAmount:   "monthly_amount",
//   monthly_amount:  "monthly_amount",
//   startDate:       "start_date",
//   start_date:      "start_date",
//   renewalDate:     "renewal_date",
//   renewal_date:    "renewal_date",
//   status:          "status",
//   phone:           "phone",
//   whatsappNumber:  "whatsapp_number",
//   whatsapp_number: "whatsapp_number",
//   notes:           "notes",
// };

// // =============================================================================
// // MIGRATION SQL — run this once to create the table
// // =============================================================================
// // CREATE TABLE IF NOT EXISTS retainers (
// //   id               VARCHAR(36)    NOT NULL PRIMARY KEY,
// //   client_name      VARCHAR(255)   NOT NULL,
// //   service          VARCHAR(100)   NOT NULL,
// //   monthly_amount   DECIMAL(12,2)  NOT NULL DEFAULT 0,
// //   start_date       DATE           NOT NULL,
// //   renewal_date     DATE           NOT NULL,
// //   status           ENUM('active','inactive','expired') NOT NULL DEFAULT 'active',
// //   phone            VARCHAR(30)    DEFAULT NULL,
// //   whatsapp_number  VARCHAR(30)    DEFAULT NULL,
// //   notes            TEXT           DEFAULT NULL,
// //   created_by       VARCHAR(36)    DEFAULT NULL,
// //   created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
// //   updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
// //   INDEX idx_status        (status),
// //   INDEX idx_renewal_date  (renewal_date),
// //   INDEX idx_client_name   (client_name),
// //   INDEX idx_created_by    (created_by)
// // );

// // =============================================================================
// // GET ALL RETAINERS  (SOW §2.5 — Retainer list with filters)
// // =============================================================================

// router.get(
//   "/",
//   authenticateToken,
//   [
//     query("page").optional().isInt({ min: 1 }),
//     query("limit").optional().isInt({ min: 1, max: 100 }),
//     query("search").optional().isString(),
//     query("phone").optional().isString(),
//     query("status").optional().isIn([...RETAINER_STATUSES, "all"]),
//     query("service").optional().isIn([...RETAINER_SERVICES, "all"]),
//     // SOW §2.5: Renewal due filters
//     query("renewalFilter").optional().isIn(["all", "expired", "this-week", "this-month", "upcoming"]),
//     query("dateSort").optional().isIn(["soonest", "latest", "amount-high", "amount-low", "newest"]),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const pageRaw  = parseInt(req.query.page,  10);
//       const limitRaw = parseInt(req.query.limit, 10);
//       const page  = !isNaN(pageRaw)  && pageRaw  > 0              ? pageRaw  : 1;
//       const limit = !isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
//       const offset = (page - 1) * limit;

//       const {
//         search,
//         phone:         phoneSearch,
//         status,
//         service,
//         renewalFilter = "all",
//         dateSort      = "soonest",
//       } = req.query;

//       let whereClause = "WHERE 1=1";
//       const queryParams = [];

//       // Client name search
//       if (search) {
//         whereClause += " AND r.client_name LIKE ?";
//         queryParams.push(`%${search}%`);
//       }

//       // Phone search
//       if (phoneSearch) {
//         whereClause += " AND (r.phone LIKE ? OR r.whatsapp_number LIKE ?)";
//         const p = `%${phoneSearch}%`;
//         queryParams.push(p, p);
//       }

//       // Status filter
//       if (status && status !== "all") {
//         whereClause += " AND r.status = ?";
//         queryParams.push(status);
//       }

//       // Service filter
//       if (service && service !== "all") {
//         whereClause += " AND r.service = ?";
//         queryParams.push(service);
//       }

//       // SOW §2.5: Renewal due filter
//       if (renewalFilter !== "all") {
//         if (renewalFilter === "expired") {
//           whereClause += " AND r.renewal_date < CURDATE()";
//         } else if (renewalFilter === "this-week") {
//           whereClause += " AND r.renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)";
//         } else if (renewalFilter === "this-month" || renewalFilter === "upcoming") {
//           whereClause += " AND r.renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
//         }
//       }

//       // Sorting
//       let orderClause;
//       switch (dateSort) {
//         case "latest":       orderClause = "r.renewal_date DESC";    break;
//         case "amount-high":  orderClause = "r.monthly_amount DESC";  break;
//         case "amount-low":   orderClause = "r.monthly_amount ASC";   break;
//         case "newest":       orderClause = "r.created_at DESC";      break;
//         case "soonest":
//         default:             orderClause = "r.renewal_date ASC";     break;
//       }

//       const retainersSql = `
//         SELECT
//           r.*,
//           u.name AS created_by_name
//         FROM retainers r
//         LEFT JOIN users u ON r.created_by = u.id
//         ${whereClause}
//         ORDER BY ${orderClause}
//         LIMIT ${Number(limit)} OFFSET ${Number(offset)}
//       `;

//       const [retainers] = await pool.execute(retainersSql, sanitizeParams(...queryParams));

//       const countSql = `SELECT COUNT(*) AS total FROM retainers r ${whereClause}`;
//       const [countResult] = await pool.execute(countSql, sanitizeParams(...queryParams));

//       const total      = countResult[0]?.total || 0;
//       const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

//       res.json({
//         retainers,
//         pagination: {
//           page, limit, total, totalPages,
//           hasNext: page < totalPages,
//           hasPrev: page > 1,
//         },
//       });
//     } catch (error) {
//       console.error("Retainers fetch error:", error);
//       res.status(500).json({ error: "Failed to fetch retainers" });
//     }
//   }
// );

// // =============================================================================
// // RETAINER STATS  (SOW §2.7 — Dashboard KPIs: MRR, renewals due)
// // =============================================================================

// router.get("/stats", authenticateToken, async (req, res) => {
//   try {
//     const [rows] = await pool.execute(`
//       SELECT
//         COUNT(*)                                                                 AS totalRetainers,
//         -- SOW §2.5: Active count
//         SUM(CASE WHEN status = 'active'   THEN 1 ELSE 0 END)                   AS activeCount,
//         SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END)                   AS inactiveCount,
//         SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END)                   AS expiredCount,
//         -- SOW §2.6: MRR — sum of all active monthly amounts
//         SUM(CASE WHEN status = 'active' THEN monthly_amount ELSE 0 END)        AS mrr,
//         -- SOW §2.5: Renewal alerts — due within 7 days
//         SUM(CASE WHEN status = 'active'
//                   AND renewal_date BETWEEN CURDATE()
//                   AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
//              THEN 1 ELSE 0 END)                                                AS renewingAlert,
//         -- SOW §2.5: Renewal warnings — due within 30 days
//         SUM(CASE WHEN status = 'active'
//                   AND renewal_date BETWEEN CURDATE()
//                   AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
//              THEN 1 ELSE 0 END)                                                AS renewingWarn,
//         -- Overdue / expired (active but past renewal date)
//         SUM(CASE WHEN status = 'active' AND renewal_date < CURDATE()
//              THEN 1 ELSE 0 END)                                                AS overdueRenewals
//       FROM retainers
//     `, sanitizeParams(RENEWAL_ALERT_DAYS, RENEWAL_WARN_DAYS));

//     // Service breakdown
//     const [serviceBreakdown] = await pool.execute(`
//       SELECT service, COUNT(*) AS count, SUM(monthly_amount) AS revenue
//       FROM retainers
//       WHERE status = 'active'
//       GROUP BY service
//       ORDER BY revenue DESC
//     `);

//     // Upcoming renewals (next 30 days) — for dashboard widget
//     const [upcomingRenewals] = await pool.execute(`
//       SELECT id, client_name, service, monthly_amount, renewal_date,
//              DATEDIFF(renewal_date, CURDATE()) AS days_until_renewal
//       FROM retainers
//       WHERE status = 'active'
//         AND renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
//       ORDER BY renewal_date ASC
//       LIMIT 10
//     `, sanitizeParams(RENEWAL_WARN_DAYS));

//     // MRR trend — last 6 months (based on active retainers at each point)
//     const [mrrTrend] = await pool.execute(`
//       SELECT
//         DATE_FORMAT(created_at, '%Y-%m') AS month,
//         SUM(monthly_amount) AS mrr,
//         COUNT(*) AS newRetainers
//       FROM retainers
//       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
//       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
//       ORDER BY month ASC
//     `);

//     res.json({
//       stats:            rows[0] || {},
//       serviceBreakdown,
//       upcomingRenewals,
//       mrrTrend,
//     });
//   } catch (error) {
//     console.error("Retainer stats error:", error);
//     res.status(500).json({ error: "Failed to fetch retainer stats" });
//   }
// });

// // =============================================================================
// // GET RETAINER BY ID
// // =============================================================================

// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const [retainers] = await pool.execute(
//       `SELECT r.*, u.name AS created_by_name
//        FROM retainers r
//        LEFT JOIN users u ON r.created_by = u.id
//        WHERE r.id = ?`,
//       sanitizeParams(id)
//     );

//     if (retainers.length === 0) {
//       return res.status(404).json({ error: "Retainer not found" });
//     }

//     res.json({ retainer: retainers[0] });
//   } catch (error) {
//     console.error("Retainer fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch retainer" });
//   }
// });

// // =============================================================================
// // CREATE RETAINER  (SOW §2.5 — Add retainer client)
// // =============================================================================

// router.post(
//   "/",
//   authenticateToken,
//   [
//     body("clientName").trim().notEmpty().withMessage("Client name is required"),
//     body("service").notEmpty().isIn(RETAINER_SERVICES).withMessage("Valid service is required"),
//     body("monthlyAmount").notEmpty().isNumeric().withMessage("Monthly amount is required"),
//     body("startDate").notEmpty().isISO8601().withMessage("Valid start date is required"),
//     body("renewalDate").notEmpty().isISO8601().withMessage("Valid renewal date is required"),
//     body("status").optional().isIn(RETAINER_STATUSES),
//     body("phone").optional().isString(),
//     body("whatsappNumber").optional().isString(),
//     body("notes").optional().isString(),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const {
//         clientName, service, monthlyAmount,
//         startDate, renewalDate,
//         status       = "active",
//         phone        = null,
//         whatsappNumber = null,
//         notes        = null,
//       } = req.body;

//       const safeMonthlyAmount = Number(monthlyAmount);
//       if (isNaN(safeMonthlyAmount) || safeMonthlyAmount < 0) {
//         return res.status(400).json({ error: "Monthly amount must be a valid non-negative number" });
//       }

//       const safeStartDate   = safeDate(startDate);
//       const safeRenewalDate = safeDate(renewalDate);

//       if (!safeStartDate)   return res.status(400).json({ error: "Invalid start date" });
//       if (!safeRenewalDate) return res.status(400).json({ error: "Invalid renewal date" });

//       const retainerId = uuidv4();
//       const createdBy  = req.user.id;

//       await pool.execute(
//         `INSERT INTO retainers (
//           id, client_name, service, monthly_amount,
//           start_date, renewal_date, status,
//           phone, whatsapp_number, notes,
//           created_by, created_at, updated_at
//         ) VALUES (
//           ?, ?, ?, ?,
//           ?, ?, ?,
//           ?, ?, ?,
//           ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
//         )`,
//         sanitizeParams(
//           retainerId, clientName.trim(), service, safeMonthlyAmount,
//           safeStartDate, safeRenewalDate, status,
//           phone, whatsappNumber ?? phone, notes,
//           createdBy
//         )
//       );

//       const [retainers] = await pool.execute(
//         `SELECT r.*, u.name AS created_by_name
//          FROM retainers r
//          LEFT JOIN users u ON r.created_by = u.id
//          WHERE r.id = ?`,
//         sanitizeParams(retainerId)
//       );

//       res.status(201).json({
//         message: "Retainer created successfully",
//         retainer: retainers[0],
//       });
//     } catch (error) {
//       console.error("Retainer creation error:", error);
//       res.status(500).json({ error: "Failed to create retainer" });
//     }
//   }
// );

// // =============================================================================
// // UPDATE RETAINER  (SOW §2.5 — Edit details, status change, renew)
// // =============================================================================

// router.put(
//   "/:id",
//   authenticateToken,
//   [
//     body("clientName").optional().trim().notEmpty(),
//     body("client_name").optional().trim().notEmpty(),
//     body("service").optional().isIn(RETAINER_SERVICES),
//     body("monthlyAmount").optional().isNumeric(),
//     body("monthly_amount").optional().isNumeric(),
//     body("startDate").optional().isISO8601(),
//     body("start_date").optional().isISO8601(),
//     body("renewalDate").optional().isISO8601(),
//     body("renewal_date").optional().isISO8601(),
//     body("status").optional().isIn(RETAINER_STATUSES),
//     body("phone").optional().isString(),
//     body("whatsappNumber").optional().isString(),
//     body("whatsapp_number").optional().isString(),
//     body("notes").optional().isString(),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { id } = req.params;

//       // Verify retainer exists
//       const [existing] = await pool.execute(
//         "SELECT id FROM retainers WHERE id = ?",
//         sanitizeParams(id)
//       );
//       if (existing.length === 0) {
//         return res.status(404).json({ error: "Retainer not found" });
//       }

//       const updateData = { ...req.body };

//       // Normalise camelCase → snake_case aliases
//       const aliases = [
//         ["clientName",    "client_name"],
//         ["monthlyAmount", "monthly_amount"],
//         ["startDate",     "start_date"],
//         ["renewalDate",   "renewal_date"],
//         ["whatsappNumber","whatsapp_number"],
//       ];

//       for (const [camel, snake] of aliases) {
//         if (updateData[camel] !== undefined && updateData[snake] === undefined) {
//           updateData[snake] = updateData[camel];
//         }
//         delete updateData[camel];
//       }

//       // Normalise dates
//       if (updateData.start_date)   updateData.start_date   = safeDate(updateData.start_date);
//       if (updateData.renewal_date) updateData.renewal_date = safeDate(updateData.renewal_date);

//       // Normalise amount
//       if (updateData.monthly_amount !== undefined) {
//         const n = Number(updateData.monthly_amount);
//         if (isNaN(n) || n < 0) {
//           return res.status(400).json({ error: "Monthly amount must be a valid non-negative number" });
//         }
//         updateData.monthly_amount = n;
//       }

//       // SOW §2.5: Auto-set status to "active" when renewal date is extended
//       if (updateData.renewal_date) {
//         const renewalDate = new Date(updateData.renewal_date);
//         if (!isNaN(renewalDate.getTime()) && renewalDate > new Date()) {
//           // Only auto-activate if status isn't being explicitly set to inactive
//           if (updateData.status !== "inactive") {
//             updateData.status = "active";
//           }
//         }
//       }

//       // Build SET clause from retainerFieldMap
//       const updateFields = [];
//       const updateValues = [];
//       const seenDbFields = new Set();

//       Object.entries(updateData).forEach(([key, value]) => {
//         if (value === undefined) return;
//         const dbField = retainerFieldMap[key];
//         if (!dbField) return;
//         if (seenDbFields.has(dbField)) return;
//         seenDbFields.add(dbField);
//         updateFields.push(`${dbField} = ?`);
//         updateValues.push(value === "" ? null : value);
//       });

//       if (updateFields.length === 0) {
//         return res.status(400).json({ error: "No valid fields to update" });
//       }

//       updateValues.push(id);

//       await pool.execute(
//         `UPDATE retainers SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//         sanitizeParams(...updateValues)
//       );

//       const [retainers] = await pool.execute(
//         `SELECT r.*, u.name AS created_by_name
//          FROM retainers r
//          LEFT JOIN users u ON r.created_by = u.id
//          WHERE r.id = ?`,
//         sanitizeParams(id)
//       );

//       res.json({
//         message: "Retainer updated successfully",
//         retainer: retainers[0],
//       });
//     } catch (error) {
//       console.error("Retainer update error:", error);
//       res.status(500).json({ error: "Failed to update retainer" });
//     }
//   }
// );

// // =============================================================================
// // RENEW RETAINER  (SOW §2.5 — Quick renewal endpoint)
// // Sets a new renewal date and reactivates the retainer in one call
// // =============================================================================

// router.post(
//   "/:id/renew",
//   authenticateToken,
//   [
//     body("renewalDate").notEmpty().isISO8601().withMessage("Valid renewal date is required"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { id } = req.params;
//       const { renewalDate } = req.body;

//       const [existing] = await pool.execute(
//         "SELECT id, client_name, renewal_date FROM retainers WHERE id = ?",
//         sanitizeParams(id)
//       );
//       if (existing.length === 0) {
//         return res.status(404).json({ error: "Retainer not found" });
//       }

//       const safeRenewalDate = safeDate(renewalDate);
//       if (!safeRenewalDate) {
//         return res.status(400).json({ error: "Invalid renewal date" });
//       }

//       // SOW §2.5: Renewing always reactivates the retainer
//       await pool.execute(
//         `UPDATE retainers
//          SET renewal_date = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
//          WHERE id = ?`,
//         sanitizeParams(safeRenewalDate, id)
//       );

//       const [retainers] = await pool.execute(
//         `SELECT r.*, u.name AS created_by_name
//          FROM retainers r
//          LEFT JOIN users u ON r.created_by = u.id
//          WHERE r.id = ?`,
//         sanitizeParams(id)
//       );

//       res.json({
//         message: "Retainer renewed successfully",
//         retainer: retainers[0],
//       });
//     } catch (error) {
//       console.error("Retainer renewal error:", error);
//       res.status(500).json({ error: "Failed to renew retainer" });
//     }
//   }
// );

// // =============================================================================
// // DELETE RETAINER
// // =============================================================================

// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const [existing] = await pool.execute(
//       "SELECT id FROM retainers WHERE id = ?",
//       sanitizeParams(id)
//     );
//     if (existing.length === 0) {
//       return res.status(404).json({ error: "Retainer not found" });
//     }

//     await pool.execute("DELETE FROM retainers WHERE id = ?", sanitizeParams(id));

//     res.json({ message: "Retainer deleted successfully" });
//   } catch (error) {
//     console.error("Retainer deletion error:", error);
//     res.status(500).json({ error: "Failed to delete retainer" });
//   }
// });

// module.exports = router;


//testing

const express = require("express");
const { body, validationResult, query } = require("express-validator");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// ─── SOW §2.5 + §2.6: CONFIG ─────────────────────────────────────────────────

const RETAINER_STATUSES = ["active", "inactive", "expired"];

const RETAINER_SERVICES = [
  "whatsapp", "website", "digital_marketing", "crm",
  "lms", "mobile_app", "admin_panel", "devops", "social-media", "other",
];

const PAYMENT_STATUSES = ["paid", "pending", "partial"];
const PAYMENT_MODES    = ["upi", "bank_transfer", "cash"];

const RENEWAL_WARN_DAYS  = 30;
const RENEWAL_ALERT_DAYS = 7;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const sanitizeParams = (...params) =>
  params.map((p) => (p === undefined ? null : p));

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

const safeDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

// camelCase → snake_case field map for retainers
const retainerFieldMap = {
  clientName:      "client_name",
  client_name:     "client_name",
  service:         "service",
  monthlyAmount:   "monthly_amount",
  monthly_amount:  "monthly_amount",
  startDate:       "start_date",
  start_date:      "start_date",
  renewalDate:     "renewal_date",
  renewal_date:    "renewal_date",
  status:          "status",
  phone:           "phone",
  whatsappNumber:  "whatsapp_number",
  whatsapp_number: "whatsapp_number",
  notes:           "notes",
  customerId:      "customer_id",      // FIX: added customer_id linkage
  customer_id:     "customer_id",
};

// =============================================================================
// MIGRATION SQL — run once
// =============================================================================
//
// -- SOW §2.5: Retainer clients table
// CREATE TABLE IF NOT EXISTS retainers (
//   id               VARCHAR(36)    NOT NULL PRIMARY KEY,
//   client_name      VARCHAR(255)   NOT NULL,
//   customer_id      VARCHAR(36)    DEFAULT NULL,  -- optional link to customers
//   service          VARCHAR(100)   NOT NULL,
//   monthly_amount   DECIMAL(12,2)  NOT NULL DEFAULT 0,
//   start_date       DATE           NOT NULL,
//   renewal_date     DATE           NOT NULL,
//   status           ENUM('active','inactive','expired') NOT NULL DEFAULT 'active',
//   phone            VARCHAR(30)    DEFAULT NULL,
//   whatsapp_number  VARCHAR(30)    DEFAULT NULL,
//   notes            TEXT           DEFAULT NULL,
//   created_by       VARCHAR(36)    DEFAULT NULL,
//   created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//   INDEX idx_status        (status),
//   INDEX idx_renewal_date  (renewal_date),
//   INDEX idx_client_name   (client_name),
//   INDEX idx_customer_id   (customer_id)
// );
//
// -- SOW §2.6: Monthly retainer payment tracking table
// CREATE TABLE IF NOT EXISTS retainer_payments (
//   id               VARCHAR(36)    NOT NULL PRIMARY KEY,
//   retainer_id      VARCHAR(36)    NOT NULL,
//   payment_month    DATE           NOT NULL,       -- first day of month e.g. 2026-05-01
//   expected_amount  DECIMAL(12,2)  NOT NULL DEFAULT 0,
//   received_amount  DECIMAL(12,2)  NOT NULL DEFAULT 0,
//   payment_status   ENUM('paid','pending','partial') NOT NULL DEFAULT 'pending',
//   payment_date     DATE           DEFAULT NULL,
//   payment_mode     ENUM('upi','bank_transfer','cash') DEFAULT NULL,
//   remarks          TEXT           DEFAULT NULL,
//   recorded_by      VARCHAR(36)    DEFAULT NULL,
//   created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//   UNIQUE KEY uq_retainer_month (retainer_id, payment_month),
//   CONSTRAINT fk_rp_retainer FOREIGN KEY (retainer_id) REFERENCES retainers(id) ON DELETE CASCADE,
//   INDEX idx_rp_month        (payment_month),
//   INDEX idx_rp_status       (payment_status),
//   INDEX idx_rp_retainer_id  (retainer_id)
// );

// =============================================================================
// SOW §2.5: GET ALL RETAINERS
// =============================================================================

router.get(
  "/",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("phone").optional().isString(),
    query("status").optional().isIn([...RETAINER_STATUSES, "all"]),
    query("service").optional().isIn([...RETAINER_SERVICES, "all"]),
    query("renewalFilter").optional().isIn(["all", "expired", "this-week", "this-month", "upcoming"]),
    query("dateSort").optional().isIn(["soonest", "latest", "amount-high", "amount-low", "newest"]),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const pageRaw  = parseInt(req.query.page,  10);
      const limitRaw = parseInt(req.query.limit, 10);
      const page  = !isNaN(pageRaw)  && pageRaw  > 0 ? pageRaw  : 1;
      const limit = !isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
      const offset = (page - 1) * limit;

      const {
        search,
        phone:         phoneSearch,
        status,
        service,
        renewalFilter = "all",
        dateSort      = "soonest",
      } = req.query;

      let whereClause = "WHERE 1=1";
      const queryParams = [];

      if (search) {
        whereClause += " AND r.client_name LIKE ?";
        queryParams.push(`%${search}%`);
      }
      if (phoneSearch) {
        whereClause += " AND (r.phone LIKE ? OR r.whatsapp_number LIKE ?)";
        queryParams.push(`%${phoneSearch}%`, `%${phoneSearch}%`);
      }
      if (status && status !== "all") {
        whereClause += " AND r.status = ?";
        queryParams.push(status);
      }
      if (service && service !== "all") {
        whereClause += " AND r.service = ?";
        queryParams.push(service);
      }
      if (renewalFilter !== "all") {
        if (renewalFilter === "expired") {
          whereClause += " AND r.renewal_date < CURDATE()";
        } else if (renewalFilter === "this-week") {
          whereClause += " AND r.renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)";
        } else if (renewalFilter === "this-month" || renewalFilter === "upcoming") {
          whereClause += " AND r.renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
        }
      }

      let orderClause;
      switch (dateSort) {
        case "latest":      orderClause = "r.renewal_date DESC";   break;
        case "amount-high": orderClause = "r.monthly_amount DESC"; break;
        case "amount-low":  orderClause = "r.monthly_amount ASC";  break;
        case "newest":      orderClause = "r.created_at DESC";     break;
        default:            orderClause = "r.renewal_date ASC";    break;
      }

      const [retainers] = await pool.execute(
        // FIX: added DATEDIFF for days_to_renewal (used by frontend for urgency colour)
        `SELECT
           r.*,
           u.name AS created_by_name,
           DATEDIFF(r.renewal_date, CURDATE()) AS days_to_renewal
         FROM retainers r
         LEFT JOIN users u ON r.created_by = u.id
         ${whereClause}
         ORDER BY ${orderClause}
         LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
        sanitizeParams(...queryParams)
      );

      const [countResult] = await pool.execute(
        `SELECT COUNT(*) AS total FROM retainers r ${whereClause}`,
        sanitizeParams(...queryParams)
      );

      const total      = countResult[0]?.total || 0;
      const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

      res.json({
        retainers,
        pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    } catch (error) {
      console.error("Retainers fetch error:", error);
      res.status(500).json({ error: "Failed to fetch retainers" });
    }
  }
);

// =============================================================================
// SOW §2.5 + §2.8: RETAINER STATS  — MUST be before /:id to avoid param clash
// =============================================================================

router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         COUNT(*)                                                                   AS totalRetainers,
         SUM(CASE WHEN status = 'active'   THEN 1 ELSE 0 END)                     AS activeCount,
         SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END)                     AS inactiveCount,
         SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END)                     AS expiredCount,
         -- SOW §2.6: MRR — sum of all active monthly amounts
         COALESCE(SUM(CASE WHEN status = 'active' THEN monthly_amount ELSE 0 END), 0) AS mrr,
         -- Renewal alerts
         SUM(CASE WHEN status = 'active'
                   AND renewal_date BETWEEN CURDATE()
                   AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
              THEN 1 ELSE 0 END)                                                   AS renewingAlert,
         SUM(CASE WHEN status = 'active'
                   AND renewal_date BETWEEN CURDATE()
                   AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
              THEN 1 ELSE 0 END)                                                   AS renewingWarn,
         SUM(CASE WHEN status = 'active' AND renewal_date < CURDATE()
              THEN 1 ELSE 0 END)                                                   AS overdueRenewals
       FROM retainers`,
      sanitizeParams(RENEWAL_ALERT_DAYS, RENEWAL_WARN_DAYS)
    );

    const [serviceBreakdown] = await pool.execute(
      `SELECT service, COUNT(*) AS count, SUM(monthly_amount) AS revenue
       FROM retainers WHERE status = 'active'
       GROUP BY service ORDER BY revenue DESC`
    );

    const [upcomingRenewals] = await pool.execute(
      `SELECT id, client_name, service, monthly_amount, renewal_date,
              DATEDIFF(renewal_date, CURDATE()) AS days_until_renewal
       FROM retainers
       WHERE status = 'active'
         AND renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY renewal_date ASC LIMIT 10`,
      sanitizeParams(RENEWAL_WARN_DAYS)
    );

    const [mrrTrend] = await pool.execute(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m') AS month,
         SUM(monthly_amount)              AS mrr,
         COUNT(*)                         AS newRetainers
       FROM retainers
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month ASC`
    );

    res.json({ stats: rows[0] || {}, serviceBreakdown, upcomingRenewals, mrrTrend });
  } catch (error) {
    console.error("Retainer stats error:", error);
    res.status(500).json({ error: "Failed to fetch retainer stats" });
  }
});

// =============================================================================
// SOW §2.8: EXPORT RETAINERS AS CSV
// =============================================================================

router.get("/export", authenticateToken, async (req, res) => {
  try {
    const { status, service } = req.query;

    let whereClause = "WHERE 1=1";
    const queryParams = [];

    if (status && status !== "all") {
      whereClause += " AND r.status = ?";
      queryParams.push(status);
    }
    if (service && service !== "all") {
      whereClause += " AND r.service = ?";
      queryParams.push(service);
    }

    const [retainers] = await pool.execute(
      `SELECT
         r.client_name      AS "Client Name",
         r.service          AS "Service",
         r.monthly_amount   AS "Monthly Amount (₹)",
         r.start_date       AS "Start Date",
         r.renewal_date     AS "Renewal Date",
         DATEDIFF(r.renewal_date, CURDATE()) AS "Days to Renewal",
         r.status           AS "Status",
         r.phone            AS "Phone",
         r.whatsapp_number  AS "WhatsApp",
         r.notes            AS "Notes",
         r.created_at       AS "Created At"
       FROM retainers r
       ${whereClause}
       ORDER BY r.renewal_date ASC`,
      sanitizeParams(...queryParams)
    );

    if (!retainers.length) {
      return res.status(404).json({ error: "No retainers found to export" });
    }

    // Build CSV
    const headers = Object.keys(retainers[0]);
    const csvRows = [
      headers.join(","),
      ...retainers.map((row) =>
        headers
          .map((h) => {
            const val = row[h] ?? "";
            const str = String(val).replace(/"/g, '""');
            return str.includes(",") || str.includes('"') || str.includes("\n")
              ? `"${str}"`
              : str;
          })
          .join(",")
      ),
    ];

    const csv = csvRows.join("\n");
    const filename = `retainers-export-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error("Retainer export error:", error);
    res.status(500).json({ error: "Failed to export retainers" });
  }
});

// =============================================================================
// SOW §2.5: GET RETAINER BY ID
// =============================================================================

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const [retainers] = await pool.execute(
      `SELECT
         r.*,
         u.name AS created_by_name,
         DATEDIFF(r.renewal_date, CURDATE()) AS days_to_renewal
       FROM retainers r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.id = ?`,
      sanitizeParams(req.params.id)
    );

    if (retainers.length === 0) {
      return res.status(404).json({ error: "Retainer not found" });
    }

    res.json({ retainer: retainers[0] });
  } catch (error) {
    console.error("Retainer fetch error:", error);
    res.status(500).json({ error: "Failed to fetch retainer" });
  }
});

// =============================================================================
// SOW §2.5: CREATE RETAINER
// =============================================================================

router.post(
  "/",
  authenticateToken,
  [
    body("clientName").trim().notEmpty().withMessage("Client name is required"),
    body("service").notEmpty().isIn(RETAINER_SERVICES).withMessage("Valid service is required"),
    body("monthlyAmount").notEmpty().isNumeric().withMessage("Monthly amount is required"),
    body("startDate").notEmpty().isISO8601().withMessage("Valid start date is required"),
    body("renewalDate").notEmpty().isISO8601().withMessage("Valid renewal date is required"),
    body("status").optional().isIn(RETAINER_STATUSES),
    body("customerId").optional().isString(),
    body("phone").optional().isString(),
    body("whatsappNumber").optional().isString(),
    body("notes").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const {
        clientName,
        service,
        monthlyAmount,
        startDate,
        renewalDate,
        status        = "active",
        customerId    = null,      // FIX: now stored
        phone         = null,
        whatsappNumber = null,     // FIX: no longer defaults to phone silently
        notes         = null,
      } = req.body;

      const safeAmount = Number(monthlyAmount);
      if (isNaN(safeAmount) || safeAmount < 0) {
        return res.status(400).json({ error: "Monthly amount must be a valid non-negative number" });
      }

      const safeStartDate   = safeDate(startDate);
      const safeRenewalDate = safeDate(renewalDate);
      if (!safeStartDate)   return res.status(400).json({ error: "Invalid start date" });
      if (!safeRenewalDate) return res.status(400).json({ error: "Invalid renewal date" });

      const retainerId = uuidv4();

      await pool.execute(
        `INSERT INTO retainers (
           id, client_name, customer_id, service, monthly_amount,
           start_date, renewal_date, status,
           phone, whatsapp_number, notes,
           created_by, created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )`,
        sanitizeParams(
          retainerId, clientName.trim(), customerId, service, safeAmount,
          safeStartDate, safeRenewalDate, status,
          phone, whatsappNumber, notes,
          req.user.id
        )
      );

      const [retainers] = await pool.execute(
        `SELECT r.*, u.name AS created_by_name,
                DATEDIFF(r.renewal_date, CURDATE()) AS days_to_renewal
         FROM retainers r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.id = ?`,
        sanitizeParams(retainerId)
      );

      res.status(201).json({ message: "Retainer created successfully", retainer: retainers[0] });
    } catch (error) {
      console.error("Retainer creation error:", error);
      res.status(500).json({ error: "Failed to create retainer" });
    }
  }
);

// =============================================================================
// SOW §2.5: UPDATE RETAINER (full update)
// =============================================================================

router.put(
  "/:id",
  authenticateToken,
  [
    body("clientName").optional().trim().notEmpty(),
    body("client_name").optional().trim().notEmpty(),
    body("service").optional().isIn(RETAINER_SERVICES),
    body("monthlyAmount").optional().isNumeric(),
    body("monthly_amount").optional().isNumeric(),
    body("startDate").optional().isISO8601(),
    body("start_date").optional().isISO8601(),
    body("renewalDate").optional().isISO8601(),
    body("renewal_date").optional().isISO8601(),
    body("status").optional().isIn(RETAINER_STATUSES),
    body("customerId").optional().isString(),
    body("phone").optional().isString(),
    body("whatsappNumber").optional().isString(),
    body("whatsapp_number").optional().isString(),
    body("notes").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const [existing] = await pool.execute(
        "SELECT id FROM retainers WHERE id = ?",
        sanitizeParams(req.params.id)
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Retainer not found" });
      }

      const updateData = { ...req.body };

      // Normalise camelCase → snake_case
      const aliases = [
        ["clientName",    "client_name"],
        ["monthlyAmount", "monthly_amount"],
        ["startDate",     "start_date"],
        ["renewalDate",   "renewal_date"],
        ["whatsappNumber","whatsapp_number"],
        ["customerId",    "customer_id"],
      ];
      for (const [camel, snake] of aliases) {
        if (updateData[camel] !== undefined && updateData[snake] === undefined) {
          updateData[snake] = updateData[camel];
        }
        delete updateData[camel];
      }

      if (updateData.start_date)   updateData.start_date   = safeDate(updateData.start_date);
      if (updateData.renewal_date) updateData.renewal_date = safeDate(updateData.renewal_date);

      if (updateData.monthly_amount !== undefined) {
        const n = Number(updateData.monthly_amount);
        if (isNaN(n) || n < 0) {
          return res.status(400).json({ error: "Monthly amount must be a valid non-negative number" });
        }
        updateData.monthly_amount = n;
      }

      // Auto-activate when renewal date is pushed forward
      if (updateData.renewal_date) {
        const renewalDate = new Date(updateData.renewal_date);
        if (!isNaN(renewalDate.getTime()) && renewalDate > new Date()) {
          if (updateData.status !== "inactive") {
            updateData.status = "active";
          }
        }
      }

      const updateFields = [];
      const updateValues = [];
      const seenDbFields = new Set();

      for (const [key, value] of Object.entries(updateData)) {
        if (value === undefined) continue;
        const dbField = retainerFieldMap[key];
        if (!dbField || seenDbFields.has(dbField)) continue;
        seenDbFields.add(dbField);
        updateFields.push(`${dbField} = ?`);
        updateValues.push(value === "" ? null : value);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      updateValues.push(req.params.id);
      await pool.execute(
        `UPDATE retainers SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitizeParams(...updateValues)
      );

      const [retainers] = await pool.execute(
        `SELECT r.*, u.name AS created_by_name,
                DATEDIFF(r.renewal_date, CURDATE()) AS days_to_renewal
         FROM retainers r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.id = ?`,
        sanitizeParams(req.params.id)
      );

      res.json({ message: "Retainer updated successfully", retainer: retainers[0] });
    } catch (error) {
      console.error("Retainer update error:", error);
      res.status(500).json({ error: "Failed to update retainer" });
    }
  }
);

// =============================================================================
// SOW §2.5: PATCH RETAINER — quick partial update (status-only, amount-only)
// =============================================================================

router.patch(
  "/:id",
  authenticateToken,
  [
    body("status").optional().isIn(RETAINER_STATUSES),
    body("monthlyAmount").optional().isNumeric(),
    body("monthly_amount").optional().isNumeric(),
    body("renewalDate").optional().isISO8601(),
    body("renewal_date").optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const [existing] = await pool.execute(
        "SELECT id FROM retainers WHERE id = ?",
        sanitizeParams(req.params.id)
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Retainer not found" });
      }

      const setClauses = [];
      const values     = [];

      if (req.body.status !== undefined) {
        setClauses.push("status = ?");
        values.push(req.body.status);
      }

      const rDate = req.body.renewalDate || req.body.renewal_date;
      if (rDate !== undefined) {
        const safe = safeDate(rDate);
        if (!safe) return res.status(400).json({ error: "Invalid renewal date" });
        setClauses.push("renewal_date = ?");
        values.push(safe);
        // Auto-activate on renewal date extension
        if (!req.body.status && new Date(safe) > new Date()) {
          setClauses.push("status = ?");
          values.push("active");
        }
      }

      const amt = req.body.monthlyAmount ?? req.body.monthly_amount;
      if (amt !== undefined) {
        const n = Number(amt);
        if (isNaN(n) || n < 0) {
          return res.status(400).json({ error: "Monthly amount must be valid" });
        }
        setClauses.push("monthly_amount = ?");
        values.push(n);
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      values.push(req.params.id);
      await pool.execute(
        `UPDATE retainers SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitizeParams(...values)
      );

      const [retainers] = await pool.execute(
        `SELECT r.*, u.name AS created_by_name,
                DATEDIFF(r.renewal_date, CURDATE()) AS days_to_renewal
         FROM retainers r LEFT JOIN users u ON r.created_by = u.id
         WHERE r.id = ?`,
        sanitizeParams(req.params.id)
      );

      res.json({ message: "Retainer updated successfully", retainer: retainers[0] });
    } catch (error) {
      console.error("Retainer patch error:", error);
      res.status(500).json({ error: "Failed to update retainer" });
    }
  }
);

// =============================================================================
// SOW §2.5: RENEW RETAINER — sets new date + forces status = active
// =============================================================================

router.post(
  "/:id/renew",
  authenticateToken,
  [
    body("renewalDate").notEmpty().isISO8601().withMessage("Valid renewal date is required"),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const [existing] = await pool.execute(
        "SELECT id, client_name FROM retainers WHERE id = ?",
        sanitizeParams(req.params.id)
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Retainer not found" });
      }

      const safeRenewalDate = safeDate(req.body.renewalDate);
      if (!safeRenewalDate) {
        return res.status(400).json({ error: "Invalid renewal date" });
      }

      await pool.execute(
        `UPDATE retainers
         SET renewal_date = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        sanitizeParams(safeRenewalDate, req.params.id)
      );

      const [retainers] = await pool.execute(
        `SELECT r.*, u.name AS created_by_name,
                DATEDIFF(r.renewal_date, CURDATE()) AS days_to_renewal
         FROM retainers r LEFT JOIN users u ON r.created_by = u.id
         WHERE r.id = ?`,
        sanitizeParams(req.params.id)
      );

      res.json({ message: "Retainer renewed successfully", retainer: retainers[0] });
    } catch (error) {
      console.error("Retainer renewal error:", error);
      res.status(500).json({ error: "Failed to renew retainer" });
    }
  }
);

// =============================================================================
// SOW §2.5: DELETE RETAINER
// =============================================================================

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const [existing] = await pool.execute(
      "SELECT id FROM retainers WHERE id = ?",
      sanitizeParams(req.params.id)
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Retainer not found" });
    }

    await pool.execute("DELETE FROM retainers WHERE id = ?", sanitizeParams(req.params.id));
    res.json({ message: "Retainer deleted successfully" });
  } catch (error) {
    console.error("Retainer deletion error:", error);
    res.status(500).json({ error: "Failed to delete retainer" });
  }
});

// =============================================================================
// SOW §2.6: MONTHLY RETAINER TRACKING — GET all payments for a retainer
// =============================================================================

router.get("/:id/payments", authenticateToken, async (req, res) => {
  try {
    const { month } = req.query; // optional ?month=2026-05

    const [retainer] = await pool.execute(
      "SELECT id, client_name, service, monthly_amount FROM retainers WHERE id = ?",
      sanitizeParams(req.params.id)
    );
    if (retainer.length === 0) {
      return res.status(404).json({ error: "Retainer not found" });
    }

    let sql = `
      SELECT
        rp.*,
        r.client_name,
        r.service,
        r.monthly_amount AS retainer_monthly_amount
      FROM retainer_payments rp
      JOIN retainers r ON r.id = rp.retainer_id
      WHERE rp.retainer_id = ?
    `;
    const params = [req.params.id];

    if (month) {
      // Accept "2026-05" or "2026-05-01"
      const monthStart = month.length === 7 ? `${month}-01` : month;
      sql += " AND rp.payment_month = ?";
      params.push(monthStart);
    }

    sql += " ORDER BY rp.payment_month DESC";

    const [payments] = await pool.execute(sql, sanitizeParams(...params));

    res.json({ retainer: retainer[0], payments });
  } catch (error) {
    console.error("Retainer payments fetch error:", error);
    res.status(500).json({ error: "Failed to fetch retainer payments" });
  }
});

// =============================================================================
// SOW §2.6: CREATE MONTHLY PAYMENT RECORD
// =============================================================================

router.post(
  "/:id/payments",
  authenticateToken,
  [
    body("paymentMonth").notEmpty().withMessage("Payment month is required (YYYY-MM or YYYY-MM-DD)"),
    body("expectedAmount").optional().isNumeric(),
    body("receivedAmount").optional().isNumeric(),
    body("paymentStatus").optional().isIn(PAYMENT_STATUSES),
    body("paymentDate").optional().isISO8601(),
    body("paymentMode").optional().isIn(PAYMENT_MODES),
    body("remarks").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const [retainer] = await pool.execute(
        "SELECT id, monthly_amount FROM retainers WHERE id = ?",
        sanitizeParams(req.params.id)
      );
      if (retainer.length === 0) {
        return res.status(404).json({ error: "Retainer not found" });
      }

      const {
        paymentMonth,
        expectedAmount,
        receivedAmount = 0,
        paymentStatus  = "pending",
        paymentDate    = null,
        paymentMode    = null,
        remarks        = null,
      } = req.body;

      // Normalise month → first day of month
      let monthStart = paymentMonth;
      if (paymentMonth.length === 7) monthStart = `${paymentMonth}-01`;
      const safeMonth = safeDate(monthStart);
      if (!safeMonth) return res.status(400).json({ error: "Invalid payment month" });

      // Use retainer's monthly_amount as expected if not provided
      const safeExpected = expectedAmount !== undefined
        ? Number(expectedAmount)
        : Number(retainer[0].monthly_amount);
      const safeReceived = Number(receivedAmount);

      const paymentId = uuidv4();

      await pool.execute(
        `INSERT INTO retainer_payments (
           id, retainer_id, payment_month,
           expected_amount, received_amount, payment_status,
           payment_date, payment_mode, remarks,
           recorded_by, created_at, updated_at
         ) VALUES (
           ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON DUPLICATE KEY UPDATE
           expected_amount = VALUES(expected_amount),
           received_amount = VALUES(received_amount),
           payment_status  = VALUES(payment_status),
           payment_date    = VALUES(payment_date),
           payment_mode    = VALUES(payment_mode),
           remarks         = VALUES(remarks),
           recorded_by     = VALUES(recorded_by),
           updated_at      = CURRENT_TIMESTAMP`,
        sanitizeParams(
          paymentId, req.params.id, safeMonth,
          safeExpected, safeReceived, paymentStatus,
          safeDate(paymentDate), paymentMode, remarks,
          req.user.id
        )
      );

      const [payments] = await pool.execute(
        "SELECT * FROM retainer_payments WHERE retainer_id = ? AND payment_month = ?",
        sanitizeParams(req.params.id, safeMonth)
      );

      res.status(201).json({ message: "Payment record saved", payment: payments[0] });
    } catch (error) {
      console.error("Retainer payment create error:", error);
      res.status(500).json({ error: "Failed to save payment record" });
    }
  }
);

// =============================================================================
// SOW §2.6: UPDATE MONTHLY PAYMENT RECORD (mark Paid, update received amount)
// =============================================================================

router.put(
  "/:id/payments/:paymentId",
  authenticateToken,
  [
    body("receivedAmount").optional().isNumeric(),
    body("paymentStatus").optional().isIn(PAYMENT_STATUSES),
    body("paymentDate").optional().isISO8601(),
    body("paymentMode").optional().isIn(PAYMENT_MODES),
    body("remarks").optional().isString(),
    body("expectedAmount").optional().isNumeric(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const [existing] = await pool.execute(
        "SELECT id FROM retainer_payments WHERE id = ? AND retainer_id = ?",
        sanitizeParams(req.params.paymentId, req.params.id)
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Payment record not found" });
      }

      const setClauses = [];
      const values     = [];

      const fieldMap = {
        receivedAmount: "received_amount",
        paymentStatus:  "payment_status",
        paymentMode:    "payment_mode",
        remarks:        "remarks",
        expectedAmount: "expected_amount",
      };

      for (const [camel, snake] of Object.entries(fieldMap)) {
        if (req.body[camel] !== undefined) {
          setClauses.push(`${snake} = ?`);
          const val = ["receivedAmount", "expectedAmount"].includes(camel)
            ? Number(req.body[camel])
            : req.body[camel];
          values.push(val);
        }
      }

      if (req.body.paymentDate !== undefined) {
        setClauses.push("payment_date = ?");
        values.push(safeDate(req.body.paymentDate));
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      values.push(req.params.paymentId);
      await pool.execute(
        `UPDATE retainer_payments
         SET ${setClauses.join(", ")}, recorded_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        sanitizeParams(req.user.id, ...values)
      );

      const [payments] = await pool.execute(
        "SELECT * FROM retainer_payments WHERE id = ?",
        sanitizeParams(req.params.paymentId)
      );

      res.json({ message: "Payment updated successfully", payment: payments[0] });
    } catch (error) {
      console.error("Retainer payment update error:", error);
      res.status(500).json({ error: "Failed to update payment record" });
    }
  }
);

// =============================================================================
// SOW §2.6: MONTHLY SUMMARY — all retainers for a given month
// Used by the Monthly Retainer Tracking screen
// =============================================================================

router.get("/payments/summary", authenticateToken, async (req, res) => {
  try {
    const { month } = req.query; // e.g. "2026-05"

    let monthStart;
    if (month) {
      monthStart = month.length === 7 ? `${month}-01` : month;
    } else {
      // Default to current month
      const now = new Date();
      monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const safeMonth = safeDate(monthStart);
    if (!safeMonth) return res.status(400).json({ error: "Invalid month" });

    // Get all active retainers with their payment record for this month (if any)
    const [rows] = await pool.execute(
      `SELECT
         r.id              AS retainer_id,
         r.client_name,
         r.service,
         r.monthly_amount  AS expected_amount,
         r.phone,
         r.whatsapp_number,
         r.status          AS retainer_status,
         rp.id             AS payment_id,
         rp.payment_month,
         rp.received_amount,
         rp.payment_status,
         rp.payment_date,
         rp.payment_mode,
         rp.remarks
       FROM retainers r
       LEFT JOIN retainer_payments rp
         ON rp.retainer_id = r.id AND rp.payment_month = ?
       WHERE r.status = 'active'
       ORDER BY r.client_name ASC`,
      sanitizeParams(safeMonth)
    );

    // Aggregate totals
    const totalExpected = rows.reduce((s, r) => s + Number(r.expected_amount || 0), 0);
    const totalReceived = rows.reduce((s, r) => s + Number(r.received_amount || 0), 0);
    const paidCount     = rows.filter((r) => r.payment_status === "paid").length;
    const pendingCount  = rows.filter((r) => !r.payment_status || r.payment_status === "pending").length;

    res.json({
      month: safeMonth,
      summary: { totalExpected, totalReceived, paidCount, pendingCount, total: rows.length },
      retainers: rows,
    });
  } catch (error) {
    console.error("Monthly summary error:", error);
    res.status(500).json({ error: "Failed to fetch monthly summary" });
  }
});

// =============================================================================
// SOW §2.8: EXPORT MONTHLY RETAINER TRACKING AS CSV
// =============================================================================

router.get("/payments/export", authenticateToken, async (req, res) => {
  try {
    const { month } = req.query;

    let monthStart;
    if (month) {
      monthStart = month.length === 7 ? `${month}-01` : month;
    } else {
      const now = new Date();
      monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const safeMonth = safeDate(monthStart);
    if (!safeMonth) return res.status(400).json({ error: "Invalid month" });

    const [rows] = await pool.execute(
      `SELECT
         r.client_name        AS "Client Name",
         r.service            AS "Service",
         r.monthly_amount     AS "Expected Amount (₹)",
         COALESCE(rp.received_amount, 0) AS "Received Amount (₹)",
         COALESCE(rp.payment_status, 'pending') AS "Payment Status",
         rp.payment_date      AS "Payment Date",
         rp.payment_mode      AS "Payment Mode",
         rp.remarks           AS "Remarks"
       FROM retainers r
       LEFT JOIN retainer_payments rp
         ON rp.retainer_id = r.id AND rp.payment_month = ?
       WHERE r.status = 'active'
       ORDER BY r.client_name ASC`,
      sanitizeParams(safeMonth)
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No records found for this month" });
    }

    const headers  = Object.keys(rows[0]);
    const csvRows  = [
      headers.join(","),
      ...rows.map((row) =>
        headers.map((h) => {
          const val = row[h] ?? "";
          const str = String(val).replace(/"/g, '""');
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str}"` : str;
        }).join(",")
      ),
    ];

    const filename = `retainer-tracking-${safeMonth}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvRows.join("\n"));
  } catch (error) {
    console.error("Payment export error:", error);
    res.status(500).json({ error: "Failed to export payment tracking" });
  }
});

module.exports = router;