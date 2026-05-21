// // routes/whatsapp.js
// // SOW §4.2 — Configurable alert numbers + campaign/message management

// const express = require("express");
// const { body, validationResult, query } = require("express-validator");
// const { pool } = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");

// const router = express.Router();

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({ error: "Validation failed", details: errors.array() });
//     return true;
//   }
//   return false;
// };

// const parseJsonArray = (value) => {
//   if (!value) return [];
//   try { return JSON.parse(value); } catch { return []; }
// };

// // ─── SOW §4.2: Alert Config (stored in whatsapp_alert_config table) ──────────
// // GET  /api/whatsapp/alert-config  — fetch current alert numbers + toggle
// // PUT  /api/whatsapp/alert-config  — update alert numbers + toggle

// router.get("/alert-config", authenticateToken, async (req, res) => {
//   try {
//     // Try to fetch from DB first (persistent config)
//     const [rows] = await pool.execute(
//       `SELECT * FROM whatsapp_alert_config ORDER BY updated_at DESC LIMIT 1`
//     ).catch(() => [[]]);

//     if (rows && rows.length > 0) {
//       return res.json({
//         alertNumbers: parseJsonArray(rows[0].alert_numbers),
//         alertsEnabled: !!rows[0].alerts_enabled,
//         updatedAt: rows[0].updated_at,
//       });
//     }

//     // Fallback to env variable if table doesn't exist yet
//     const envNumbers = (process.env.ALERT_NUMBERS || process.env.ADMIN_PHONE_NUMBER || "")
//       .split(",").map((n) => n.trim()).filter(Boolean);

//     res.json({
//       alertNumbers:  envNumbers,
//       alertsEnabled: true,
//       updatedAt:     null,
//       note:          "Using environment variable. Create whatsapp_alert_config table to persist settings.",
//     });
//   } catch (err) {
//     console.error("Alert config fetch error:", err);
//     res.status(500).json({ error: "Failed to fetch alert config" });
//   }
// });

// router.put(
//   "/alert-config",
//   authenticateToken,
//   [
//     body("alertNumbers").isArray({ min: 1 }).withMessage("At least one alert number is required"),
//     body("alertNumbers.*").isString().matches(/^\d{10,15}$/).withMessage("Each number must be 10-15 digits"),
//     body("alertsEnabled").optional().isBoolean(),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { alertNumbers, alertsEnabled = true } = req.body;

//       // Upsert into config table
//       await pool.execute(
//         `INSERT INTO whatsapp_alert_config (alert_numbers, alerts_enabled, updated_at)
//          VALUES (?, ?, CURRENT_TIMESTAMP)
//          ON DUPLICATE KEY UPDATE
//            alert_numbers  = VALUES(alert_numbers),
//            alerts_enabled = VALUES(alerts_enabled),
//            updated_at     = CURRENT_TIMESTAMP`,
//         [JSON.stringify(alertNumbers), alertsEnabled ? 1 : 0]
//       ).catch(async () => {
//         // Table doesn't exist — create it and retry
//         await pool.execute(`
//           CREATE TABLE IF NOT EXISTS whatsapp_alert_config (
//             id             INT AUTO_INCREMENT PRIMARY KEY,
//             alert_numbers  JSON         NOT NULL,
//             alerts_enabled TINYINT(1)   NOT NULL DEFAULT 1,
//             updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
//           ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
//         `);
//         await pool.execute(
//           `INSERT INTO whatsapp_alert_config (alert_numbers, alerts_enabled) VALUES (?, ?)`,
//           [JSON.stringify(alertNumbers), alertsEnabled ? 1 : 0]
//         );
//       });

//       res.json({
//         message:       "Alert configuration saved successfully",
//         alertNumbers,
//         alertsEnabled,
//       });
//     } catch (err) {
//       console.error("Alert config update error:", err);
//       res.status(500).json({ error: "Failed to update alert config" });
//     }
//   }
// );

// // ─── SOW §4.2: Test Alert — send a sample alert to configured numbers ─────────

// router.post("/test-alert", authenticateToken, async (req, res) => {
//   try {
//     // Dynamically require sendWhatsAppMessage to avoid circular deps
//     const sampleAlert =
//       `🔔 *Test Alert — Renalease CRM*\n\n` +
//       `✅ WhatsApp lead alerts are configured correctly.\n\n` +
//       `👤 *Patient:* Test Patient\n` +
//       `📞 *Mobile:* 919999999999\n` +
//       `📡 *Source:* WhatsApp\n` +
//       `🏥 *Service:* Home Haemodialysis\n` +
//       `📋 *Status:* Qualified Lead\n` +
//       `💬 *Message:* This is a test notification.`;

//     const [rows] = await pool.execute(
//       `SELECT alert_numbers, alerts_enabled FROM whatsapp_alert_config ORDER BY updated_at DESC LIMIT 1`
//     ).catch(() => [[]]);

//     let alertNumbers = (process.env.ALERT_NUMBERS || process.env.ADMIN_PHONE_NUMBER || "")
//       .split(",").map((n) => n.trim()).filter(Boolean);

//     if (rows && rows.length > 0) {
//       alertNumbers = parseJsonArray(rows[0].alert_numbers);
//     }

//     if (!alertNumbers.length) {
//       return res.status(400).json({ error: "No alert numbers configured. Add numbers in WhatsApp Settings first." });
//     }

//     res.json({
//       message:      `Test alert queued for ${alertNumbers.length} number(s)`,
//       alertNumbers,
//       note:         "Check your WhatsApp for the test message.",
//     });

//     // Fire after response is sent
//     const axios = require("axios");
//     const WHATSAPP_API_TOKEN       = process.env.WHATSAPP_API_TOKEN;
//     const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

//     if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
//       console.warn("[WA] Test alert skipped — credentials missing");
//       return;
//     }

//     await Promise.allSettled(
//       alertNumbers.map((num) =>
//         axios.post(
//           "https://api.aoc-portal.com/v1/whatsapp",
//           {
//             recipient_type: "individual",
//             from:            WHATSAPP_PHONE_NUMBER_ID,
//             to:              num,
//             type:            "text",
//             text:            { body: sampleAlert },
//           },
//           { headers: { apikey: WHATSAPP_API_TOKEN }, timeout: 8000 }
//         ).catch((e) => console.error(`[WA] Test to ${num} failed:`, e.message))
//       )
//     );

//   } catch (err) {
//     console.error("Test alert error:", err);
//     res.status(500).json({ error: "Failed to send test alert" });
//   }
// });

// // ─── WhatsApp Lead Stats (for dashboard) ─────────────────────────────────────

// router.get("/lead-stats", authenticateToken, async (req, res) => {
//   try {
//     const [stats] = await pool.execute(`
//       SELECT
//         COUNT(*)                                                          AS total_whatsapp_leads,
//         SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END)   AS today,
//         SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last_7_days,
//         SUM(CASE WHEN status = 'qualified-lead'  THEN 1 ELSE 0 END)     AS qualified,
//         SUM(CASE WHEN status = 'installation'    THEN 1 ELSE 0 END)     AS converted,
//         SUM(CASE WHEN service IS NOT NULL        THEN 1 ELSE 0 END)     AS with_service_detected
//       FROM leads
//       WHERE source = 'whatsapp'
//     `);

//     const [serviceBreakdown] = await pool.execute(`
//       SELECT service, COUNT(*) AS count
//       FROM leads
//       WHERE source = 'whatsapp' AND service IS NOT NULL
//       GROUP BY service
//       ORDER BY count DESC
//     `);

//     const [dailyTrend] = await pool.execute(`
//       SELECT DATE(created_at) AS date, COUNT(*) AS count
//       FROM leads
//       WHERE source = 'whatsapp'
//         AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
//       GROUP BY DATE(created_at)
//       ORDER BY date ASC
//     `);

//     res.json({
//       summary:          stats[0] || {},
//       serviceBreakdown,
//       dailyTrend,
//     });
//   } catch (err) {
//     console.error("WhatsApp lead stats error:", err);
//     res.status(500).json({ error: "Failed to fetch WhatsApp lead stats" });
//   }
// });

// // ─── Campaigns ────────────────────────────────────────────────────────────────

// router.get(
//   "/campaigns",
//   authenticateToken,
//   [
//     query("page").optional().isInt({ min: 1 }),
//     query("limit").optional().isInt({ min: 1, max: 100 }),
//     query("status").optional().isIn(["draft", "active", "paused", "completed"]),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
//       const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
//       const offset = (page - 1) * limit;

//       const { status } = req.query;
//       let where = "WHERE 1=1";
//       const params = [];
//       if (status) { where += " AND status = ?"; params.push(status); }

//       const [campaigns] = await pool.execute(
//         `SELECT * FROM whatsapp_campaigns ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
//         params
//       );

//       const [[{ total }]] = await pool.execute(
//         `SELECT COUNT(*) AS total FROM whatsapp_campaigns ${where}`,
//         params
//       );

//       res.json({
//         campaigns: campaigns.map((c) => ({ ...c, target_audience: parseJsonArray(c.target_audience) })),
//         pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasNext: page * limit < total, hasPrev: page > 1 },
//       });
//     } catch (err) {
//       console.error("Campaigns fetch error:", err);
//       res.status(500).json({ error: "Failed to fetch campaigns" });
//     }
//   }
// );

// router.post(
//   "/campaigns",
//   authenticateToken,
//   [
//     body("name").trim().notEmpty().withMessage("Campaign name is required"),
//     body("template").trim().notEmpty().withMessage("Message template is required"),
//     body("targetAudience").isArray().withMessage("Target audience must be an array"),
//     body("scheduledAt").optional().isISO8601(),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;
//       const { name, template, targetAudience, scheduledAt } = req.body;

//       const [result] = await pool.execute(
//         `INSERT INTO whatsapp_campaigns (name, template, target_audience, scheduled_at) VALUES (?, ?, ?, ?)`,
//         [name, template, JSON.stringify(targetAudience), scheduledAt || null]
//       );

//       const [[campaign]] = await pool.execute(
//         "SELECT * FROM whatsapp_campaigns WHERE id = ?",
//         [result.insertId]
//       );
//       campaign.target_audience = parseJsonArray(campaign.target_audience);

//       res.status(201).json({ message: "Campaign created successfully", campaign });
//     } catch (err) {
//       console.error("Campaign creation error:", err);
//       res.status(500).json({ error: "Failed to create campaign" });
//     }
//   }
// );

// router.put(
//   "/campaigns/:id/status",
//   authenticateToken,
//   [body("status").isIn(["draft", "active", "paused", "completed"])],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;
//       await pool.execute(
//         "UPDATE whatsapp_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
//         [req.body.status, req.params.id]
//       );
//       res.json({ message: "Campaign status updated" });
//     } catch (err) {
//       res.status(500).json({ error: "Failed to update campaign status" });
//     }
//   }
// );

// // ─── Send Message ─────────────────────────────────────────────────────────────

// router.post(
//   "/send-message",
//   authenticateToken,
//   [
//     body("phoneNumber").notEmpty().withMessage("Phone number is required"),
//     body("message").trim().notEmpty().withMessage("Message is required"),
//     body("customerId").optional().isString(),
//     body("campaignId").optional().isString(),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;
//       const { phoneNumber, message, customerId, campaignId } = req.body;

//       const [result] = await pool.execute(
//         `INSERT INTO whatsapp_messages (campaign_id, customer_id, phone_number, message, status, sent_at)
//          VALUES (?, ?, ?, ?, 'sent', NOW())`,
//         [campaignId || null, customerId || null, phoneNumber, message]
//       );

//       console.log(`[WA] Sending message to ${phoneNumber}: ${message}`);

//       // Update to delivered after 1s (placeholder — replace with real webhook callback)
//       setTimeout(async () => {
//         await pool.execute(
//           "UPDATE whatsapp_messages SET status = 'delivered', delivered_at = NOW() WHERE id = ?",
//           [result.insertId]
//         ).catch(() => {});
//       }, 1000);

//       res.json({ message: "WhatsApp message sent successfully", messageId: result.insertId });
//     } catch (err) {
//       console.error("Message send error:", err);
//       res.status(500).json({ error: "Failed to send message" });
//     }
//   }
// );

// // ─── Message History ──────────────────────────────────────────────────────────

// router.get(
//   "/messages",
//   authenticateToken,
//   [
//     query("customerId").optional().isString(),
//     query("campaignId").optional().isString(),
//     query("status").optional().isIn(["pending", "sent", "delivered", "read", "failed"]),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;
//       const { customerId, campaignId, status } = req.query;

//       let where = "WHERE 1=1";
//       const params = [];
//       if (customerId) { where += " AND wm.customer_id = ?"; params.push(customerId); }
//       if (campaignId) { where += " AND wm.campaign_id = ?"; params.push(campaignId); }
//       if (status)     { where += " AND wm.status = ?";      params.push(status);     }

//       const [messages] = await pool.execute(
//         `SELECT wm.*, c.name AS customer_name, wc.name AS campaign_name
//          FROM whatsapp_messages wm
//          LEFT JOIN customers c ON wm.customer_id = c.id
//          LEFT JOIN whatsapp_campaigns wc ON wm.campaign_id = wc.id
//          ${where}
//          ORDER BY wm.created_at DESC LIMIT 100`,
//         params
//       );

//       res.json({ messages });
//     } catch (err) {
//       console.error("Messages fetch error:", err);
//       res.status(500).json({ error: "Failed to fetch messages" });
//     }
//   }
// );

// // ─── Overall Stats ────────────────────────────────────────────────────────────

// router.get("/stats", authenticateToken, async (req, res) => {
//   try {
//     const [campaignStats] = await pool.execute(
//       `SELECT status, COUNT(*) AS count FROM whatsapp_campaigns GROUP BY status`
//     );
//     const [messageStats] = await pool.execute(
//       `SELECT status, COUNT(*) AS count FROM whatsapp_messages
//        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY status`
//     );
//     const [dailyStats] = await pool.execute(
//       `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM whatsapp_messages
//        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
//        GROUP BY DATE(created_at) ORDER BY date`
//     );

//     res.json({ campaignBreakdown: campaignStats, messageBreakdown: messageStats, dailyActivity: dailyStats });
//   } catch (err) {
//     console.error("Stats fetch error:", err);
//     res.status(500).json({ error: "Failed to fetch stats" });
//   }
// });

// // ─── Renewal Reminders ────────────────────────────────────────────────────────

// router.post("/send-renewal-reminders", authenticateToken, async (req, res) => {
//   try {
//     const [reminders] = await pool.execute(`
//       SELECT rr.*, c.name AS customer_name, c.whatsapp_number AS customer_whatsapp
//       FROM renewal_reminders rr
//       LEFT JOIN customers c ON rr.customer_id = c.id
//       WHERE rr.status = 'active' AND c.whatsapp_number IS NOT NULL AND c.whatsapp_number != ''
//     `);

//     let sentCount = 0;
//     const today    = new Date();
//     const todayStr = today.toISOString().split("T")[0];

//     for (const reminder of reminders) {
//       const reminderDays     = parseJsonArray(reminder.reminder_days);
//       const expiryDate       = new Date(reminder.expiry_date);
//       const daysUntilExpiry  = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

//       if (!reminderDays.includes(daysUntilExpiry)) continue;

//       const lastSent = reminder.last_reminder_sent
//         ? new Date(reminder.last_reminder_sent).toISOString().split("T")[0]
//         : null;
//       if (lastSent === todayStr) continue;

//       let msg = reminder.whatsapp_template ||
//         "Hi {customerName}, your {serviceName} expires on {expiryDate}. Please renew to continue your service.";
//       msg = msg
//         .replace("{customerName}", reminder.customer_name)
//         .replace("{serviceName}",  reminder.service_name)
//         .replace("{expiryDate}",   expiryDate.toLocaleDateString("en-IN"));

//       await pool.execute(
//         `INSERT INTO whatsapp_messages (customer_id, phone_number, message, status, sent_at) VALUES (?, ?, ?, 'sent', NOW())`,
//         [reminder.customer_id, reminder.customer_whatsapp, msg]
//       );

//       await pool.execute(
//         "UPDATE renewal_reminders SET last_reminder_sent = CURDATE() WHERE id = ?",
//         [reminder.id]
//       );

//       sentCount++;
//     }

//     res.json({ message: `Sent ${sentCount} renewal reminders`, sentCount });
//   } catch (err) {
//     console.error("Renewal reminders error:", err);
//     res.status(500).json({ error: "Failed to send renewal reminders" });
//   }
// });

// module.exports = router;


//testing



// routes/whatsapp.js
// SOW §4.2 — Configurable alert numbers + campaign/message management
//
// FIX LOG:
//  [F8]  Alert config GET/PUT also updates process.env so webhook picks up changes
//        immediately without a server restart
//  [F13] test-alert uses services/whatsapp sendText (no duplicate axios logic)
//  [F14] Auto-creates whatsapp_alert_config table inline via ensureAlertConfigTable()
//  [F15] Pagination totalPages is always at least 1

"use strict";

const express                           = require("express");
const { body, validationResult, query } = require("express-validator");
const { pool }                          = require("../config/database");
const { authenticateToken }             = require("../middleware/auth");
const { sendText }                      = require("../services/whatsapp"); // [F13]

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

const parseJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return []; }
};

// [F14] Ensure the alert config table exists before any read/write
async function ensureAlertConfigTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_alert_config (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      alert_numbers  JSON         NOT NULL,
      alerts_enabled TINYINT(1)   NOT NULL DEFAULT 1,
      updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// ─── SOW §4.2: Alert Config ───────────────────────────────────────────────────

router.get("/alert-config", authenticateToken, async (req, res) => {
  try {
    await ensureAlertConfigTable();

    const [rows] = await pool.execute(
      `SELECT * FROM whatsapp_alert_config ORDER BY updated_at DESC LIMIT 1`
    );

    if (rows && rows.length > 0) {
      return res.json({
        alertNumbers:  parseJsonArray(rows[0].alert_numbers),
        alertsEnabled: !!rows[0].alerts_enabled,
        updatedAt:     rows[0].updated_at,
      });
    }

    const envNumbers = (
      process.env.ALERT_NUMBERS || process.env.ADMIN_PHONE_NUMBER || ""
    )
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    res.json({
      alertNumbers:  envNumbers,
      alertsEnabled: true,
      updatedAt:     null,
      note:          "Using environment variable. Save via PUT to persist.",
    });
  } catch (err) {
    console.error("Alert config fetch error:", err);
    res.status(500).json({ error: "Failed to fetch alert config" });
  }
});

router.put(
  "/alert-config",
  authenticateToken,
  [
    body("alertNumbers")
      .isArray({ min: 1 })
      .withMessage("At least one alert number is required"),
    body("alertNumbers.*")
      .isString()
      .matches(/^\d{10,15}$/)
      .withMessage("Each number must be 10–15 digits"),
    body("alertsEnabled").optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { alertNumbers, alertsEnabled = true } = req.body;

      await ensureAlertConfigTable();

      await pool.execute(
        `INSERT INTO whatsapp_alert_config (alert_numbers, alerts_enabled, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           alert_numbers  = VALUES(alert_numbers),
           alerts_enabled = VALUES(alerts_enabled),
           updated_at     = CURRENT_TIMESTAMP`,
        [JSON.stringify(alertNumbers), alertsEnabled ? 1 : 0]
      );

      // [F8] Sync env so webhook picks up immediately without restart
      process.env.ALERT_NUMBERS = alertNumbers.join(",");

      res.json({
        message:       "Alert configuration saved successfully",
        alertNumbers,
        alertsEnabled,
      });
    } catch (err) {
      console.error("Alert config update error:", err);
      res.status(500).json({ error: "Failed to update alert config" });
    }
  }
);

// ─── SOW §4.2: Test Alert ─────────────────────────────────────────────────────

router.post("/test-alert", authenticateToken, async (req, res) => {
  try {
    await ensureAlertConfigTable();

    const [rows] = await pool.execute(
      `SELECT alert_numbers, alerts_enabled
       FROM whatsapp_alert_config
       ORDER BY updated_at DESC LIMIT 1`
    );

    let alertNumbers = (
      process.env.ALERT_NUMBERS || process.env.ADMIN_PHONE_NUMBER || ""
    )
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    if (rows && rows.length > 0) {
      const dbNums = parseJsonArray(rows[0].alert_numbers);
      if (dbNums.length) alertNumbers = dbNums;
    }

    if (!alertNumbers.length) {
      return res.status(400).json({
        error: "No alert numbers configured. Add numbers in WhatsApp Settings first.",
      });
    }

    const sampleAlert =
      `🔔 *Test Alert — Renalease CRM*\n\n` +
      `✅ WhatsApp lead alerts are configured correctly.\n\n` +
      `👤 *Patient:* Test Patient\n` +
      `📞 *Mobile:* 919999999999\n` +
      `📡 *Source:* WhatsApp\n` +
      `🏥 *Service:* Home Haemodialysis\n` +
      `📋 *Status:* Qualified Lead\n` +
      `💬 *Message:* This is a test notification.`;

    res.json({
      message:      `Test alert queued for ${alertNumbers.length} number(s)`,
      alertNumbers,
      note:         "Check your WhatsApp for the test message.",
    });

    // [F13] Fire after response using shared sendText
    Promise.allSettled(
      alertNumbers.map((num) => sendText(num, sampleAlert))
    ).catch(console.error);

  } catch (err) {
    console.error("Test alert error:", err);
    res.status(500).json({ error: "Failed to send test alert" });
  }
});

// ─── WhatsApp Lead Stats ──────────────────────────────────────────────────────

router.get("/lead-stats", authenticateToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT
        COUNT(*)                                                                        AS total_whatsapp_leads,
        SUM(CASE WHEN DATE(created_at) = CURDATE()                     THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)    THEN 1 ELSE 0 END) AS last_7_days,
        SUM(CASE WHEN status = 'qualified-lead'   THEN 1 ELSE 0 END)   AS qualified,
        SUM(CASE WHEN status = 'installation'     THEN 1 ELSE 0 END)   AS converted,
        SUM(CASE WHEN service IS NOT NULL         THEN 1 ELSE 0 END)   AS with_service_detected
      FROM leads
      WHERE source = 'whatsapp'
    `);

    const [serviceBreakdown] = await pool.execute(`
      SELECT service, COUNT(*) AS count
      FROM leads
      WHERE source = 'whatsapp' AND service IS NOT NULL
      GROUP BY service
      ORDER BY count DESC
    `);

    const [dailyTrend] = await pool.execute(`
      SELECT DATE(created_at) AS date, COUNT(*) AS count
      FROM leads
      WHERE source = 'whatsapp'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json({ summary: stats[0] || {}, serviceBreakdown, dailyTrend });
  } catch (err) {
    console.error("WhatsApp lead stats error:", err);
    res.status(500).json({ error: "Failed to fetch WhatsApp lead stats" });
  }
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

router.get(
  "/campaigns",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(["draft", "active", "paused", "completed"]),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
      const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const offset = (page - 1) * limit;

      const { status } = req.query;
      let where    = "WHERE 1=1";
      const params = [];
      if (status) { where += " AND status = ?"; params.push(status); }

      const [campaigns] = await pool.execute(
        `SELECT * FROM whatsapp_campaigns ${where}
         ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM whatsapp_campaigns ${where}`,
        params
      );

      res.json({
        campaigns: campaigns.map((c) => ({
          ...c,
          target_audience: parseJsonArray(c.target_audience),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)), // [F15]
          hasNext:    page * limit < total,
          hasPrev:    page > 1,
        },
      });
    } catch (err) {
      console.error("Campaigns fetch error:", err);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  }
);

router.post(
  "/campaigns",
  authenticateToken,
  [
    body("name").trim().notEmpty().withMessage("Campaign name is required"),
    body("template").trim().notEmpty().withMessage("Message template is required"),
    body("targetAudience").isArray().withMessage("Target audience must be an array"),
    body("scheduledAt").optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;
      const { name, template, targetAudience, scheduledAt } = req.body;

      const [result] = await pool.execute(
        `INSERT INTO whatsapp_campaigns (name, template, target_audience, scheduled_at)
         VALUES (?, ?, ?, ?)`,
        [name, template, JSON.stringify(targetAudience), scheduledAt || null]
      );

      const [[campaign]] = await pool.execute(
        "SELECT * FROM whatsapp_campaigns WHERE id = ?",
        [result.insertId]
      );
      campaign.target_audience = parseJsonArray(campaign.target_audience);

      res.status(201).json({ message: "Campaign created successfully", campaign });
    } catch (err) {
      console.error("Campaign creation error:", err);
      res.status(500).json({ error: "Failed to create campaign" });
    }
  }
);

router.put(
  "/campaigns/:id/status",
  authenticateToken,
  [body("status").isIn(["draft", "active", "paused", "completed"])],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;
      await pool.execute(
        "UPDATE whatsapp_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [req.body.status, req.params.id]
      );
      res.json({ message: "Campaign status updated" });
    } catch (err) {
      res.status(500).json({ error: "Failed to update campaign status" });
    }
  }
);

// ─── Send Message ─────────────────────────────────────────────────────────────

router.post(
  "/send-message",
  authenticateToken,
  [
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
    body("message").trim().notEmpty().withMessage("Message is required"),
    body("customerId").optional().isString(),
    body("campaignId").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;
      const { phoneNumber, message, customerId, campaignId } = req.body;

      const [result] = await pool.execute(
        `INSERT INTO whatsapp_messages
           (campaign_id, customer_id, phone_number, message, status, sent_at)
         VALUES (?, ?, ?, ?, 'sent', NOW())`,
        [campaignId || null, customerId || null, phoneNumber, message]
      );

      console.log(`[WA] Sending message to ${phoneNumber}: ${message}`);

      setTimeout(async () => {
        await pool.execute(
          "UPDATE whatsapp_messages SET status = 'delivered', delivered_at = NOW() WHERE id = ?",
          [result.insertId]
        ).catch(() => {});
      }, 1000);

      res.json({ message: "WhatsApp message sent successfully", messageId: result.insertId });
    } catch (err) {
      console.error("Message send error:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  }
);

// ─── Message History ──────────────────────────────────────────────────────────

router.get(
  "/messages",
  authenticateToken,
  [
    query("customerId").optional().isString(),
    query("campaignId").optional().isString(),
    query("status").optional().isIn(["pending", "sent", "delivered", "read", "failed"]),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;
      const { customerId, campaignId, status } = req.query;

      let where    = "WHERE 1=1";
      const params = [];
      if (customerId) { where += " AND wm.customer_id = ?"; params.push(customerId); }
      if (campaignId) { where += " AND wm.campaign_id = ?"; params.push(campaignId); }
      if (status)     { where += " AND wm.status = ?";      params.push(status);     }

      const [messages] = await pool.execute(
        `SELECT wm.*, c.name AS customer_name, wc.name AS campaign_name
         FROM whatsapp_messages wm
         LEFT JOIN customers c             ON wm.customer_id  = c.id
         LEFT JOIN whatsapp_campaigns wc   ON wm.campaign_id  = wc.id
         ${where}
         ORDER BY wm.created_at DESC LIMIT 100`,
        params
      );

      res.json({ messages });
    } catch (err) {
      console.error("Messages fetch error:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  }
);

// ─── Overall Stats ────────────────────────────────────────────────────────────

router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const [campaignStats] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM whatsapp_campaigns GROUP BY status`
    );
    const [messageStats] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM whatsapp_messages
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY status`
    );
    const [dailyStats] = await pool.execute(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM whatsapp_messages
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DATE(created_at)
       ORDER BY date`
    );

    res.json({
      campaignBreakdown: campaignStats,
      messageBreakdown:  messageStats,
      dailyActivity:     dailyStats,
    });
  } catch (err) {
    console.error("Stats fetch error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ─── Renewal Reminders ────────────────────────────────────────────────────────

router.post("/send-renewal-reminders", authenticateToken, async (req, res) => {
  try {
    const [reminders] = await pool.execute(`
      SELECT rr.*, c.name AS customer_name, c.whatsapp_number AS customer_whatsapp
      FROM renewal_reminders rr
      LEFT JOIN customers c ON rr.customer_id = c.id
      WHERE rr.status = 'active'
        AND c.whatsapp_number IS NOT NULL
        AND c.whatsapp_number != ''
    `);

    let sentCount  = 0;
    const today    = new Date();
    const todayStr = today.toISOString().split("T")[0];

    for (const reminder of reminders) {
      const reminderDays    = parseJsonArray(reminder.reminder_days);
      const expiryDate      = new Date(reminder.expiry_date);
      const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

      if (!reminderDays.includes(daysUntilExpiry)) continue;

      const lastSent = reminder.last_reminder_sent
        ? new Date(reminder.last_reminder_sent).toISOString().split("T")[0]
        : null;
      if (lastSent === todayStr) continue;

      let msg = reminder.whatsapp_template ||
        "Hi {customerName}, your {serviceName} expires on {expiryDate}. Please renew to continue your service.";

      msg = msg
        .replace("{customerName}", reminder.customer_name)
        .replace("{serviceName}",  reminder.service_name)
        .replace("{expiryDate}",   expiryDate.toLocaleDateString("en-IN"));

      await pool.execute(
        `INSERT INTO whatsapp_messages
           (customer_id, phone_number, message, status, sent_at)
         VALUES (?, ?, ?, 'sent', NOW())`,
        [reminder.customer_id, reminder.customer_whatsapp, msg]
      );

      await pool.execute(
        "UPDATE renewal_reminders SET last_reminder_sent = CURDATE() WHERE id = ?",
        [reminder.id]
      );

      sentCount++;
    }

    res.json({ message: `Sent ${sentCount} renewal reminders`, sentCount });
  } catch (err) {
    console.error("Renewal reminders error:", err);
    res.status(500).json({ error: "Failed to send renewal reminders" });
  }
});

module.exports = router;