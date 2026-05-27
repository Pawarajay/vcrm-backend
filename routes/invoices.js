
const { v4: uuidv4 }             = require("uuid");
const PDFDocument                = require("pdfkit");
const express                    = require("express");
const { body, validationResult } = require("express-validator");
const { pool }                   = require("../config/database");
const { authenticateToken }      = require("../middleware/auth");

const router = express.Router();

// ─── UTILS ────────────────────────────────────────────────────────────────────

const sanitize = (...params) => params.map((p) => (p === undefined ? null : p));

const toSqlDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

// ── Generate invoice number: INV-YYYYMM-XXXX
// If the frontend sends its own number AND it's not a duplicate, honour it.
const generateInvNumber = async (conn) => {
  const now    = new Date();
  const ym     = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `INV-${ym}-`;
  const [rows] = await conn.execute(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const seq = rows.length
    ? (parseInt(rows[0].invoice_number.split("-").pop(), 10) || 0) + 1
    : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

// camelCase → snake_case map for UPDATE (only fields that exist after migration)
const FIELD_MAP = {
  customerId:              "customer_id",
  amount:                  "amount",
  tax:                     "tax",
  gstAmount:               "gst_amount",
  total:                   "total",
  status:                  "status",
  issueDate:               "issue_date",
  dueDate:                 "due_date",
  paidDate:                "paid_date",
  notes:                   "notes",
  poNumber:                "po_number",
  terms:                   "terms",
  placeOfSupply:           "place_of_supply",
  customerName:            "customer_name_override",
  customerEmail:           "customer_email_override",
  customerPhone:           "customer_phone_override",
  customerCompany:         "customer_company_override",
  customerAddress:         "customer_address_override",
  isRecurring:             "is_recurring",
  recurringFrequency:      "recurring_frequency",
  recurringCycles:         "recurring_cycles",
  recurringStartDate:      "recurring_start_date",
  recurringEndDate:        "recurring_end_date",
};

// ─── ACCESS CONTROL ───────────────────────────────────────────────────────────

const canAccessInvoice = async (req, res, invoiceId) => {
  if (req.user.role === "admin") return { ok: true };
  const [rows] = await pool.execute(
    `SELECT i.id FROM invoices i
     INNER JOIN customers c ON i.customer_id = c.id
     WHERE i.id = ? AND c.assigned_to = ?`,
    sanitize(invoiceId, req.user.id)
  );
  if (!rows.length)
    return { ok: false, response: res.status(403).json({ error: "Access denied" }) };
  return { ok: true };
};

// ─── AMOUNT IN WORDS ──────────────────────────────────────────────────────────

function amountInWords(amount) {
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
                 "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
                 "Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function convert(n) {
    if (!n) return "";
    if (n < 20)       return ones[n] + " ";
    if (n < 100)      return tens[Math.floor(n / 10)] + " " + ones[n % 10] + " ";
    if (n < 1000)     return ones[Math.floor(n / 100)] + " Hundred " + convert(n % 100);
    if (n < 100000)   return convert(Math.floor(n / 1000))    + "Thousand " + convert(n % 1000);
    if (n < 10000000) return convert(Math.floor(n / 100000))  + "Lakh "     + convert(n % 100000);
    return               convert(Math.floor(n / 10000000)) + "Crore "    + convert(n % 10000000);
  }
  const rupees = Math.floor(amount);
  const paise  = Math.round((amount - rupees) * 100);
  let out = "Indian Rupee " + (convert(rupees).trim() || "Zero");
  if (paise) out += " and " + convert(paise).trim() + " Paise";
  return out + " Only";
}

// ─── SELECT HELPER — always use COALESCE override → live customer data ─────────

const INV_SELECT = `
  SELECT
    i.*,
    COALESCE(i.customer_name_override,    c.name)    AS customer_name,
    COALESCE(i.customer_company_override, c.company) AS customer_company,
    COALESCE(i.customer_email_override,   c.email)   AS customer_email,
    COALESCE(i.customer_phone_override,   c.phone)   AS customer_phone,
    COALESCE(
      NULLIF(i.customer_address_override, ''),
      -- Build address from parts; skip country if it already appears in address
      CONCAT_WS(', ',
        NULLIF(c.address,''),
        NULLIF(c.city,''),
        NULLIF(c.state,''),
        NULLIF(c.zip_code,''),
        -- Only append country if not already in address field
        CASE WHEN c.address IS NOT NULL AND LOWER(c.address) LIKE CONCAT('%', LOWER(IFNULL(c.country,'')), '%')
             THEN NULL ELSE NULLIF(c.country,'') END
      ))                                              AS customer_address
  FROM invoices i
  LEFT JOIN customers c ON i.customer_id = c.id
`;

// ─── PDF GENERATION ───────────────────────────────────────────────────────────
// Exactly matches Vasify Technologies sample invoice (INV-000076):
// Logo | Company header | TAX INVOICE title
// Meta box | Bill To / Ship To | Subject
// Items table (HSN/SAC, Qty, Rate, CGST%, CGST Amt, SGST%, SGST Amt, Amount)
// Totals | Amount in words | Notes | T&C | Payment details | Footer

router.post("/:id/download", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const access = await canAccessInvoice(req, res, id);
    if (!access.ok) return;

    const [invRows] = await pool.execute(
      INV_SELECT + " WHERE i.id = ?",
      sanitize(id)
    );
    if (!invRows.length) return res.status(404).json({ error: "Invoice not found" });

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitize(id)
    );

    const inv = invRows[0];

    // ── Financials: always recalculate from items when available ────────────
    // Never blindly trust inv.total/inv.amount from DB — they may be 0 or stale.
    // Re-derive subtotal from actual line items so the PDF is always accurate.
    let subtotal;
    if (items.length > 0) {
      subtotal = items.reduce((s, it) => s + Number(it.amount || 0), 0);
    } else {
      subtotal = Number(inv.amount || 0);
    }

    const gstRate  = Number(inv.tax || 18);
    const halfRate = gstRate / 2;
    const cgstAmt  = (subtotal * halfRate) / 100;
    const sgstAmt  = cgstAmt;
    // totalAmt = subtotal + GST, never use stored inv.total which may be 0
    const totalAmt  = subtotal + cgstAmt + sgstAmt;
    // balDue: 0 if paid (trim + lowercase for safe MySQL string comparison)
    const invStatus = String(inv.status || "").trim().toLowerCase();
    const balDue    = invStatus === "paid" ? 0 : totalAmt;
    const logoB64  = req.body?.logoBase64 ?? null;

    const termsLabel = {
      net_7: "Net 7", net_15: "Net 15", net_30: "Net 30",
      net_45: "Net 45", net_60: "Net 60",
    }[inv.terms] || "Due on Receipt";

    const fmtD = (v) => {
      if (!v) return "—";
      const d = new Date(v);
      return isNaN(d.getTime()) ? "—"
        : d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
    };
    const fmtN = (n) => Number(n || 0).toFixed(2);

    // ── PDFKit ────────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition",
      `attachment; filename=invoice-${inv.invoice_number || "NA"}.pdf`);
    doc.pipe(res);

    const DARK  = "#1A1A1A", GRAY = "#555555", LGRAY = "#888888";
    const BORD  = "#CCCCCC", BGH  = "#F5F5F5", BGALT = "#FAFAFA";
    const BGTOT = "#EEEEEE", BGBAL = "#E8F5E9";

    const PW = 595.28, PH = 841.89, ML = 30, MR = 30, CW = PW - ML - MR;
    let y = 30;

    // ── 1. Logo + company ─────────────────────────────────────────────────────
    if (logoB64) {
      try {
        const raw = logoB64.includes(",") ? logoB64.split(",")[1] : logoB64;
        doc.image(Buffer.from(raw, "base64"), ML, y, { fit: [120, 55] });
      } catch (e) { console.warn("Logo render:", e.message); }
    }

    const CX = ML + 130;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(DARK)
       .text("Vasify Technologies Pvt. Ltd.", CX, y, { width: CW - 130 });
    y += 14;
    doc.fontSize(7.5).font("Helvetica").fillColor(GRAY)
       .text("Axiom Milan CHS, 607, 22 Datta Mandir road\nDhanakurwadi, Kandivali West.\nMumbai Maharashtra 400067\nIndia",
         CX, y, { width: CW - 130, lineGap: 1 });
    y += 42;
    ["Company ID : U62011MH2024PTC421417","GSTIN: 27AAKCV0353N1ZW","PAN: AAKCV0353N",
     "Tax ID ::MUMV33878F","www.vasifytech.com"].forEach(l => {
      doc.fontSize(7.5).font("Helvetica").fillColor(GRAY).text(l, CX, y, { width: CW - 130 });
      y += 10;
    });

    doc.fontSize(26).font("Helvetica-Bold").fillColor(DARK)
       .text("TAX INVOICE", PW - MR - 180, 30, { align: "right", width: 180 });

    y = Math.max(y, 122) + 4;

    // ── 2. Meta box ───────────────────────────────────────────────────────────
    const MBH = 68, HW = CW / 2;
    doc.rect(ML, y, CW, MBH).stroke(BORD);
    doc.moveTo(ML + HW, y).lineTo(ML + HW, y + MBH).stroke(BORD);
    doc.moveTo(ML, y + 14).lineTo(ML + CW, y + 14).stroke(BORD);

    // Left col
    const LR = [
      ["#",            inv.invoice_number || "—"],
      ["Invoice Date",  fmtD(inv.issue_date || inv.created_at)],
      ["Terms",         termsLabel],
      ["Due Date",      fmtD(inv.due_date)],
      ["P.O.#",         inv.po_number || "—"],
    ];
    LR.forEach(([lbl, val], i) => {
      const ry = y + 16 + i * 10;
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(GRAY).text(`${lbl} :`, ML + 4, ry, { width: HW * 0.42 });
      doc.fontSize(6.5).font("Helvetica").fillColor(DARK).text(val, ML + HW * 0.44, ry, { width: HW * 0.54, lineBreak: false });
    });

    // Right col header
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(GRAY)
       .text("Place Of Supply", ML + HW + 4, y + 4, { width: 70 });
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(DARK)
       .text(`: ${inv.place_of_supply || "Maharashtra (27)"}`, ML + HW + 76, y + 4, { width: HW - 80 });

    [["#", inv.invoice_number || "—"],
     ["Invoice Date", fmtD(inv.issue_date || inv.created_at)],
     ["Terms", termsLabel],
     ["Due Date", fmtD(inv.due_date)]].forEach(([lbl, val], i) => {
      const ry = y + 16 + i * 11;
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(GRAY).text(`${lbl} :`, ML + HW + 4, ry, { width: 58 });
      doc.fontSize(6.5).font("Helvetica").fillColor(DARK).text(val, ML + HW + 64, ry, { width: HW - 68, lineBreak: false });
    });

    y += MBH + 6;

    // ── 3. Bill To / Ship To ──────────────────────────────────────────────────
    // FIX 3: customer_address already contains city/state/zip/country from
    //        CONCAT_WS in the SQL query — don't repeat those fields.
    // FIX 4: dynamically compute box height so long addresses don't overflow.

    const AW = HW - 3, SX = ML + HW + 3;

    // Clean the address: remove consecutive duplicate comma-separated segments
    // e.g. "Mumbai, Mumbai, India, India" → "Mumbai, India"
    const cleanAddress = (addr) => {
      if (!addr) return null;
      const parts = addr.split(",").map(p => p.trim()).filter(Boolean);
      const deduped = [];
      parts.forEach(p => {
        if (!deduped.length || deduped[deduped.length - 1].toLowerCase() !== p.toLowerCase()) {
          deduped.push(p);
        }
      });
      return deduped.join(", ");
    };

    const addrLines = [
      inv.customer_company ? cleanAddress(inv.customer_company) : null,
      inv.customer_address ? cleanAddress(inv.customer_address) : null,
      inv.customer_email   ? `Email: ${inv.customer_email}` : null,
      inv.customer_phone   ? `Phone: ${inv.customer_phone}` : null,
    ].filter(Boolean);

    // Wrap long address lines to estimate rendered height
    const wrapLine = (text, maxChars) => {
      if (!text || text.length <= maxChars) return [text];
      const words = text.split(" ");
      const lines = [];
      let cur = "";
      words.forEach(w => {
        if ((cur + " " + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; }
        else cur = (cur + " " + w).trim();
      });
      if (cur) lines.push(cur);
      return lines;
    };

    // At 7.5pt Helvetica in ~244px (AW-12) column, ~55 chars fit per line.
    // Must match LINE_H_SM=11, LINE_H_LG=14, BOX_TOP_PAD=18 used in drawAddrBox.
    const MAX_CHARS = 55;
    let wrappedLineCount = 0;
    addrLines.forEach(l => { if (l) wrappedLineCount += wrapLine(l, MAX_CHARS).length; });
    // 18px top pad + 14px name + 11px×lines + 10px bottom pad
    const AH = Math.max(90, 18 + 14 + wrappedLineCount * 11 + 10);

    // Draw address box with fully manual y-tracking (no doc.y dependency).
    // Every text call uses explicit absolute coordinates so boxes never
    // affect each other's cursor position.
    const LINE_H_SM = 11;   // 7.5pt line height
    const LINE_H_LG = 14;   // 9pt name line height
    const BOX_TOP_PAD = 18; // distance from box top to first content line

    const drawAddrBox = (ox, title) => {
      // Draw the box border and header
      doc.rect(ox, y, AW, AH).stroke(BORD);
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(GRAY)
         .text(title, ox + 6, y + 5, { width: AW - 12, lineBreak: false });
      doc.moveTo(ox, y + 14).lineTo(ox + AW, y + 14).stroke(BORD);

      // Track y manually — never touch doc.y here
      let ay = y + BOX_TOP_PAD;
      const maxY = y + AH - 4; // clip boundary

      // Customer name (9pt bold)
      if (ay < maxY) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK)
           .text(inv.customer_name || "—", ox + 6, ay, { width: AW - 12, lineBreak: false });
        ay += LINE_H_LG;
      }

      // Each address line — pre-wrap then draw each sub-line separately
      addrLines.forEach(l => {
        if (!l || ay >= maxY) return;
        const subLines = wrapLine(l, MAX_CHARS);
        subLines.forEach(sl => {
          if (!sl || ay >= maxY) return;
          doc.fontSize(7.5).font("Helvetica").fillColor(GRAY)
             .text(sl, ox + 6, ay, { width: AW - 12, lineBreak: false });
          ay += LINE_H_SM;
        });
      });
    };
    drawAddrBox(ML, "Bill To");
    drawAddrBox(SX, "Ship To");
    y += AH + 6;

    // ── 4. Subject line ───────────────────────────────────────────────────────
    const subject = inv.po_number || null;
    if (subject) {
      doc.rect(ML, y, CW, 22).stroke(BORD);
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(GRAY).text("Subject :", ML + 6, y + 7);
      doc.fontSize(7.5).font("Helvetica").fillColor(DARK)
         .text(subject, ML + 58, y + 7, { width: CW - 64, lineBreak: false });
      y += 28;
    }

    // ── 5. Items table ────────────────────────────────────────────────────────
    // Widths must total CW (535.28)
    const CWS = { sr:22, desc:143, hsn:42, qty:28, rate:55, cp:25, ca:45, sp:25, sa:45, amt:0 };
    CWS.amt = CW - CWS.sr - CWS.desc - CWS.hsn - CWS.qty - CWS.rate - CWS.cp - CWS.ca - CWS.sp - CWS.sa;

    const CXS = {};
    let ax = ML;
    for (const [k, w] of Object.entries(CWS)) { CXS[k] = ax; ax += w; }

    const vLines = (fy, ty) =>
      Object.values(CXS).slice(1).forEach(x => doc.moveTo(x, fy).lineTo(x, ty).stroke(BORD));

    const HDR_H = 28;
    doc.rect(ML, y, CW, HDR_H).fill(BGH).stroke(BORD);
    vLines(y, y + HDR_H);

    const cgstSpan = CWS.cp + CWS.ca, sgstSpan = CWS.sp + CWS.sa;
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(DARK)
       .text("CGST", CXS.cp, y + 3, { width: cgstSpan, align: "center" });
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(DARK)
       .text("SGST", CXS.sp, y + 3, { width: sgstSpan, align: "center" });
    doc.moveTo(CXS.cp, y + 13).lineTo(CXS.sp + sgstSpan, y + 13).stroke(BORD);

    const HL = y + 15;
    doc.fontSize(6).font("Helvetica-Bold").fillColor(DARK);
    doc.text("#",                 CXS.sr,   HL, { width: CWS.sr,        align: "center" });
    doc.text("Item & Description",CXS.desc, HL, { width: CWS.desc,      align: "left"   });
    doc.text("HSN\n/SAC",         CXS.hsn,  HL, { width: CWS.hsn,       align: "center" });
    doc.text("Qty",               CXS.qty,  HL, { width: CWS.qty,       align: "center" });
    doc.text("Rate",              CXS.rate, HL, { width: CWS.rate - 3,  align: "right"  });
    doc.text("%",                 CXS.cp,   HL, { width: CWS.cp,        align: "center" });
    doc.text("Amt",               CXS.ca,   HL, { width: CWS.ca - 3,    align: "right"  });
    doc.text("%",                 CXS.sp,   HL, { width: CWS.sp,        align: "center" });
    doc.text("Amt",               CXS.sa,   HL, { width: CWS.sa - 3,    align: "right"  });
    doc.text("Amount",            CXS.amt,  HL, { width: CWS.amt - 3,   align: "right"  });

    y += HDR_H;

    // Format rate label for item rows (same as totals)
    const fmtRate  = (r) => Number.isInteger(r) ? String(r) : r.toFixed(1).replace(/\.0$/, "");
    const rateLabel = fmtRate(halfRate);

    const tableRows = items.length
      ? items
      : [{ description: "Service Charges", quantity: 1, rate: subtotal, amount: subtotal, hsn: "" }];

    tableRows.forEach((item, idx) => {
      const ra  = Number(item.amount   || 0);
      const rq  = Number(item.quantity || 1);
      // FIX 1+5: Rate display logic
      // item.rate from DB may be 1.00 if the frontend sent qty*rate=amount but
      // rate field wasn't set correctly. When rate * qty differs significantly
      // from amount, use amount/qty as the display rate (more meaningful).
      const rawRate     = Number(item.rate) || 0;
      const derivedRate = rq > 0 ? ra / rq : ra;
      // If stored rate × qty is within 1% of amount → use stored rate
      // Otherwise the rate was likely not set correctly → derive from amount÷qty
      const rateMatchesAmount = Math.abs(rawRate * rq - ra) < Math.max(ra * 0.01, 0.01);
      const rr  = (rawRate > 0 && rateMatchesAmount) ? rawRate : derivedRate;
      const rc  = (ra * halfRate) / 100;
      const RH = 22;

      if (idx % 2 === 1) doc.rect(ML, y, CW, RH).fill(BGALT);
      doc.rect(ML, y, CW, RH).stroke(BORD);
      vLines(y, y + RH);

      const cy = y + 7;
      doc.fillColor(DARK).fontSize(7).font("Helvetica");
      doc.text(String(idx + 1),               CXS.sr,    cy, { width: CWS.sr,       align: "center" });
      doc.text(item.description || "Service", CXS.desc+3, cy, { width: CWS.desc - 6 });
      doc.text(item.hsn || "998313",          CXS.hsn,   cy, { width: CWS.hsn,      align: "center" });
      doc.text(String(rq),                    CXS.qty,   cy, { width: CWS.qty,      align: "center" });
      doc.text(fmtN(rr),                      CXS.rate,  cy, { width: CWS.rate - 3, align: "right"  });
      doc.text(`${rateLabel}%`,              CXS.cp,    cy, { width: CWS.cp,       align: "center" });
      doc.text(fmtN(rc),                      CXS.ca,    cy, { width: CWS.ca - 3,   align: "right"  });
      doc.text(`${rateLabel}%`,              CXS.sp,    cy, { width: CWS.sp,       align: "center" });
      doc.text(fmtN(rc),                      CXS.sa,    cy, { width: CWS.sa - 3,   align: "right"  });
      doc.font("Helvetica-Bold")
         .text(fmtN(ra),                      CXS.amt,   cy, { width: CWS.amt - 3,  align: "right"  });

      y += RH;
    });

    y += 8;

    // ── 6. Totals block ───────────────────────────────────────────────────────
    // Wider label column so "CGST9.0 (9.0%)" etc. doesn't clip
    const TW = 205, TX = ML + CW - TW, LW = 120, VX = TX + LW, VW = TW - LW - 4;

    const totRow = (lbl, val, bold = false, bg = null) => {
      if (bg) doc.rect(TX, y, TW, 18).fill(bg);
      doc.rect(TX, y, TW, 18).stroke(BORD);
      doc.moveTo(VX, y).lineTo(VX, y + 18).stroke(BORD);
      const sz = bold ? 8.5 : 8, fn = bold ? "Helvetica-Bold" : "Helvetica";
      doc.fontSize(sz).font(fn).fillColor(DARK).text(lbl, TX + 3, y + 4, { width: LW - 3 });
      doc.fontSize(sz).font(fn).fillColor(DARK).text(val, VX + 2, y + 4, { width: VW, align: "right" });
      y += 18;
    };

    totRow("Sub Total",                                fmtN(subtotal));
    totRow(`CGST${rateLabel} (${rateLabel}%)`,         fmtN(cgstAmt));
    totRow(`SGST${rateLabel} (${rateLabel}%)`,         fmtN(sgstAmt));
    totRow("Total",      `Rs. ${fmtN(totalAmt)}`,      true, BGTOT);
    totRow("Balance Due",`Rs. ${fmtN(balDue)}`,        true, BGBAL);

    y += 10;

    // ── 7. Amount in words + Notes ────────────────────────────────────────────
    const LCW = CW * 0.62;
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK).text("Total In Words", ML, y);
    y += 12;
    doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(DARK)
       .text(amountInWords(totalAmt), ML, y, { width: LCW });
    y += 16;
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK).text("Notes", ML, y);
    y += 11;
    ["Thanks for your business.",
     "VASIFY TECHNOLOGIES PRIVATE LIMITED",
     "www.vasifytech.com  |  UIN : U62011MH2024PTC421417"].forEach(l => {
      doc.fontSize(7.5).font("Helvetica").fillColor(GRAY).text(l, ML, y, { width: LCW });
      y += 10;
    });
    y += 14;

    // ── 8. Terms & Conditions ─────────────────────────────────────────────────
    doc.moveTo(ML, y).lineTo(ML + CW, y).stroke(BORD);
    y += 7;
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK).text("Terms & Conditions", ML, y);
    y += 12;
    ["1. Payment due within 5 days of the invoice date.",
     "2. Invoice disputes must be communicated within 15 days of the invoice date.",
     "3. Contact us at sales@vasifytech.com for any payment-related inquiries."].forEach(t => {
      doc.fontSize(7).font("Helvetica").fillColor(GRAY).text(t, ML, y, { width: LCW });
      y += 10;
    });
    y += 8;

    // ── 9. Payment details ────────────────────────────────────────────────────
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK).text("Payment details :", ML, y);
    y += 12;
    ["Vasify Technologies Pvt. Ltd.",
     "UPI ID : vasifytechnologiesprivateli2529@aubank",
     "Ac number 2502267573096282",
     "Customer ID 39818327",
     "IFSC code AUBL0002675",
     "Au bank swift code :-AUBLINBBXXX",
     "BRANCH NAME KANDIVALI MAHAVIR NAGAR"].forEach(l => {
      doc.fontSize(7).font("Helvetica").fillColor(GRAY).text(l, ML, y, { width: LCW });
      y += 10;
    });

    // ── 10. Footer ────────────────────────────────────────────────────────────
    const FY = PH - 36;
    doc.moveTo(ML, FY - 4).lineTo(ML + CW, FY - 4).stroke(BORD);
    doc.fontSize(7).font("Helvetica").fillColor(LGRAY)
       .text("This electronically generated invoice does not necessitate a signature.",
         ML + CW * 0.5, FY, { width: CW * 0.5, align: "right" });
    doc.fontSize(7).font("Helvetica").fillColor(LGRAY)
       .text(`Generated on ${new Date().toLocaleDateString("en-IN")} | Vasify Technologies Pvt. Ltd.`,
         ML, FY + 12, { align: "center", width: CW });

    doc.end();
  } catch (err) {
    console.error("PDF error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ─── GET ALL ──────────────────────────────────────────────────────────────────

router.get("/", authenticateToken, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const { search, status, customerId, isRecurring, dueDateFrom, dueDateTo } = req.query;

    let where = "WHERE 1=1";
    const p   = [];

    if (req.user.role !== "admin") { where += " AND c.assigned_to = ?"; p.push(req.user.id); }
    if (search) {
      where += " AND (i.invoice_number LIKE ? OR COALESCE(i.customer_name_override,c.name) LIKE ?)";
      p.push(`%${search}%`, `%${search}%`);
    }
    if (status)       { where += " AND i.status = ?";       p.push(status); }
    if (customerId)   { where += " AND i.customer_id = ?";  p.push(customerId); }
    if (isRecurring !== undefined) {
      where += " AND i.is_recurring = ?";
      p.push(isRecurring === "true" ? 1 : 0);
    }
    if (dueDateFrom) { where += " AND i.due_date >= ?"; p.push(dueDateFrom); }
    if (dueDateTo)   { where += " AND i.due_date <= ?"; p.push(dueDateTo); }

    const [invoices] = await pool.execute(
      `${INV_SELECT} ${where} ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      sanitize(...p)
    );

    if (invoices.length) {
      const ids  = invoices.map(i => i.id);
      const ph   = ids.map(() => "?").join(",");
      const [all] = await pool.execute(
        `SELECT * FROM invoice_items WHERE invoice_id IN (${ph}) ORDER BY created_at`,
        sanitize(...ids)
      );
      invoices.forEach(inv => { inv.items = all.filter(it => it.invoice_id === inv.id); });
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${where}`,
      sanitize(...p)
    );

    res.json({
      invoices,
      pagination: {
        page, limit, total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error("Invoices fetch:", err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get("/stats/overview", authenticateToken, async (req, res) => {
  try {
    let where = "WHERE 1=1";
    const p   = [];
    if (req.user.role !== "admin") { where += " AND c.assigned_to = ?"; p.push(req.user.id); }

    const [statusStats] = await pool.execute(
      `SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${where} GROUP BY i.status`,
      sanitize(...p)
    );
    const [monthly] = await pool.execute(
      `SELECT DATE_FORMAT(i.created_at,'%Y-%m') AS month, COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month`,
      sanitize(...p)
    );
    const [[overdue]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.status IN ('sent','overdue','pending') AND i.due_date < CURDATE()`,
      sanitize(...p)
    );
    const [[recurring]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i.total),0) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${where} AND i.is_recurring = 1`,
      sanitize(...p)
    );

    res.json({ statusBreakdown: statusStats, monthlyTrend: monthly, overdue, recurring });
  } catch (err) {
    console.error("Stats:", err);
    res.status(500).json({ error: "Failed to fetch invoice statistics" });
  }
});

// ─── GET SINGLE ───────────────────────────────────────────────────────────────

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await canAccessInvoice(req, res, id);
    if (!access.ok) return;

    const [[inv]] = await pool.execute(INV_SELECT + " WHERE i.id = ?", sanitize(id));
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at", sanitize(id)
    );
    inv.items = items;
    res.json({ invoice: inv });
  } catch (err) {
    console.error("Get invoice:", err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

router.post(
  "/",
  authenticateToken,
  [
    body("customerId").notEmpty().withMessage("Customer ID is required"),
    body("items").isArray({ min: 1 }).withMessage("At least one item is required"),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const {
        customerId, items,
        isRecurring, recurringFrequency, recurringCycles,
        recurringStartDate, recurringEndDate,
        customerName, customerEmail, customerPhone, customerCompany, customerAddress,
        poNumber, terms, placeOfSupply,
      } = req.body;

      // Validate customer
      const [custs] = await conn.execute(
        `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes
         FROM customers WHERE id = ?`,
        sanitize(customerId)
      );
      if (!custs.length) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ error: "Customer not found" });
      }
      const cust = custs[0];
      if (req.user.role !== "admin" && cust.assigned_to !== req.user.id) {
        await conn.rollback(); conn.release();
        return res.status(403).json({ error: "No permission to invoice this customer" });
      }

      // Financials
      const subtotal  = req.body.amount !== undefined
        ? Number(req.body.amount)
        : items.reduce((s, i) => s + Number(i.amount || 0), 0);
      const taxRate   = req.body.tax !== undefined ? Number(req.body.tax) : Number(cust.default_tax_rate || 18);
      const gstAmt    = (subtotal * taxRate) / 100;
      const total     = req.body.total !== undefined ? Number(req.body.total) : subtotal + gstAmt;
      const status    = req.body.status || "draft";
      const issueDate = toSqlDate(req.body.issueDate || new Date());
      const dueDate   = toSqlDate(req.body.dueDate   || (() => {
        const d = new Date(); d.setDate(d.getDate() + Number(cust.default_due_days || 5)); return d;
      })());
      const notes = req.body.notes ?? cust.default_invoice_notes ?? null;

      // Invoice number: use supplied if valid & unique, else auto-generate
      let invNum = String(req.body.invoiceNumber || "").trim();
      if (invNum) {
        const [dup] = await conn.execute(
          "SELECT id FROM invoices WHERE invoice_number = ?", sanitize(invNum)
        );
        if (dup.length) invNum = await generateInvNumber(conn);
      } else {
        invNum = await generateInvNumber(conn);
      }

      const invoiceId = uuidv4();

      await conn.execute(
        `INSERT INTO invoices
           (id, customer_id, invoice_number, amount, tax, gst_amount, total, status,
            issue_date, due_date, notes,
            po_number, terms, place_of_supply,
            customer_name_override, customer_email_override,
            customer_phone_override, customer_company_override, customer_address_override,
            is_recurring, recurring_frequency, recurring_cycles,
            recurring_start_date, recurring_end_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sanitize(
          invoiceId, customerId, invNum, subtotal, taxRate, gstAmt, total, status,
          issueDate, dueDate, notes,
          poNumber        || null,
          terms           || "due_on_receipt",
          placeOfSupply   || "Maharashtra (27)",
          customerName    || null,
          customerEmail   || null,
          customerPhone   || null,
          customerCompany || null,
          customerAddress || null,
          isRecurring ? 1 : 0,
          recurringFrequency  || null,
          recurringCycles     ? Number(recurringCycles) : null,
          recurringStartDate  ? toSqlDate(recurringStartDate) : null,
          recurringEndDate    ? toSqlDate(recurringEndDate)   : null
        )
      );

      for (const item of items) {
        await conn.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, hsn, breakdown)
           VALUES (?,?,?,?,?,?,?,?)`,
          sanitize(
            uuidv4(), invoiceId,
            item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
            item.hsn || "998313",
            item.breakdown ? JSON.stringify(item.breakdown) : null
          )
        );
      }

      await conn.commit();

      const [[created]] = await conn.execute(INV_SELECT + " WHERE i.id = ?", sanitize(invoiceId));
      const [createdItems] = await conn.execute(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at", sanitize(invoiceId)
      );
      created.items = createdItems;

      res.status(201).json({ message: "Invoice created successfully", invoice: created });
    } catch (err) {
      await conn.rollback();
      console.error("Create invoice:", err);
      res.status(500).json({ error: "Failed to create invoice", details: err.message });
    } finally {
      conn.release();
    }
  }
);

// ─── UPDATE ───────────────────────────────────────────────────────────────────

router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  // Existence check first (gives 404 not 403 for missing rows)
  const [ex] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
  if (!ex.length) return res.status(404).json({ error: "Invoice not found" });

  const access = await canAccessInvoice(req, res, id);
  if (!access.ok) return;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const data = { ...req.body };

    // Auto-set paidDate when marking paid
    if (data.status === "paid" && !data.paidDate) data.paidDate = toSqlDate(new Date());

    // Normalise dates
    ["issueDate","dueDate","paidDate","recurringStartDate","recurringEndDate"].forEach(k => {
      if (data[k]) data[k] = toSqlDate(data[k]);
    });

    const fields = [], values = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === "items" || value === undefined) continue;
      const col = FIELD_MAP[key];
      if (!col) continue;
      fields.push(`${col} = ?`);
      values.push(key === "isRecurring" ? (value ? 1 : 0) : (value === "" ? null : value));
    }

    if (fields.length) {
      await conn.execute(
        `UPDATE invoices SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        sanitize(...values, id)
      );
    }

    if (Array.isArray(data.items)) {
      await conn.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
      for (const item of data.items) {
        await conn.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount, hsn, breakdown)
           VALUES (?,?,?,?,?,?,?,?)`,
          sanitize(
            uuidv4(), id,
            item.description, item.quantity || 1, item.rate || 0, item.amount || 0,
            item.hsn || "998313",
            item.breakdown ? JSON.stringify(item.breakdown) : null
          )
        );
      }
    }

    await conn.commit();

    const [[updated]] = await conn.execute(INV_SELECT + " WHERE i.id = ?", sanitize(id));
    const [updItems]  = await conn.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at", sanitize(id)
    );
    updated.items = updItems;

    res.json({ message: "Invoice updated successfully", invoice: updated });
  } catch (err) {
    await conn.rollback();
    console.error("Update invoice:", err);
    res.status(500).json({ error: "Failed to update invoice" });
  } finally {
    conn.release();
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  const [ex] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitize(id));
  if (!ex.length) return res.status(404).json({ error: "Invoice not found" });

  const access = await canAccessInvoice(req, res, id);
  if (!access.ok) return;

  try {
    await pool.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitize(id));
    await pool.execute("DELETE FROM invoices WHERE id = ?", sanitize(id));
    res.json({ message: "Invoice deleted successfully" });
  } catch (err) {
    console.error("Delete invoice:", err);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

module.exports = router;