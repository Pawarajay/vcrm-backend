

// services/whatsapp.js
// Shared WhatsApp messaging helpers — used by webhook and campaign routes
//
// FIX LOG:
//  [F4]  sendText is the single source of truth for plain-text sending
//  [F12] Headers rebuilt per-request so runtime env changes are picked up
//  [F16] sendInteractiveList: removed `header` field — AOC portal rejects it on
//        list messages causing a silent failure; header text folded into body instead
//  [F17] All send functions now log full JSON response on success AND failure
//        so AOC rejection reasons are visible in server logs

"use strict";

const axios = require("axios");

const WHATSAPP_API_URL = "https://api.aoc-portal.com/v1/whatsapp";

/** Rebuild headers each call so runtime env changes take effect immediately */
function buildHeaders() {
  return { apikey: process.env.WHATSAPP_API_TOKEN || "" };
}

function getFromNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || "";
}

function credentialsPresent() {
  const token = process.env.WHATSAPP_API_TOKEN;
  const from  = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !from) {
    console.warn("[WhatsApp] ⚠️  WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set");
    return false;
  }
  return true;
}

// ─── Plain Text ───────────────────────────────────────────────────────────────

/**
 * Send a plain text message via AOC portal.
 * @param {string} to   - recipient phone (e.g. 919876543210)
 * @param {string} text - message body
 * @returns {Promise<boolean>}
 */
async function sendText(to, text) {
  if (!credentialsPresent()) return false;

  const payload = {
    recipient_type: "individual",
    from:           getFromNumberId(),
    to,
    type:           "text",
    text:           { body: text },
  };

  try {
    const res = await axios.post(WHATSAPP_API_URL, payload, {
      headers: buildHeaders(),
      timeout: 8000,
    });
    console.log(`[WhatsApp] ✅ Text sent to ${to}`, JSON.stringify(res.data));
    return true;
  } catch (err) {
    console.error(
      `[WhatsApp] ❌ Text send failed to ${to}:`,
      JSON.stringify(err.response?.data || err.message)
    );
    return false;
  }
}

// ─── Approved Template ────────────────────────────────────────────────────────

/**
 * Send an approved template message via AOC portal.
 * @param {string}   to           - recipient phone
 * @param {string}   templateName - exact name from AOC dashboard
 * @param {string}   languageCode - e.g. "en"
 * @param {string[]} parameters   - values for {{1}}, {{2}} …
 * @returns {Promise<boolean>}
 */
async function sendTemplate(to, templateName, languageCode = "en", parameters = []) {
  if (!credentialsPresent()) return false;

  const payload = {
    recipient_type: "individual",
    from:           getFromNumberId(),
    to,
    type:           "template",
    template: {
      name:     templateName,
      language: { code: languageCode },
    },
  };

  if (parameters.length > 0) {
    payload.template.components = [
      {
        type:       "body",
        parameters: parameters.map((text) => ({ type: "text", text })),
      },
    ];
  }

  try {
    const res = await axios.post(WHATSAPP_API_URL, payload, {
      headers: buildHeaders(),
      timeout: 8000,
    });
    console.log(`[WhatsApp] ✅ Template "${templateName}" sent to ${to}`, JSON.stringify(res.data));
    return true;
  } catch (err) {
    console.error(
      `[WhatsApp] ❌ Template send failed to ${to}:`,
      JSON.stringify(err.response?.data || err.message)
    );
    return false;
  }
}

// ─── Interactive List ─────────────────────────────────────────────────────────

/**
 * Send an interactive list message (up to 10 rows across sections).
 *
 * [F16] The `header` object is intentionally OMITTED from the payload.
 * The AOC portal rejects list messages that include a `header` field,
 * producing a silent HTTP error and no reply to the user — this is exactly
 * why "Book Appointment" appeared to do nothing. The header text is instead
 * prepended in bold to the body so the visual result is identical.
 *
 * @param {string} to          - recipient phone
 * @param {string} headerText  - shown as bold first line of body
 * @param {string} bodyText    - main message body
 * @param {string} buttonText  - list-open button label (max 20 chars)
 * @param {Array}  sections    - [{ title, rows: [{ id, title, description? }] }]
 * @returns {Promise<boolean>}
 */
async function sendInteractiveList(to, headerText, bodyText, buttonText, sections) {
  if (!credentialsPresent()) return false;

  // [F16] Merge header into body — no separate `header` field sent to AOC
  const fullBody = headerText
    ? `*${headerText}*\n\n${bodyText}`
    : bodyText;

  const payload = {
    recipient_type: "individual",
    from:           getFromNumberId(),
    to,
    type:           "interactive",
    interactive: {
      type:   "list",
      body:   { text: fullBody },
      action: { button: buttonText, sections },
    },
  };

  try {
    const res = await axios.post(WHATSAPP_API_URL, payload, {
      headers: buildHeaders(),
      timeout: 8000,
    });
    console.log(`[WhatsApp] ✅ Interactive list sent to ${to}`, JSON.stringify(res.data));
    return true;
  } catch (err) {
    console.error(
      `[WhatsApp] ❌ List send FAILED to ${to} — AOC response:`,
      JSON.stringify(err.response?.data || err.message)
    );
    return false;
  }
}

// ─── Interactive Buttons ──────────────────────────────────────────────────────

/**
 * Send an interactive button message (up to 3 buttons).
 * @param {string} to       - recipient phone
 * @param {string} bodyText - message body shown above buttons
 * @param {Array}  buttons  - [{ id: string, title: string }]
 * @returns {Promise<boolean>}
 */
async function sendInteractiveButtons(to, bodyText, buttons) {
  if (!credentialsPresent()) return false;

  const payload = {
    recipient_type: "individual",
    from:           getFromNumberId(),
    to,
    type:           "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((btn) => ({
          type:  "reply",
          reply: { id: btn.id, title: btn.title },
        })),
      },
    },
  };

  try {
    const res = await axios.post(WHATSAPP_API_URL, payload, {
      headers: buildHeaders(),
      timeout: 8000,
    });
    console.log(`[WhatsApp] ✅ Buttons sent to ${to}`, JSON.stringify(res.data));
    return true;
  } catch (err) {
    console.error(
      `[WhatsApp] ❌ Buttons send FAILED to ${to} — AOC response:`,
      JSON.stringify(err.response?.data || err.message)
    );
    return false;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  sendText,
  sendTemplate,
  sendInteractiveList,
  sendInteractiveButtons,
};