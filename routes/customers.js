const { v4: uuidv4 } = require("uuid");
const express = require("express");
const { body, validationResult, query } = require("express-validator");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const parseTags = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return []; }
};

// ─── Field Map (camelCase → snake_case) ───────────────────────────────────────
// FIXED: added all fields the frontend sends that were missing

const customerFieldMap = {
  name:                      "name",
  email:                     "email",
  phone:                     "phone",
  company:                   "company",
  businessType:              "business_type",        // ✅ ADDED — frontend sends this
  address:                   "address",
  city:                      "city",
  state:                     "state",
  zipCode:                   "zip_code",
  country:                   "country",
  status:                    "status",
  source:                    "source",
  tags:                      "tags",
  notes:                     "notes",
  totalValue:                "total_value",
  whatsappNumber:            "whatsapp_number",
  salesRep:                  "sales_rep",            // ✅ ADDED — frontend sends this
  onboardingDate:            "onboarding_date",      // ✅ ADDED — frontend sends this
  service:                   "service",
  // Invoice defaults
  defaultTaxRate:            "default_tax_rate",
  defaultDueDays:            "default_due_days",
  defaultInvoiceNotes:       "default_invoice_notes",
  // Recurring / retainer
  recurringEnabled:          "recurring_enabled",
  recurringInterval:         "recurring_interval",
  recurringAmount:           "recurring_amount",
  recurringService:          "recurring_service",
  renewalDate:               "renewal_date",         // ✅ FIXED — was "next_renewal_date" in old code
};

// ─── AUTO-INVOICE HELPER ──────────────────────────────────────────────────────

const createAutoInvoice = async (customerId, customer, userId) => {
  try {
    const [lastInvoice] = await pool.execute(
      "SELECT invoice_number FROM invoices ORDER BY created_at DESC LIMIT 1"
    );

    const nextNumber =
      lastInvoice.length > 0
        ? parseInt(lastInvoice[0].invoice_number.replace("INV-", ""), 10) + 1
        : 1;

    const invoiceNumber = `INV-${nextNumber.toString().padStart(3, "0")}`;

    // Race-safety: skip if number already exists
    const [existing] = await pool.execute(
      "SELECT id FROM invoices WHERE invoice_number = ?",
      sanitizeParams(invoiceNumber)
    );
    if (existing.length > 0) {
      console.warn(`Duplicate invoice number ${invoiceNumber}, skipping`);
      return null;
    }

    // Use recurringAmount first (retainer), else totalValue
    const invoiceAmount =
      Number(customer.recurring_amount) ||
      Number(customer.total_value) ||
      0;

    if (invoiceAmount === 0) {
      console.log(`Skipping auto-invoice for ${customerId} — amount is 0`);
      return null;
    }

    const taxRate  = Number(customer.default_tax_rate)  || 18;
    const dueDays  = Number(customer.default_due_days)  || 15;
    const taxAmt   = (invoiceAmount * taxRate) / 100;
    const total    = invoiceAmount + taxAmt;
    const service  = customer.recurring_service || customer.service || "Service Charges";

    const invoiceId = uuidv4();

    await pool.execute(
      `INSERT INTO invoices (
        id, customer_id, invoice_number,
        amount, tax, total,
        status, issue_date, due_date, notes
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        'draft', CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?
      )`,
      sanitizeParams(
        invoiceId, customerId, invoiceNumber,
        invoiceAmount, taxAmt, total,
        dueDays,
        customer.default_invoice_notes ||
          `Auto-generated invoice for ${service}`
      )
    );

    await pool.execute(
      `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
       VALUES (?, ?, ?, 1, ?, ?)`,
      sanitizeParams(uuidv4(), invoiceId, service, invoiceAmount, invoiceAmount)
    );

    console.log(`✅ Auto-created invoice ${invoiceNumber} for customer ${customerId}`);

    return { id: invoiceId, invoiceNumber, amount: invoiceAmount, total, status: "draft" };
  } catch (err) {
    console.error("Auto-invoice creation failed:", err);
    return null; // Never block customer creation
  }
};

// ─── GET /customers ───────────────────────────────────────────────────────────

router.get(
  "/",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("status").optional().isIn(["active", "inactive", "prospect"]),
    query("service").optional().isString(),   // ✅ ADDED — useful filter
    query("assignedTo").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const { search, status, service, assignedTo } = req.query;

      let where = "WHERE 1=1";
      const params = [];

      if (req.user.role !== "admin") {
        where += " AND c.assigned_to = ?";
        params.push(req.user.id);
      } else if (assignedTo) {
        where += " AND c.assigned_to = ?";
        params.push(assignedTo);
      }

      if (search) {
        where += " AND (c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ? OR c.phone LIKE ?)";
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      if (status)  { where += " AND c.status = ?";  params.push(status);  }
      if (service) { where += " AND c.service = ?"; params.push(service); }

      const [customers] = await pool.execute(
        `SELECT c.*, u.name AS assigned_user_name
         FROM customers c
         LEFT JOIN users u ON c.assigned_to = u.id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        sanitizeParams(...params)
      );

      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM customers c ${where}`,
        sanitizeParams(...params)
      );

      res.json({
        customers: customers.map((c) => ({ ...c, tags: parseTags(c.tags) })),
        pagination: {
          page, limit, total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      });
    } catch (err) {
      console.error("Customers fetch error:", err);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  }
);

// ─── GET /customers/:id ───────────────────────────────────────────────────────

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [customers] = await pool.execute(
      `SELECT c.*, u.name AS assigned_user_name
       FROM customers c
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE c.id = ?`,
      sanitizeParams(id)
    );

    if (!customers.length) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = { ...customers[0], tags: parseTags(customers[0].tags) };

    const [deals] = await pool.execute(
      "SELECT id, title, value, stage, probability FROM deals WHERE customer_id = ?",
      sanitizeParams(id)
    );

    const [invoices] = await pool.execute(
      `SELECT id, invoice_number, amount, tax, total, status, issue_date, due_date
       FROM invoices WHERE customer_id = ? ORDER BY created_at DESC`,
      sanitizeParams(id)
    );

    const [tasks] = await pool.execute(
      `SELECT id, title, type, status, due_date FROM tasks
       WHERE related_type = 'customer' AND related_id = ?`,
      sanitizeParams(id)
    );

    res.json({ customer, related: { deals, invoices, tasks } });
  } catch (err) {
    console.error("Customer fetch error:", err);
    res.status(500).json({ error: "Failed to fetch customer" });
  }
});

// ─── POST /customers ──────────────────────────────────────────────────────────

router.post(
  "/",
  authenticateToken,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").optional({ checkFalsy: true }).isEmail().withMessage("Valid email required"),
    // ✅ FIXED — email is optional now (frontend doesn't require it)
    body("phone").notEmpty().withMessage("Phone is required"),
    body("company").optional().isString(),
    body("businessType").optional().isString(),      // ✅ ADDED
    body("address").optional().isString(),
    body("city").optional().isString(),
    body("state").optional().isString(),
    body("zipCode").optional().isString(),
    body("country").optional().isString(),
    body("status").optional().isIn(["active", "inactive", "prospect"]),
    body("source").optional().isString(),
    body("tags").optional(),
    body("notes").optional().isString(),
    body("totalValue").optional().isNumeric(),
    body("whatsappNumber").optional().isString(),
    body("salesRep").optional().isString(),          // ✅ ADDED
    body("onboardingDate").optional().isISO8601(),   // ✅ ADDED
    body("service").optional().isString(),
    body("defaultTaxRate").optional().isNumeric(),
    body("defaultDueDays").optional().isInt(),
    body("defaultInvoiceNotes").optional().isString(),
    body("recurringEnabled").optional().isBoolean(),
    body("recurringInterval").optional().isIn(["weekly", "monthly", "quarterly", "yearly"]),
    // ✅ FIXED — added "weekly" and "quarterly" to match frontend
    body("recurringAmount").optional().isNumeric(),
    body("recurringService").optional().isString(),
    body("renewalDate").optional().isISO8601(),      // ✅ FIXED — was "nextRenewalDate"
    body("leadId").optional().isString(),
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const {
        name, email, phone, company, businessType,
        address, city, state, zipCode, country,
        status = "prospect", source, tags = [], notes,
        totalValue, whatsappNumber, salesRep, onboardingDate,
        service,
        defaultTaxRate, defaultDueDays, defaultInvoiceNotes,
        recurringEnabled, recurringInterval, recurringAmount,
        recurringService, renewalDate,
        leadId,
      } = req.body;

      const assignedTo = req.user.id;
      const id = uuidv4();

      // Auto-populate service from lead if coming from lead conversion
      let resolvedService = service;
      let resolvedNotes   = notes;
      if (leadId && !resolvedService) {
        const [lead] = await pool.execute(
          "SELECT service FROM leads WHERE id = ?",
          sanitizeParams(leadId)
        );
        if (lead.length > 0 && lead[0].service) {
          resolvedService = lead[0].service;
          resolvedNotes = resolvedNotes
            ? `${resolvedNotes}\n\n[From Lead] Service: ${resolvedService}`
            : `[From Lead] Service: ${resolvedService}`;
        }
      }

      // Duplicate email check (only if email provided)
      if (email) {
        const [existing] = await pool.execute(
          "SELECT id FROM customers WHERE email = ?",
          sanitizeParams(email)
        );
        if (existing.length > 0) {
          return res.status(400).json({ error: "A client with this email already exists" });
        }
      }

      await pool.execute(
        `INSERT INTO customers (
          id, name, email, phone, company, business_type,
          address, city, state, zip_code, country,
          status, source, assigned_to, tags, notes,
          total_value, whatsapp_number,
          sales_rep, onboarding_date,
          service,
          default_tax_rate, default_due_days, default_invoice_notes,
          recurring_enabled, recurring_interval, recurring_amount,
          recurring_service, renewal_date
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?
        )`,
        sanitizeParams(
          id, name, email || null, phone, company || null, businessType || null,
          address || null, city || null, state || null, zipCode || null, country || "India",
          status, source || null, assignedTo, JSON.stringify(tags), resolvedNotes || null,
          totalValue != null ? Number(totalValue) : 0,
          whatsappNumber || null,
          salesRep || null, onboardingDate || null,
          resolvedService || null,
          defaultTaxRate != null ? Number(defaultTaxRate) : 18,
          defaultDueDays != null ? Number(defaultDueDays) : 15,
          defaultInvoiceNotes || null,
          recurringEnabled ? 1 : 0,
          recurringInterval || "monthly",
          recurringAmount != null && recurringAmount !== "" ? Number(recurringAmount) : null,
          recurringService || null,
          renewalDate || null                          // ✅ FIXED — correct field name
        )
      );

      // Mark lead as converted if came from lead
      if (leadId) {
        await pool.execute(
          `UPDATE leads SET status = 'converted', converted_customer_id = ?, updated_at = NOW()
           WHERE id = ?`,
          sanitizeParams(id, leadId)
        );
      }

      const [[customer]] = await pool.execute(
        `SELECT c.*, u.name AS assigned_user_name
         FROM customers c LEFT JOIN users u ON c.assigned_to = u.id
         WHERE c.id = ?`,
        sanitizeParams(id)
      );
      customer.tags = parseTags(customer.tags);

      // Auto-create draft invoice
      const autoInvoice = await createAutoInvoice(id, customer, req.user.id);

      res.status(201).json({
        message: `Client created successfully${leadId ? " from lead" : ""}`,
        customer,
        invoice: autoInvoice,
      });
    } catch (err) {
      console.error("Customer creation error:", err);
      res.status(500).json({ error: "Failed to create client" });
    }
  }
);

// ─── PUT /customers/:id ───────────────────────────────────────────────────────

router.put(
  "/:id",
  authenticateToken,
  [
    body("name").optional().trim().notEmpty(),
    body("email").optional({ checkFalsy: true }).isEmail(),
    body("phone").optional().isString(),
    body("company").optional().isString(),
    body("businessType").optional().isString(),      // ✅ ADDED
    body("address").optional().isString(),
    body("city").optional().isString(),
    body("state").optional().isString(),
    body("zipCode").optional().isString(),
    body("country").optional().isString(),
    body("status").optional().isIn(["active", "inactive", "prospect"]),
    body("source").optional().isString(),
    body("tags").optional(),
    body("notes").optional().isString(),
    body("totalValue").optional().isNumeric(),
    body("whatsappNumber").optional().isString(),
    body("salesRep").optional().isString(),          // ✅ ADDED
    body("onboardingDate").optional().isISO8601(),   // ✅ ADDED
    body("service").optional().isString(),
    body("defaultTaxRate").optional().isNumeric(),
    body("defaultDueDays").optional().isInt(),
    body("defaultInvoiceNotes").optional().isString(),
    body("recurringEnabled").optional().isBoolean(),
    body("recurringInterval").optional().isIn(["weekly", "monthly", "quarterly", "yearly"]),
    body("recurringAmount").optional().isNumeric(),
    body("recurringService").optional().isString(),
    body("renewalDate").optional().isISO8601(),      // ✅ FIXED — was "nextRenewalDate"
  ],
  async (req, res) => {
    try {
      if (handleValidation(req, res)) return;

      const { id } = req.params;

      const [existing] = await pool.execute(
        "SELECT id FROM customers WHERE id = ?",
        sanitizeParams(id)
      );
      if (!existing.length) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Duplicate email check (only if email is being changed)
      if (req.body.email) {
        const [emailCheck] = await pool.execute(
          "SELECT id FROM customers WHERE email = ? AND id != ?",
          sanitizeParams(req.body.email, id)
        );
        if (emailCheck.length > 0) {
          return res.status(400).json({ error: "Email already used by another client" });
        }
      }

      const updateData = { ...req.body };

      // Coerce types
      if ("totalValue"       in updateData) updateData.totalValue       = Number(updateData.totalValue || 0);
      if ("recurringEnabled" in updateData) updateData.recurringEnabled = updateData.recurringEnabled ? 1 : 0;
      if ("recurringAmount"  in updateData) updateData.recurringAmount  = updateData.recurringAmount !== "" ? Number(updateData.recurringAmount) : null;
      if ("defaultTaxRate"   in updateData) updateData.defaultTaxRate   = Number(updateData.defaultTaxRate);
      if ("defaultDueDays"   in updateData) updateData.defaultDueDays   = Number(updateData.defaultDueDays);

      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updateData)) {
        if (value === undefined) continue;
        const col = customerFieldMap[key];
        if (!col) continue;
        fields.push(`${col} = ?`);
        values.push(key === "tags" ? JSON.stringify(value) : value);
      }

      if (!fields.length) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      values.push(id);
      await pool.execute(
        `UPDATE customers SET ${fields.join(", ")}, updated_at = NOW() WHERE id = ?`,
        sanitizeParams(...values)
      );

      const [[customer]] = await pool.execute(
        `SELECT c.*, u.name AS assigned_user_name
         FROM customers c LEFT JOIN users u ON c.assigned_to = u.id
         WHERE c.id = ?`,
        sanitizeParams(id)
      );
      customer.tags = parseTags(customer.tags);

      res.json({ message: "Client updated successfully", customer });
    } catch (err) {
      console.error("Customer update error:", err);
      res.status(500).json({ error: "Failed to update client" });
    }
  }
);

// ─── DELETE /customers/:id ────────────────────────────────────────────────────

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      "SELECT id FROM customers WHERE id = ?",
      sanitizeParams(id)
    );
    if (!existing.length) {
      return res.status(404).json({ error: "Client not found" });
    }

    const [[{ deals }]]   = await pool.execute("SELECT COUNT(*) AS deals FROM deals WHERE customer_id = ?",   sanitizeParams(id));
    const [[{ invoices }]] = await pool.execute("SELECT COUNT(*) AS invoices FROM invoices WHERE customer_id = ?", sanitizeParams(id));

    if (deals > 0 || invoices > 0) {
      return res.status(400).json({
        error: "Cannot delete client with existing deals or invoices",
        details: { deals, invoices },
      });
    }

    await pool.execute("DELETE FROM customers WHERE id = ?", sanitizeParams(id));

    res.json({ message: "Client deleted successfully", id });
  } catch (err) {
    console.error("Customer deletion error:", err);
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// ─── POST /customers/:id/move-to-lead ────────────────────────────────────────

router.post("/:id/move-to-lead", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [customers] = await pool.execute(
      "SELECT * FROM customers WHERE id = ?",
      sanitizeParams(id)
    );
    if (!customers.length) {
      return res.status(404).json({ error: "Client not found" });
    }

    const c      = customers[0];
    const leadId = uuidv4();

    await pool.execute(
      `INSERT INTO leads (
        id, name, email, phone, company, source, status, priority,
        assigned_to, estimated_value, notes, whatsapp_number, service
      ) VALUES (?, ?, ?, ?, ?, ?, 'new', 'medium', ?, ?, ?, ?, ?)`,
      sanitizeParams(
        leadId,
        c.name, c.email, c.phone, c.company,
        c.source || "manual",
        c.assigned_to,
        c.total_value || 0,
        (c.notes || "") + "\n\n[Restored from client]",
        c.whatsapp_number,
        c.service || null
      )
    );

    // Soft-delete: mark inactive (preserves invoice history)
    await pool.execute(
      "UPDATE customers SET status = 'inactive', updated_at = NOW() WHERE id = ?",
      sanitizeParams(id)
    );

    await pool.execute(
      `UPDATE tasks SET related_type = 'lead', related_id = ?
       WHERE related_type = 'customer' AND related_id = ?`,
      sanitizeParams(leadId, id)
    );

    res.json({ message: "Client moved back to leads successfully", leadId });
  } catch (err) {
    console.error("Move to lead error:", err);
    res.status(500).json({ error: "Failed to move client to leads" });
  }
});

module.exports = router;