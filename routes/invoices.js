// const { v4: uuidv4 }      = require("uuid");
// const PDFDocument          = require("pdfkit");
// const express              = require("express");
// const { body, validationResult } = require("express-validator");
// const { pool }             = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");

// const router = express.Router();

// // ─── UTILS ────────────────────────────────────────────────────────────────────

// const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

// const toSqlDate = (value) => {
//   if (!value) return null;
//   const d = value instanceof Date ? value : new Date(value);
//   if (Number.isNaN(d.getTime())) return null;
//   const y   = d.getFullYear();
//   const m   = String(d.getMonth() + 1).padStart(2, "0");
//   const day = String(d.getDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// };

// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({ error: "Validation failed", details: errors.array() });
//     return true;
//   }
//   return false;
// };

// /**
//  * Generate a Renalease invoice number: RNL-YYYYMM-XXXX
//  * e.g. RNL-202503-0042
//  */
// const generateRNLNumber = async (connection) => {
//   const now   = new Date();
//   const ym    = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
//   const prefix = `RNL-${ym}-`;

//   // Find the highest sequence this month
//   const [rows] = await connection.execute(
//     `SELECT invoice_number FROM invoices
//      WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`,
//     [`${prefix}%`]
//   );

//   let seq = 1;
//   if (rows.length > 0) {
//     const last = rows[0].invoice_number;  // e.g. RNL-202503-0041
//     const parts = last.split("-");
//     seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
//   }
//   return `${prefix}${String(seq).padStart(4, "0")}`;
// };

// const invoiceFieldMap = {
//   customerId:         "customer_id",
//   amount:             "amount",
//   tax:                "tax",
//   total:              "total",
//   status:             "status",
//   issueDate:          "issue_date",
//   dueDate:            "due_date",
//   paidDate:           "paid_date",
//   notes:              "notes",
//   isRecurring:        "is_recurring",
//   recurringFrequency: "recurring_frequency",
//   recurringCycles:    "recurring_cycles",
//   recurringStartDate: "recurring_start_date",
//   recurringEndDate:   "recurring_end_date",
// };

// // ─── ACCESS CONTROL ───────────────────────────────────────────────────────────

// const canAccessInvoice = async (req, res, invoiceId) => {
//   if (req.user.role === "admin") return { ok: true };
//   const [rows] = await pool.execute(
//     `SELECT i.id FROM invoices i
//      INNER JOIN customers c ON i.customer_id = c.id
//      WHERE i.id = ? AND c.assigned_to = ?`,
//     sanitize(invoiceId, req.user.userId)
//   );
//   if (rows.length === 0) {
//     return { ok: false, response: res.status(403).json({ error: "Access denied" }) };
//   }
//   return { ok: true };
// };

// // ─── GET ALL INVOICES ─────────────────────────────────────────────────────────

// router.get("/", authenticateToken, async (req, res) => {
//   try {
//     const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
//     const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
//     const offset = (page - 1) * limit;

//     const { search, status, customerId, isRecurring, dueDateFrom, dueDateTo } = req.query;

//     let where  = "WHERE 1=1";
//     const params = [];

//     if (req.user.role !== "admin") {
//       where += " AND c.assigned_to = ?";
//       params.push(req.user.userId);
//     }

//     if (search) {
//       where += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
//       const s = `%${search}%`;
//       params.push(s, s, s);
//     }

//     if (status)     { where += " AND i.status = ?";      params.push(status); }
//     if (customerId) { where += " AND i.customer_id = ?"; params.push(customerId); }
//     if (isRecurring !== undefined) {
//       where += " AND i.is_recurring = ?";
//       params.push(isRecurring === "true" ? 1 : 0);
//     }
//     if (dueDateFrom) { where += " AND i.due_date >= ?"; params.push(dueDateFrom); }
//     if (dueDateTo)   { where += " AND i.due_date <= ?"; params.push(dueDateTo); }

//     const [invoices] = await pool.execute(
//       `SELECT i.*,
//               c.name    AS customer_name,
//               c.company AS customer_company,
//               c.email   AS customer_email,
//               c.phone   AS customer_phone
//        FROM invoices i
//        LEFT JOIN customers c ON i.customer_id = c.id
//        ${where}
//        ORDER BY i.created_at DESC
//        LIMIT ${limit} OFFSET ${offset}`,
//       sanitize(...params)
//     );

//     // Attach items to each invoice
//     if (invoices.length > 0) {
//       const ids = invoices.map((i) => i.id);
//       const placeholders = ids.map(() => "?").join(",");
//       const [allItems] = await pool.execute(
//         `SELECT * FROM invoice_items WHERE invoice_id IN (${placeholders}) ORDER BY created_at`,
//         sanitize(...ids)
//       );
//       invoices.forEach((inv) => {
//         inv.items = allItems.filter((it) => it.invoice_id === inv.id);
//       });
//     }

//     const [[{ total }]] = await pool.execute(
//       `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${where}`,
//       sanitize(...params)
//     );

//     const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

//     res.json({
//       invoices,
//       pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
//     });
//   } catch (err) {
//     console.error("Invoices fetch error:", err);
//     res.status(500).json({ error: "Failed to fetch invoices" });
//   }
// });

// // ─── STATS ────────────────────────────────────────────────────────────────────

// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     let where  = "WHERE 1=1";
//     const params = [];
//     if (req.user.role !== "admin") { where += " AND c.assigned_to = ?"; params.push(req.user.userId); }

//     const [statusStats] = await pool.execute(
//       `SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total_amount
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//        ${where} GROUP BY i.status`,
//       sanitize(...params)
//     );

//     const [monthly] = await pool.execute(
//       `SELECT DATE_FORMAT(i.created_at, '%Y-%m') AS month,
//               COUNT(*) AS count,
//               COALESCE(SUM(i.total), 0) AS total_amount
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//        ${where} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//        GROUP BY month ORDER BY month`,
//       sanitize(...params)
//     );

//     const [[overdue]] = await pool.execute(
//       `SELECT COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total_amount
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//        ${where} AND i.status IN ('sent','overdue') AND i.due_date < CURDATE()`,
//       sanitize(...params)
//     );

//     const [[recurring]] = await pool.execute(
//       `SELECT COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total_amount
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//        ${where} AND i.is_recurring = 1`,
//       sanitize(...params)
//     );

//     res.json({ statusBreakdown: statusStats, monthlyTrend: monthly, overdue, recurring });
//   } catch (err) {
//     console.error("Invoice stats error:", err);
//     res.status(500).json({ error: "Failed to fetch invoice statistics" });
//   }
// });

// // ─── DOWNLOAD PDF ─────────────────────────────────────────────────────────────

// router.post("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const logoBase64 = req.body?.logoBase64 ?? null;

//     const [invRows] = await pool.execute(
//       `SELECT i.*,
//               c.name    AS customername,
//               c.email   AS customeremail,
//               c.phone   AS customerphone,
//               c.company AS customercompany,
//               c.address AS customeraddress,
//               c.city    AS customercity,
//               c.state   AS customerstate,
//               c.country AS customercountry
//        FROM invoices i
//        LEFT JOIN customers c ON i.customer_id = c.id
//        WHERE i.id = ?`,
//       sanitize(id)
//     );

//     if (!invRows || invRows.length === 0) return res.status(404).json({ error: "Invoice not found" });

//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       sanitize(id)
//     );

//     const inv       = invRows[0];
//     const subtotal  = Number(inv.amount || 0);
//     const gstRate   = Number(inv.tax    || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalAmt  = Number(inv.total  || subtotal + gstAmount);

//     // ── Format helpers ──────────────────────────────────────────────────────
//     const fmtDate = (value) => {
//       if (!value) return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
//       const d = new Date(value);
//       if (Number.isNaN(d.getTime())) return fmtDate(null);
//       return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
//     };

//     const fmtCurrency = (n) => `Rs. ${Number(n).toFixed(2)}`;

//     // ── PDF setup ───────────────────────────────────────────────────────────
//     const doc = new PDFDocument({ size: "A4", margin: 40 });
//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename=invoice-${inv.invoice_number || "NA"}.pdf`);
//     doc.pipe(res);

//     // ── Colors ──────────────────────────────────────────────────────────────
//     const brandPrimary   = "#0F4C81";   // deep Renalease blue
//     const brandSecondary = "#1E88E5";
//     const accentTeal     = "#00897B";   // medical teal
//     const accentGold     = "#F9A825";
//     const textDark       = "#1A2332";
//     const textGray       = "#64748B";
//     const bgLight        = "#F8FAFC";
//     const borderGray     = "#E2E8F0";

//     const PAGE_W = 595.28;
//     const ML     = 40;
//     const MR     = 40;
//     const CW     = PAGE_W - ML - MR;

//     let y = 40;

//     // ── LOGO ────────────────────────────────────────────────────────────────
//     if (logoBase64) {
//       try {
//         const imgData = logoBase64.includes(",") ? logoBase64.split(",")[1] : logoBase64;
//         doc.image(Buffer.from(imgData, "base64"), ML, y, { width: 140, fit: [140, 55] });
//       } catch (e) { console.error("Logo error:", e); }
//     }

//     // ── CLINIC BRANDING (right of logo) ──────────────────────────────────────
//     doc
//       .fontSize(18)
//       .font("Helvetica-Bold")
//       .fillColor(brandPrimary)
//       .text("Renalease", PAGE_W - MR - 160, y + 4, { align: "right", width: 160 });

//     doc
//       .fontSize(8.5)
//       .font("Helvetica")
//       .fillColor(textGray)
//       .text("Kidney Care & Nephrology Services", PAGE_W - MR - 160, y + 26, { align: "right", width: 160 });

//     // ── INVOICE BADGE ────────────────────────────────────────────────────────
//     y += 65;
//     doc
//       .rect(ML, y, CW, 34)
//       .fillAndStroke(brandPrimary, brandPrimary);

//     doc
//       .fontSize(20)
//       .font("Helvetica-Bold")
//       .fillColor("#FFFFFF")
//       .text("TAX INVOICE", ML, y + 8, { align: "center", width: CW });

//     y += 44;

//     // ── INVOICE META ROW ─────────────────────────────────────────────────────
//     doc
//       .rect(ML, y, CW, 26)
//       .fillAndStroke(bgLight, borderGray);

//     const metaItems = [
//       { label: "Invoice No", value: inv.invoice_number || "—" },
//       { label: "Issue Date",  value: fmtDate(inv.issue_date || inv.created_at) },
//       { label: "Due Date",    value: fmtDate(inv.due_date) },
//       { label: "Status",      value: (inv.status || "draft").toUpperCase() },
//     ];

//     const metaColW = CW / metaItems.length;
//     metaItems.forEach((m, i) => {
//       const mx = ML + i * metaColW;
//       doc.fontSize(7).font("Helvetica-Bold").fillColor(textGray)
//          .text(m.label, mx + 6, y + 5, { width: metaColW - 8 });
//       doc.fontSize(8).font("Helvetica-Bold")
//          .fillColor(m.label === "Status" ? accentTeal : textDark)
//          .text(m.value, mx + 6, y + 14, { width: metaColW - 8 });
//     });

//     y += 36;

//     // ── BILL TO / FROM ────────────────────────────────────────────────────────
//     const halfW   = (CW - 12) / 2;
//     const fromX   = ML;
//     const toX     = ML + halfW + 12;
//     const blockY  = y;

//     // "Billed From" box
//     doc.rect(fromX, blockY, halfW, 90).fillAndStroke(bgLight, borderGray);
//     doc.fontSize(8).font("Helvetica-Bold").fillColor(brandPrimary)
//        .text("FROM", fromX + 8, blockY + 8);
//     doc.fontSize(9).font("Helvetica-Bold").fillColor(textDark)
//        .text("Vasify Technologies Pvt. Ltd.", fromX + 8, blockY + 20);
//     doc.fontSize(7.5).font("Helvetica").fillColor(textGray)
//        .text(
//          "102, Dani Sanjay Apartment, Datta Mandir Road,\nDahanukar Wadi, Kandivali West,\nMumbai, Maharashtra – 400067\nPhone: +91-9769754446",
//          fromX + 8,
//          blockY + 34,
//          { width: halfW - 16, lineGap: 2 }
//        );

//     // "Bill To" box
//     doc.rect(toX, blockY, halfW, 90).fillAndStroke("#EEF7FF", brandSecondary);
//     doc.fontSize(8).font("Helvetica-Bold").fillColor(brandSecondary)
//        .text("BILL TO", toX + 8, blockY + 8);
//     doc.fontSize(9.5).font("Helvetica-Bold").fillColor(textDark)
//        .text(inv.customername || "Patient Name", toX + 8, blockY + 20);

//     let toY = blockY + 35;
//     const toDetails = [
//       inv.customercompany,
//       inv.customeremail   ? `Email: ${inv.customeremail}`   : null,
//       inv.customerphone   ? `Phone: ${inv.customerphone}`   : null,
//       [inv.customeraddress, inv.customercity, inv.customerstate, inv.customercountry].filter(Boolean).join(", ") || null,
//     ].filter(Boolean);

//     toDetails.forEach((line) => {
//       doc.fontSize(7.5).font("Helvetica").fillColor(textGray)
//          .text(line, toX + 8, toY, { width: halfW - 16 });
//       toY += 12;
//     });

//     y = blockY + 100;

//     // ── ITEMS TABLE ───────────────────────────────────────────────────────────
//     const colSr   = { x: ML,           w: 35 };
//     const colDesc = { x: ML + 35,      w: CW - 35 - 100 };
//     const colAmt  = { x: ML + CW - 100, w: 100 };

//     // Table header
//     doc.rect(ML, y, CW, 24).fillAndStroke(brandPrimary, brandPrimary);
//     const thCols = [
//       { label: "Sr.",         x: colSr.x,   w: colSr.w,   align: "center" },
//       { label: "Service / Description", x: colDesc.x + 6, w: colDesc.w - 12, align: "left" },
//       { label: "Amount (Rs.)", x: colAmt.x,  w: colAmt.w,  align: "right" },
//     ];
//     thCols.forEach(({ label, x, w, align }) => {
//       doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#FFFFFF")
//          .text(label, x, y + 8, { width: w, align });
//     });
//     y += 24;

//     const tableRows = items.length > 0 ? items : [{ description: "Medical Service Charges", amount: subtotal }];

//     tableRows.forEach((item, idx) => {
//       const rowH = 24;
//       if (idx % 2 === 1) doc.rect(ML, y, CW, rowH).fill("#F8FBFF");

//       doc.fontSize(8).font("Helvetica").fillColor(textDark)
//          .text(String(idx + 1), colSr.x, y + 8, { width: colSr.w, align: "center" });

//       doc.fontSize(8).font("Helvetica").fillColor(textDark)
//          .text(item.description || "Medical Service", colDesc.x + 6, y + 8, { width: colDesc.w - 12 });

//       doc.fontSize(8).font("Helvetica-Bold").fillColor(textDark)
//          .text(Number(item.amount || 0).toFixed(2), colAmt.x, y + 8, { width: colAmt.w, align: "right" });

//       y += rowH;

//       // Breakdown rows
//       let breakdown = null;
//       try {
//         breakdown = typeof item.breakdown === "string" ? JSON.parse(item.breakdown) : item.breakdown;
//       } catch { breakdown = null; }

//       if (Array.isArray(breakdown) && breakdown.length > 0) {
//         breakdown.forEach((b) => {
//           doc.fontSize(7).font("Helvetica").fillColor(textGray)
//              .text(`  • ${b.label || ""}`, colDesc.x + 12, y + 4, { width: colDesc.w - 18 });
//           doc.fontSize(7).font("Helvetica").fillColor(textGray)
//              .text(Number(b.amount || 0).toFixed(2), colAmt.x, y + 4, { width: colAmt.w, align: "right" });
//           y += 13;
//         });
//       }

//       // Divider
//       doc.moveTo(ML, y).lineTo(ML + CW, y).strokeColor(borderGray).lineWidth(0.5).stroke();
//       y += 8;
//     });

//     y += 6;

//     // ── TOTALS ────────────────────────────────────────────────────────────────
//     const totX  = ML + CW - 220;
//     const valX  = ML + CW - 90;
//     const totW  = 220;
//     const valW  = 90;

//     const drawTotalRow = (label, value, bold = false, bg = null, textCol = textDark) => {
//       if (bg) { doc.rect(totX - 6, y - 2, totW + valW + 6, 22).fill(bg); }
//       doc.fontSize(bold ? 10 : 9)
//          .font(bold ? "Helvetica-Bold" : "Helvetica")
//          .fillColor(textCol)
//          .text(label, totX, y + (bold ? 4 : 5), { width: totW });
//       doc.fontSize(bold ? 10 : 9)
//          .font(bold ? "Helvetica-Bold" : "Helvetica")
//          .fillColor(textCol)
//          .text(value, valX, y + (bold ? 4 : 5), { width: valW, align: "right" });
//       y += bold ? 26 : 18;
//     };

//     drawTotalRow("Subtotal (before GST)",               fmtCurrency(subtotal));
//     drawTotalRow(`GST @ ${gstRate}% (on total amount)`, fmtCurrency(gstAmount), false, null, accentGold);
//     doc.moveTo(totX - 6, y - 2).lineTo(ML + CW, y - 2).strokeColor(borderGray).lineWidth(1).stroke();
//     drawTotalRow("TOTAL PAYABLE (incl. GST)", fmtCurrency(totalAmt), true, "#EEF2FF", brandPrimary);

//     y += 8;

//     // ── RECURRING NOTE ────────────────────────────────────────────────────────
//     if (inv.is_recurring) {
//       const freq   = inv.recurring_frequency || "monthly";
//       const cycles = inv.recurring_cycles    || "—";
//       const start  = inv.recurring_start_date ? fmtDate(inv.recurring_start_date) : "—";

//       doc.rect(ML, y, CW, 28).fillAndStroke("#EDF7F6", accentTeal);
//       doc.fontSize(8).font("Helvetica-Bold").fillColor(accentTeal)
//          .text("♻  RECURRING BILLING", ML + 8, y + 6);
//       doc.fontSize(7.5).font("Helvetica").fillColor(textGray)
//          .text(
//            `This is a recurring invoice (${freq.charAt(0).toUpperCase() + freq.slice(1)}). Cycle ${cycles} starting ${start}.`,
//            ML + 8,
//            y + 16,
//            { width: CW - 16 }
//          );
//       y += 36;
//     }

//     // ── BANK DETAILS ──────────────────────────────────────────────────────────
//     y += 4;
//     doc.fontSize(8.5).font("Helvetica-Bold").fillColor(textDark).text("Bank Details", ML, y);
//     y += 13;

//     const bankLines = [
//       "Account Name : Vasify Technologies Pvt. Ltd.",
//       "Bank         : Axis Bank, M.G. Road, Kandivali West Branch",
//       "Account No   : 924020018276663",
//       "IFSC         : UTIB0001578",
//     ];
//     bankLines.forEach((line) => {
//       doc.fontSize(8).font("Helvetica").fillColor(textGray).text(line, ML, y);
//       y += 12;
//     });

//     // ── NOTES ────────────────────────────────────────────────────────────────
//     if (inv.notes && String(inv.notes).trim()) {
//       y += 6;
//       doc.fontSize(8.5).font("Helvetica-Bold").fillColor(textDark).text("Notes", ML, y);
//       y += 13;
//       doc.fontSize(8).font("Helvetica").fillColor(textGray)
//          .text(String(inv.notes).trim(), ML, y, { width: CW, lineGap: 2 });
//     }

//     // ── FOOTER ────────────────────────────────────────────────────────────────
//     const footerY = 775;
//     doc.rect(ML, footerY - 8, CW, 1).fill(borderGray);
//     doc.fontSize(8).font("Helvetica").fillColor(textGray)
//        .text(
//          "Thank you for trusting Renalease with your care. For queries, contact: +91-9769754446 | www.renalease.com",
//          ML,
//          footerY,
//          { align: "center", width: CW }
//        );
//     doc.fontSize(7).fillColor("#9CA3AF")
//        .text(
//          `Generated on ${new Date().toLocaleDateString("en-IN")} | This is a computer-generated invoice.`,
//          ML,
//          footerY + 12,
//          { align: "center", width: CW }
//        );

//     doc.end();
//   } catch (err) {
//     console.error("PDF generation error:", err);
//     if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF" });
//   }
// });

// // ─── CREATE INVOICE ───────────────────────────────────────────────────────────

// router.post(
//   "/",
//   authenticateToken,
//   [
//     body("customerId").notEmpty().withMessage("Customer ID is required"),
//     body("items").isArray({ min: 1 }).withMessage("Items array is required"),
//   ],
//   async (req, res) => {
//     if (handleValidation(req, res)) return;

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       const { customerId, items, isRecurring, recurringFrequency, recurringCycles, recurringStartDate, recurringEndDate } = req.body;

//       // Check customer
//       const [customers] = await connection.execute(
//         "SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?",
//         sanitize(customerId)
//       );
//       if (!customers.length) { await connection.rollback(); connection.release(); return res.status(400).json({ error: "Customer not found" }); }

//       const customer = customers[0];
//       if (req.user.role !== "admin" && customer.assigned_to !== req.user.userId) {
//         await connection.rollback(); connection.release();
//         return res.status(403).json({ error: "No permission to invoice this customer" });
//       }

//       // Financial values
//       const subtotal  = req.body.amount !== undefined ? Number(req.body.amount) : items.reduce((s, i) => s + Number(i.amount || 0), 0);
//       const taxRate   = req.body.tax !== undefined ? Number(req.body.tax) : Number(customer.default_tax_rate || 0);
//       const gstAmt    = (subtotal * taxRate) / 100;
//       const total     = req.body.total !== undefined ? Number(req.body.total) : subtotal + gstAmt;
//       const status    = req.body.status || "draft";
//       const issueDate = req.body.issueDate ? toSqlDate(req.body.issueDate) : toSqlDate(new Date());
//       const dueDate   = req.body.dueDate  ? toSqlDate(req.body.dueDate)
//         : (() => { const d = new Date(); d.setDate(d.getDate() + Number(customer.default_due_days || 30)); return toSqlDate(d); })();
//       const notes     = req.body.notes ?? customer.default_invoice_notes ?? null;

//       const invoiceNumber = await generateRNLNumber(connection);
//       const invoiceId     = uuidv4();

//       await connection.execute(
//         `INSERT INTO invoices
//            (id, customer_id, invoice_number, amount, tax, total, status,
//             issue_date, due_date, notes,
//             is_recurring, recurring_frequency, recurring_cycles,
//             recurring_start_date, recurring_end_date)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         sanitize(
//           invoiceId, customerId, invoiceNumber, subtotal, taxRate, total, status,
//           issueDate, dueDate, notes,
//           isRecurring ? 1 : 0,
//           recurringFrequency || null,
//           recurringCycles    ? Number(recurringCycles) : null,
//           recurringStartDate ? toSqlDate(recurringStartDate) : null,
//           recurringEndDate   ? toSqlDate(recurringEndDate)   : null
//         )
//       );

//       for (const item of items) {
//         await connection.execute(
//           `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, breakdown)
//            VALUES (?, ?, ?, ?, ?, ?, ?)`,
//           sanitize(
//             uuidv4(), invoiceId,
//             item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
//             item.breakdown ? JSON.stringify(item.breakdown) : null
//           )
//         );
//       }

//       await connection.commit();

//       const [[created]] = await connection.execute(
//         `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
//          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//         sanitize(invoiceId)
//       );
//       const [createdItems] = await connection.execute(
//         "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//         sanitize(invoiceId)
//       );
//       created.items = createdItems;

//       res.status(201).json({ message: "Invoice created successfully", invoice: created });
//     } catch (err) {
//       await connection.rollback();
//       console.error("Invoice creation error:", err);
//       res.status(500).json({ error: "Failed to create invoice", details: err.message });
//     } finally {
//       connection.release();
//     }
//   }
// );

// // ─── UPDATE INVOICE ───────────────────────────────────────────────────────────

// router.put("/:id", authenticateToken, async (req, res) => {
//   const { id } = req.params;

//   const access = await canAccessInvoice(req, res, id);
//   if (!access.ok) return;

//   const connection = await pool.getConnection();
//   await connection.beginTransaction();

//   try {
//     const [existing] = await connection.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
//     if (!existing.length) { await connection.rollback(); connection.release(); return res.status(404).json({ error: "Invoice not found" }); }

//     const updateData = { ...req.body };

//     // When marking as paid, auto-set paidDate
//     if (updateData.status === "paid" && !updateData.paidDate) {
//       updateData.paidDate = toSqlDate(new Date());
//     }
//     if (updateData.dueDate)  updateData.dueDate  = toSqlDate(updateData.dueDate);
//     if (updateData.issueDate) updateData.issueDate = toSqlDate(updateData.issueDate);
//     if (updateData.paidDate)  updateData.paidDate  = toSqlDate(updateData.paidDate);
//     if (updateData.recurringStartDate) updateData.recurringStartDate = toSqlDate(updateData.recurringStartDate);
//     if (updateData.recurringEndDate)   updateData.recurringEndDate   = toSqlDate(updateData.recurringEndDate);

//     const fields = [];
//     const values = [];

//     for (const [key, value] of Object.entries(updateData)) {
//       if (key === "items" || value === undefined) continue;
//       const dbField = invoiceFieldMap[key];
//       if (!dbField) continue;
//       const dbVal = key === "isRecurring" ? (value ? 1 : 0) : value;
//       fields.push(`${dbField} = ?`);
//       values.push(dbVal);
//     }

//     if (fields.length > 0) {
//       values.push(id);
//       await connection.execute(
//         `UPDATE invoices SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//         sanitize(...values)
//       );
//     }

//     if (Array.isArray(updateData.items)) {
//       await connection.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
//       for (const item of updateData.items) {
//         await connection.execute(
//           `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, breakdown)
//            VALUES (?, ?, ?, ?, ?, ?, ?)`,
//           sanitize(
//             uuidv4(), id,
//             item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
//             item.breakdown ? JSON.stringify(item.breakdown) : null
//           )
//         );
//       }
//     }

//     await connection.commit();

//     const [[updated]] = await connection.execute(
//       `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//       sanitize(id)
//     );
//     const [updatedItems] = await connection.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       sanitize(id)
//     );
//     updated.items = updatedItems;

//     res.json({ message: "Invoice updated successfully", invoice: updated });
//   } catch (err) {
//     await connection.rollback();
//     console.error("Invoice update error:", err);
//     res.status(500).json({ error: "Failed to update invoice" });
//   } finally {
//     connection.release();
//   }
// });

// // ─── DELETE INVOICE ───────────────────────────────────────────────────────────

// router.delete("/:id", authenticateToken, async (req, res) => {
//   const { id } = req.params;
//   const access  = await canAccessInvoice(req, res, id);
//   if (!access.ok) return;

//   try {
//     const [existing] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
//     if (!existing.length) return res.status(404).json({ error: "Invoice not found" });

//     await pool.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
//     await pool.execute("DELETE FROM invoices WHERE id = ?", sanitize(id));
//     res.json({ message: "Invoice deleted successfully" });
//   } catch (err) {
//     console.error("Invoice delete error:", err);
//     res.status(500).json({ error: "Failed to delete invoice" });
//   }
// });

// // ─── MIGRATION SQL (add missing columns) ─────────────────────────────────────
// // Run this once against your DB if upgrading from the old schema:
// //
// //   ALTER TABLE invoices
// //     ADD COLUMN IF NOT EXISTS issue_date        DATE         NULL,
// //     ADD COLUMN IF NOT EXISTS paid_date         DATE         NULL,
// //     ADD COLUMN IF NOT EXISTS is_recurring      TINYINT(1)   NOT NULL DEFAULT 0,
// //     ADD COLUMN IF NOT EXISTS recurring_frequency  VARCHAR(20)  NULL,
// //     ADD COLUMN IF NOT EXISTS recurring_cycles  INT          NULL,
// //     ADD COLUMN IF NOT EXISTS recurring_start_date  DATE     NULL,
// //     ADD COLUMN IF NOT EXISTS recurring_end_date    DATE     NULL;
// //
// //   ALTER TABLE invoice_items
// //     ADD COLUMN IF NOT EXISTS breakdown TEXT NULL;

// module.exports = router;


//testing (20-05-2026)





const { v4: uuidv4 }          = require("uuid");
const PDFDocument              = require("pdfkit");
const express                  = require("express");
const { body, validationResult } = require("express-validator");
const { pool }                 = require("../config/database");
const { authenticateToken }    = require("../middleware/auth");

const router = express.Router();

// ─── UTILS ────────────────────────────────────────────────────────────────────

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

const toSqlDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

/**
 * Generate a Renalease invoice number: RNL-YYYYMM-XXXX
 * e.g. RNL-202503-0042
 */
const generateRNLNumber = async (connection) => {
  const now    = new Date();
  const ym     = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `RNL-${ym}-`;

  const [rows] = await connection.execute(
    `SELECT invoice_number FROM invoices
     WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0) {
    const last  = rows[0].invoice_number;
    const parts = last.split("-");
    seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const invoiceFieldMap = {
  customerId:          "customer_id",
  amount:              "amount",
  tax:                 "tax",
  total:               "total",
  status:              "status",
  issueDate:           "issue_date",
  dueDate:             "due_date",
  paidDate:            "paid_date",
  notes:               "notes",
  isRecurring:         "is_recurring",
  recurringFrequency:  "recurring_frequency",
  recurringCycles:     "recurring_cycles",
  recurringStartDate:  "recurring_start_date",
  recurringEndDate:    "recurring_end_date",
};

// ─── ACCESS CONTROL ───────────────────────────────────────────────────────────

/**
 * FIX (Bug A): was sanitize(invoiceId, req.user.userId) — userId is undefined.
 * auth.js sets req.user.id, not req.user.userId.
 */
const canAccessInvoice = async (req, res, invoiceId) => {
  if (req.user.role === "admin") return { ok: true };
  const [rows] = await pool.execute(
    `SELECT i.id FROM invoices i
     INNER JOIN customers c ON i.customer_id = c.id
     WHERE i.id = ? AND c.assigned_to = ?`,
    sanitize(invoiceId, req.user.id)            // ✅ FIXED: req.user.id
  );
  if (rows.length === 0) {
    return { ok: false, response: res.status(403).json({ error: "Access denied" }) };
  }
  return { ok: true };
};

// ─── GET ALL INVOICES ─────────────────────────────────────────────────────────

router.get("/", authenticateToken, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const { search, status, customerId, isRecurring, dueDateFrom, dueDateTo } = req.query;

    let where    = "WHERE 1=1";
    const params = [];

    /**
     * FIX (Bug B): was req.user.userId — always undefined → sanitize converts
     * to null → WHERE c.assigned_to = NULL matches nothing (SQL NULL ≠ NULL).
     * Non-admin users saw 0 invoices.
     */
    if (req.user.role !== "admin") {
      where += " AND c.assigned_to = ?";
      params.push(req.user.id);                 // ✅ FIXED: req.user.id
    }

    if (search) {
      where += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (status)     { where += " AND i.status = ?";      params.push(status); }
    if (customerId) { where += " AND i.customer_id = ?"; params.push(customerId); }
    if (isRecurring !== undefined) {
      where += " AND i.is_recurring = ?";
      params.push(isRecurring === "true" ? 1 : 0);
    }
    if (dueDateFrom) { where += " AND i.due_date >= ?"; params.push(dueDateFrom); }
    if (dueDateTo)   { where += " AND i.due_date <= ?"; params.push(dueDateTo); }

    const [invoices] = await pool.execute(
      `SELECT i.*,
              c.name    AS customer_name,
              c.company AS customer_company,
              c.email   AS customer_email,
              c.phone   AS customer_phone
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      sanitize(...params)
    );

    if (invoices.length > 0) {
      const ids          = invoices.map((i) => i.id);
      const placeholders = ids.map(() => "?").join(",");
      const [allItems]   = await pool.execute(
        `SELECT * FROM invoice_items WHERE invoice_id IN (${placeholders}) ORDER BY created_at`,
        sanitize(...ids)
      );
      invoices.forEach((inv) => {
        inv.items = allItems.filter((it) => it.invoice_id === inv.id);
      });
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${where}`,
      sanitize(...params)
    );

    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

    res.json({
      invoices,
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    });
  } catch (err) {
    console.error("Invoices fetch error:", err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get("/stats/overview", authenticateToken, async (req, res) => {
  try {
    let where    = "WHERE 1=1";
    const params = [];

    /**
     * FIX (Bug C-1): was req.user.userId.
     * Non-admin stats queries matched nothing.
     */
    if (req.user.role !== "admin") {
      where += " AND c.assigned_to = ?";
      params.push(req.user.id);                 // ✅ FIXED: req.user.id
    }

    const [statusStats] = await pool.execute(
      `SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} GROUP BY i.status`,
      sanitize(...params)
    );

    const [monthly] = await pool.execute(
      `SELECT DATE_FORMAT(i.created_at, '%Y-%m') AS month,
              COUNT(*) AS count,
              COALESCE(SUM(i.total), 0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month`,
      sanitize(...params)
    );

    const [[overdue]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.status IN ('sent','overdue') AND i.due_date < CURDATE()`,
      sanitize(...params)
    );

    const [[recurring]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.is_recurring = 1`,
      sanitize(...params)
    );

    res.json({ statusBreakdown: statusStats, monthlyTrend: monthly, overdue, recurring });
  } catch (err) {
    console.error("Invoice stats error:", err);
    res.status(500).json({ error: "Failed to fetch invoice statistics" });
  }
});

// ─── DOWNLOAD PDF ─────────────────────────────────────────────────────────────

router.post("/:id/download", async (req, res) => {
  try {
    const { id }          = req.params;
    const logoBase64      = req.body?.logoBase64 ?? null;

    const [invRows] = await pool.execute(
      `SELECT i.*,
              c.name    AS customername,
              c.email   AS customeremail,
              c.phone   AS customerphone,
              c.company AS customercompany,
              c.address AS customeraddress,
              c.city    AS customercity,
              c.state   AS customerstate,
              c.country AS customercountry
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.id = ?`,
      sanitize(id)
    );

    if (!invRows || invRows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitize(id)
    );

    const inv       = invRows[0];
    const subtotal  = Number(inv.amount || 0);
    const gstRate   = Number(inv.tax    || 18);
    const gstAmount = (subtotal * gstRate) / 100;
    const totalAmt  = Number(inv.total  || subtotal + gstAmount);

    const fmtDate = (value) => {
      if (!value) return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return fmtDate(null);
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const fmtCurrency = (n) => `Rs. ${Number(n).toFixed(2)}`;

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${inv.invoice_number || "NA"}.pdf`);
    doc.pipe(res);

    const brandPrimary   = "#0F4C81";
    const brandSecondary = "#1E88E5";
    const accentTeal     = "#00897B";
    const accentGold     = "#F9A825";
    const textDark       = "#1A2332";
    const textGray       = "#64748B";
    const bgLight        = "#F8FAFC";
    const borderGray     = "#E2E8F0";

    const PAGE_W = 595.28;
    const ML     = 40;
    const MR     = 40;
    const CW     = PAGE_W - ML - MR;

    let y = 40;

    if (logoBase64) {
      try {
        const imgData = logoBase64.includes(",") ? logoBase64.split(",")[1] : logoBase64;
        doc.image(Buffer.from(imgData, "base64"), ML, y, { width: 140, fit: [140, 55] });
      } catch (e) { console.error("Logo error:", e); }
    }

    doc.fontSize(18).font("Helvetica-Bold").fillColor(brandPrimary)
       .text("Renalease", PAGE_W - MR - 160, y + 4, { align: "right", width: 160 });
    doc.fontSize(8.5).font("Helvetica").fillColor(textGray)
       .text("Kidney Care & Nephrology Services", PAGE_W - MR - 160, y + 26, { align: "right", width: 160 });

    y += 65;
    doc.rect(ML, y, CW, 34).fillAndStroke(brandPrimary, brandPrimary);
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#FFFFFF")
       .text("TAX INVOICE", ML, y + 8, { align: "center", width: CW });
    y += 44;

    doc.rect(ML, y, CW, 26).fillAndStroke(bgLight, borderGray);

    const metaItems = [
      { label: "Invoice No", value: inv.invoice_number || "—" },
      { label: "Issue Date",  value: fmtDate(inv.issue_date || inv.created_at) },
      { label: "Due Date",    value: fmtDate(inv.due_date) },
      { label: "Status",      value: (inv.status || "draft").toUpperCase() },
    ];

    const metaColW = CW / metaItems.length;
    metaItems.forEach((m, i) => {
      const mx = ML + i * metaColW;
      doc.fontSize(7).font("Helvetica-Bold").fillColor(textGray)
         .text(m.label, mx + 6, y + 5, { width: metaColW - 8 });
      doc.fontSize(8).font("Helvetica-Bold")
         .fillColor(m.label === "Status" ? accentTeal : textDark)
         .text(m.value, mx + 6, y + 14, { width: metaColW - 8 });
    });
    y += 36;

    const halfW  = (CW - 12) / 2;
    const fromX  = ML;
    const toX    = ML + halfW + 12;
    const blockY = y;

    doc.rect(fromX, blockY, halfW, 90).fillAndStroke(bgLight, borderGray);
    doc.fontSize(8).font("Helvetica-Bold").fillColor(brandPrimary).text("FROM", fromX + 8, blockY + 8);
    doc.fontSize(9).font("Helvetica-Bold").fillColor(textDark)
       .text("Vasify Technologies Pvt. Ltd.", fromX + 8, blockY + 20);
    doc.fontSize(7.5).font("Helvetica").fillColor(textGray)
       .text(
         "102, Dani Sanjay Apartment, Datta Mandir Road,\nDahanukar Wadi, Kandivali West,\nMumbai, Maharashtra – 400067\nPhone: +91-9769754446",
         fromX + 8, blockY + 34,
         { width: halfW - 16, lineGap: 2 }
       );

    doc.rect(toX, blockY, halfW, 90).fillAndStroke("#EEF7FF", brandSecondary);
    doc.fontSize(8).font("Helvetica-Bold").fillColor(brandSecondary).text("BILL TO", toX + 8, blockY + 8);
    doc.fontSize(9.5).font("Helvetica-Bold").fillColor(textDark)
       .text(inv.customername || "Patient Name", toX + 8, blockY + 20);

    let toY = blockY + 35;
    const toDetails = [
      inv.customercompany,
      inv.customeremail ? `Email: ${inv.customeremail}` : null,
      inv.customerphone ? `Phone: ${inv.customerphone}` : null,
      [inv.customeraddress, inv.customercity, inv.customerstate, inv.customercountry].filter(Boolean).join(", ") || null,
    ].filter(Boolean);

    toDetails.forEach((line) => {
      doc.fontSize(7.5).font("Helvetica").fillColor(textGray).text(line, toX + 8, toY, { width: halfW - 16 });
      toY += 12;
    });

    y = blockY + 100;

    const colSr   = { x: ML,             w: 35 };
    const colDesc = { x: ML + 35,        w: CW - 35 - 100 };
    const colAmt  = { x: ML + CW - 100,  w: 100 };

    doc.rect(ML, y, CW, 24).fillAndStroke(brandPrimary, brandPrimary);
    [
      { label: "Sr.",                   x: colSr.x,   w: colSr.w,   align: "center" },
      { label: "Service / Description", x: colDesc.x + 6, w: colDesc.w - 12, align: "left" },
      { label: "Amount (Rs.)",          x: colAmt.x,  w: colAmt.w,  align: "right" },
    ].forEach(({ label, x, w, align }) => {
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#FFFFFF").text(label, x, y + 8, { width: w, align });
    });
    y += 24;

    const tableRows = items.length > 0 ? items : [{ description: "Medical Service Charges", amount: subtotal }];

    tableRows.forEach((item, idx) => {
      const rowH = 24;
      if (idx % 2 === 1) doc.rect(ML, y, CW, rowH).fill("#F8FBFF");

      doc.fontSize(8).font("Helvetica").fillColor(textDark)
         .text(String(idx + 1), colSr.x, y + 8, { width: colSr.w, align: "center" });
      doc.fontSize(8).font("Helvetica").fillColor(textDark)
         .text(item.description || "Medical Service", colDesc.x + 6, y + 8, { width: colDesc.w - 12 });
      doc.fontSize(8).font("Helvetica-Bold").fillColor(textDark)
         .text(Number(item.amount || 0).toFixed(2), colAmt.x, y + 8, { width: colAmt.w, align: "right" });

      y += rowH;

      let breakdown = null;
      try {
        breakdown = typeof item.breakdown === "string" ? JSON.parse(item.breakdown) : item.breakdown;
      } catch { breakdown = null; }

      if (Array.isArray(breakdown) && breakdown.length > 0) {
        breakdown.forEach((b) => {
          doc.fontSize(7).font("Helvetica").fillColor(textGray)
             .text(`  • ${b.label || ""}`, colDesc.x + 12, y + 4, { width: colDesc.w - 18 });
          doc.fontSize(7).font("Helvetica").fillColor(textGray)
             .text(Number(b.amount || 0).toFixed(2), colAmt.x, y + 4, { width: colAmt.w, align: "right" });
          y += 13;
        });
      }

      doc.moveTo(ML, y).lineTo(ML + CW, y).strokeColor(borderGray).lineWidth(0.5).stroke();
      y += 8;
    });

    y += 6;

    const totX = ML + CW - 220;
    const valX = ML + CW - 90;
    const totW = 220;
    const valW = 90;

    const drawTotalRow = (label, value, bold = false, bg = null, textCol = textDark) => {
      if (bg) { doc.rect(totX - 6, y - 2, totW + valW + 6, 22).fill(bg); }
      doc.fontSize(bold ? 10 : 9).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(textCol)
         .text(label, totX, y + (bold ? 4 : 5), { width: totW });
      doc.fontSize(bold ? 10 : 9).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(textCol)
         .text(value, valX, y + (bold ? 4 : 5), { width: valW, align: "right" });
      y += bold ? 26 : 18;
    };

    drawTotalRow("Subtotal (before GST)",               fmtCurrency(subtotal));
    drawTotalRow(`GST @ ${gstRate}% (on total amount)`, fmtCurrency(gstAmount), false, null, accentGold);
    doc.moveTo(totX - 6, y - 2).lineTo(ML + CW, y - 2).strokeColor(borderGray).lineWidth(1).stroke();
    drawTotalRow("TOTAL PAYABLE (incl. GST)", fmtCurrency(totalAmt), true, "#EEF2FF", brandPrimary);

    y += 8;

    if (inv.is_recurring) {
      const freq   = inv.recurring_frequency || "monthly";
      const cycles = inv.recurring_cycles    || "—";
      const start  = inv.recurring_start_date ? fmtDate(inv.recurring_start_date) : "—";

      doc.rect(ML, y, CW, 28).fillAndStroke("#EDF7F6", accentTeal);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(accentTeal).text("♻  RECURRING BILLING", ML + 8, y + 6);
      doc.fontSize(7.5).font("Helvetica").fillColor(textGray)
         .text(
           `This is a recurring invoice (${freq.charAt(0).toUpperCase() + freq.slice(1)}). Cycle ${cycles} starting ${start}.`,
           ML + 8, y + 16,
           { width: CW - 16 }
         );
      y += 36;
    }

    y += 4;
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor(textDark).text("Bank Details", ML, y);
    y += 13;

    [
      "Account Name : Vasify Technologies Pvt. Ltd.",
      "Bank         : Axis Bank, M.G. Road, Kandivali West Branch",
      "Account No   : 924020018276663",
      "IFSC         : UTIB0001578",
    ].forEach((line) => {
      doc.fontSize(8).font("Helvetica").fillColor(textGray).text(line, ML, y);
      y += 12;
    });

    if (inv.notes && String(inv.notes).trim()) {
      y += 6;
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor(textDark).text("Notes", ML, y);
      y += 13;
      doc.fontSize(8).font("Helvetica").fillColor(textGray)
         .text(String(inv.notes).trim(), ML, y, { width: CW, lineGap: 2 });
    }

    const footerY = 775;
    doc.rect(ML, footerY - 8, CW, 1).fill(borderGray);
    doc.fontSize(8).font("Helvetica").fillColor(textGray)
       .text(
         "Thank you for trusting Renalease with your care. For queries, contact: +91-9769754446 | www.renalease.com",
         ML, footerY,
         { align: "center", width: CW }
       );
    doc.fontSize(7).fillColor("#9CA3AF")
       .text(
         `Generated on ${new Date().toLocaleDateString("en-IN")} | This is a computer-generated invoice.`,
         ML, footerY + 12,
         { align: "center", width: CW }
       );

    doc.end();
  } catch (err) {
    console.error("PDF generation error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ─── CREATE INVOICE ───────────────────────────────────────────────────────────

router.post(
  "/",
  authenticateToken,
  [
    body("customerId").notEmpty().withMessage("Customer ID is required"),
    body("items").isArray({ min: 1 }).withMessage("Items array is required"),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const {
        customerId, items, isRecurring, recurringFrequency,
        recurringCycles, recurringStartDate, recurringEndDate,
      } = req.body;

      const [customers] = await connection.execute(
        "SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?",
        sanitize(customerId)
      );
      if (!customers.length) {
        await connection.rollback(); connection.release();
        return res.status(400).json({ error: "Customer not found" });
      }

      const customer = customers[0];

      /**
       * FIX (Bug C-2): was req.user.userId — non-admins always got 403 on
       * invoice creation because undefined !== customer.assigned_to.
       */
      if (req.user.role !== "admin" && customer.assigned_to !== req.user.id) {
        await connection.rollback(); connection.release();      // ✅ FIXED: req.user.id
        return res.status(403).json({ error: "No permission to invoice this customer" });
      }

      const subtotal  = req.body.amount !== undefined
        ? Number(req.body.amount)
        : items.reduce((s, i) => s + Number(i.amount || 0), 0);
      const taxRate   = req.body.tax   !== undefined ? Number(req.body.tax)   : Number(customer.default_tax_rate || 0);
      const gstAmt    = (subtotal * taxRate) / 100;
      const total     = req.body.total !== undefined ? Number(req.body.total) : subtotal + gstAmt;
      const status    = req.body.status || "draft";
      const issueDate = req.body.issueDate ? toSqlDate(req.body.issueDate) : toSqlDate(new Date());
      const dueDate   = req.body.dueDate
        ? toSqlDate(req.body.dueDate)
        : (() => { const d = new Date(); d.setDate(d.getDate() + Number(customer.default_due_days || 30)); return toSqlDate(d); })();
      const notes = req.body.notes ?? customer.default_invoice_notes ?? null;

      const invoiceNumber = await generateRNLNumber(connection);
      const invoiceId     = uuidv4();

      await connection.execute(
        `INSERT INTO invoices
           (id, customer_id, invoice_number, amount, tax, total, status,
            issue_date, due_date, notes,
            is_recurring, recurring_frequency, recurring_cycles,
            recurring_start_date, recurring_end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sanitize(
          invoiceId, customerId, invoiceNumber, subtotal, taxRate, total, status,
          issueDate, dueDate, notes,
          isRecurring ? 1 : 0,
          recurringFrequency || null,
          recurringCycles    ? Number(recurringCycles) : null,
          recurringStartDate ? toSqlDate(recurringStartDate) : null,
          recurringEndDate   ? toSqlDate(recurringEndDate)   : null
        )
      );

      for (const item of items) {
        await connection.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, breakdown)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          sanitize(
            uuidv4(), invoiceId,
            item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
            item.breakdown ? JSON.stringify(item.breakdown) : null
          )
        );
      }

      await connection.commit();

      const [[created]] = await connection.execute(
        `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
         FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
        sanitize(invoiceId)
      );
      const [createdItems] = await connection.execute(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
        sanitize(invoiceId)
      );
      created.items = createdItems;

      res.status(201).json({ message: "Invoice created successfully", invoice: created });
    } catch (err) {
      await connection.rollback();
      console.error("Invoice creation error:", err);
      res.status(500).json({ error: "Failed to create invoice", details: err.message });
    } finally {
      connection.release();
    }
  }
);

// ─── UPDATE INVOICE ───────────────────────────────────────────────────────────

router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  const access = await canAccessInvoice(req, res, id);
  if (!access.ok) return;

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const [existing] = await connection.execute(
      "SELECT id FROM invoices WHERE id = ?",
      sanitize(id)
    );
    if (!existing.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({ error: "Invoice not found" });
    }

    const updateData = { ...req.body };

    if (updateData.status === "paid" && !updateData.paidDate) {
      updateData.paidDate = toSqlDate(new Date());
    }
    if (updateData.dueDate)            updateData.dueDate            = toSqlDate(updateData.dueDate);
    if (updateData.issueDate)          updateData.issueDate          = toSqlDate(updateData.issueDate);
    if (updateData.paidDate)           updateData.paidDate           = toSqlDate(updateData.paidDate);
    if (updateData.recurringStartDate) updateData.recurringStartDate = toSqlDate(updateData.recurringStartDate);
    if (updateData.recurringEndDate)   updateData.recurringEndDate   = toSqlDate(updateData.recurringEndDate);

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (key === "items" || value === undefined) continue;
      const dbField = invoiceFieldMap[key];
      if (!dbField) continue;
      const dbVal = key === "isRecurring" ? (value ? 1 : 0) : value;
      fields.push(`${dbField} = ?`);
      values.push(dbVal);
    }

    if (fields.length > 0) {
      values.push(id);
      await connection.execute(
        `UPDATE invoices SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitize(...values)
      );
    }

    if (Array.isArray(updateData.items)) {
      await connection.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
      for (const item of updateData.items) {
        await connection.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, breakdown)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          sanitize(
            uuidv4(), id,
            item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
            item.breakdown ? JSON.stringify(item.breakdown) : null
          )
        );
      }
    }

    await connection.commit();

    const [[updated]] = await connection.execute(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
      sanitize(id)
    );
    const [updatedItems] = await connection.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitize(id)
    );
    updated.items = updatedItems;

    res.json({ message: "Invoice updated successfully", invoice: updated });
  } catch (err) {
    await connection.rollback();
    console.error("Invoice update error:", err);
    res.status(500).json({ error: "Failed to update invoice" });
  } finally {
    connection.release();
  }
});

// ─── DELETE INVOICE ───────────────────────────────────────────────────────────

router.delete("/:id", authenticateToken, async (req, res) => {
  const { id }  = req.params;
  const access  = await canAccessInvoice(req, res, id);
  if (!access.ok) return;

  try {
    const [existing] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
    if (!existing.length) return res.status(404).json({ error: "Invoice not found" });

    await pool.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
    await pool.execute("DELETE FROM invoices WHERE id = ?", sanitize(id));
    res.json({ message: "Invoice deleted successfully" });
  } catch (err) {
    console.error("Invoice delete error:", err);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

module.exports = router;