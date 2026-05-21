
// "use strict";

// const express        = require("express");
// const { v4: uuidv4 } = require("uuid");
// const { pool }       = require("../config/database");

// // [F5] Top-level import — never re-require inside async handlers
// const {
//   sendText,
//   sendInteractiveList,
//   sendInteractiveButtons,
// } = require("../services/whatsapp");

// const router = express.Router();

// // ─── Config ───────────────────────────────────────────────────────────────────

// // [C5] Primary admin — always receives lead alerts after every booking confirmation.
// // Stored in E.164 digits-only (no +) per AOC portal convention.
// const PRIMARY_ADMIN_NUMBER = "917039210769"; // +91 70392 10769

// // Additional numbers from env (optional, used alongside primary admin)
// const ENV_ALERT_NUMBERS = (
//   process.env.ALERT_NUMBERS || process.env.ADMIN_PHONE_NUMBER || ""
// )
//   .split(",")
//   .map((n) => n.trim())
//   .filter(Boolean);

// // Session TTL: discard sessions older than 2 hours [F6]
// const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

// // ─── Service catalogue ────────────────────────────────────────────────────────

// // [C8] All row titles are kept under 24 chars (AOC/WhatsApp hard limit).
// // A `desc` field (≤72 chars) carries the full name shown as subtitle in the list row.
// // The title that was over-limit was "HDF (Haemodialfiltration) At-home" (33 chars)
// // which silently caused the ENTIRE interactive list to be rejected by AOC, triggering
// // the plain-text fallback every time — that is the root cause of the dropdown not showing.
// const SERVICES = [
//   { id: "srv_haemo",      title: "Home Haemodialysis",  desc: "Home Haemodialysis service",         enum: "haemodialysis" },
//   { id: "srv_hdf",        title: "HDF At-home",         desc: "Haemodialfiltration at-home service", enum: "hdf"          },
//   { id: "srv_peritoneal", title: "Peritoneal Dialysis", desc: "Peritoneal Dialysis service",         enum: "peritoneal"   },
//   { id: "srv_nurse",      title: "ANM/GNM Nurse",       desc: "Nursing care at home",                enum: "nursing"      },
//   { id: "srv_other",      title: "Other Services",      desc: "Other kidney care services",          enum: "other"        },
// ];

// const SERVICE_IDS   = SERVICES.map((s) => s.id);
// const SERVICE_NAMES = SERVICES.map((s) => s.title.toLowerCase());

// // ─── City catalogue ───────────────────────────────────────────────────────────

// const CITIES = [
//   { id: "city_mumbai",    title: "Mumbai"    },
//   { id: "city_pune",      title: "Pune"      },
//   { id: "city_nashik",    title: "Nashik"    },
//   { id: "city_ahmedabad", title: "Ahmedabad" },
//   { id: "city_delhi",     title: "Delhi"     },
//   { id: "city_other",     title: "Other"     },
// ];



// const STEP_SERVICE     = 0;
// const STEP_NAME        = 1;
// const STEP_CONTACT     = 2;
// const STEP_CITY        = 3;
// const STEP_CITY_MANUAL = 4;
// const STEP_DIALYSIS    = 5;
// const STEP_CONFIRM     = 6;

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// const sanitizeParams = (...params) =>
//   params.map((p) => (p === undefined ? null : p));

// // [F9] Resolve service enum from title, id, or enum string
// function resolveServiceEnum(titleOrId) {
//   if (!titleOrId) return "other";
//   const needle = titleOrId.toLowerCase().trim();
//   const found  = SERVICES.find(
//     (s) =>
//       s.id    === titleOrId ||
//       s.enum  === needle    ||
//       s.title.toLowerCase() === needle
//   );
//   return found ? found.enum : "other";
// }

// // ─── Message send helpers ─────────────────────────────────────────────────────

// // [C7] Service interactive list (with numbered-text fallback)
// async function sendServiceList(to) {
//   const listSent = await sendInteractiveList(
//     to,
//     "🏥 Book Appointment",
//     "Please select the service you need. Our care team will guide you through the rest.",
//     "Select Service",
//     [{ title: "Our Services", rows: SERVICES.map((s) => ({ id: s.id, title: s.title, description: s.desc })) }]
//   );
//   if (!listSent) {
//     const lines = SERVICES.map((s, i) => `${i + 1}\ufe0f\u20e3  ${s.title}`).join("\n");
//     await sendText(
//       to,
//       `\ud83c\udfe5 *Book Appointment \u2014 Select a Service*\n\n` +
//       `Please reply with the *number* of the service you need:\n\n` +
//       `${lines}\n\n` +
//       `_(e.g. reply *1* for Home Haemodialysis)_`
//     );
//   }
// }

// // [F19] City interactive list (with numbered-text fallback)
// async function sendCityList(to) {
//   const listSent = await sendInteractiveList(
//     to,
//     "\ud83d\udccd Select Your City",
//     "Please select the city or area where you need our home care service:",
//     "Choose City",
//     [{ title: "Cities We Serve", rows: CITIES.map((c) => ({ id: c.id, title: c.title })) }]
//   );
//   if (!listSent) {
//     const lines = CITIES.map((c, i) => `${i + 1}\ufe0f\u20e3  ${c.title}`).join("\n");
//     await sendText(
//       to,
//       `\ud83d\udccd *Select Your City*\n\n` +
//       `Please reply with the *number* of your city:\n\n` +
//       `${lines}\n\n` +
//       `_(e.g. reply *1* for Mumbai)_`
//     );
//   }
// }

// // [C4] Dialysis Yes/No buttons (with text fallback)
// async function sendDialysisQuestion(to) {
//   const btnSent = await sendInteractiveButtons(
//     to,
//     `\ud83d\udc89 *Currently on Dialysis?*\n\n` +
//     `Is the patient currently receiving dialysis treatment at a centre or hospital?\n\n` +
//     `Please tap one of the options below:`,
//     [
//       { id: "btn_dialysis_yes", title: "Yes" },
//       { id: "btn_dialysis_no",  title: "No"  },
//     ]
//   );
//   if (!btnSent) {
//     await sendText(
//       to,
//       `\ud83d\udc89 *Currently on Dialysis?*\n\n` +
//       `Is the patient currently receiving dialysis treatment?\n\n` +
//       `Please reply *Yes* or *No*:`
//     );
//   }
// }

// // ─── Alert helpers ────────────────────────────────────────────────────────────

// // [F8][C5] Build alert number list: PRIMARY_ADMIN_NUMBER always included
// async function getAlertNumbers() {
//   let numbers = [];
//   try {
//     const [rows] = await pool.execute(
//       `SELECT alert_numbers, alerts_enabled
//        FROM whatsapp_alert_config
//        ORDER BY updated_at DESC LIMIT 1`
//     );
//     if (rows && rows.length > 0 && rows[0].alerts_enabled) {
//       const nums = typeof rows[0].alert_numbers === "string"
//         ? JSON.parse(rows[0].alert_numbers)
//         : (rows[0].alert_numbers || []);
//       if (nums.length) numbers = nums;
//     }
//   } catch { /* table may not exist yet */ }

//   if (!numbers.length) numbers = [...ENV_ALERT_NUMBERS];

//   // Always guarantee primary admin is in the list (deduplicated)
//   if (!numbers.includes(PRIMARY_ADMIN_NUMBER)) {
//     numbers = [PRIMARY_ADMIN_NUMBER, ...numbers];
//   }
//   return numbers;
// }

// // [C6] Send lead alert to admins only — explicitly skip any number that matches
// //      the customer's own phone so the alert never appears in the customer's chat.
// async function fireLeadAlerts(messageText, customerPhone) {
//   const allNumbers = await getAlertNumbers();

//   // Normalise to digits-only for reliable comparison
//   const normCustomer = (customerPhone || "").replace(/\D/g, "");

//   const adminOnlyNumbers = allNumbers.filter(
//     (num) => num.replace(/\D/g, "") !== normCustomer
//   );

//   if (!adminOnlyNumbers.length) {
//     console.warn("[WA] All alert numbers matched customer phone — no admin alert sent");
//     return;
//   }

//   const results = await Promise.allSettled(
//     adminOnlyNumbers.map((num) => sendText(num, messageText))
//   );
//   const sent   = results.filter((r) => r.status === "fulfilled" && r.value).length;
//   const failed = results.length - sent;
//   console.log(`[WA] Lead alert: ${sent} sent, ${failed} failed (customer number excluded)`);
// }

// // ─── Main Webhook ─────────────────────────────────────────────────────────────

// router.post("/", async (req, res) => {
//   console.log("[WA] Incoming webhook:", JSON.stringify(req.body, null, 2));
//   res.sendStatus(200); // ACK immediately per WhatsApp requirement
//   setImmediate(() =>
//     handleWebhook(req.body).catch((err) =>
//       console.error("[WA] Unhandled webhook error:", err)
//     )
//   );
// });

// // ─── Core handler ─────────────────────────────────────────────────────────────

// async function handleWebhook(body) {
//   // ── Validate payload ──────────────────────────────────────────────────────
//   if (!body || body.channel !== "whatsapp" || !body.messages || !body.contacts) {
//     console.log("[WA] Ignoring non-whatsapp or invalid payload");
//     return;
//   }

//   // [F1] Normalise arrays
//   const message    = Array.isArray(body.messages) ? body.messages[0] : body.messages;
//   const contactObj = Array.isArray(body.contacts) ? body.contacts[0] : body.contacts;
//   if (!message || !contactObj) { console.log("[WA] Empty messages/contacts — ignoring"); return; }

//   // [F2] Resolve sender phone
//   const from =
//     contactObj.wa_id     ||
//     contactObj.recipient ||
//     contactObj.phone     ||
//     contactObj.number    ||
//     null;
//   if (!from) { console.log("[WA] Cannot resolve sender phone — ignoring"); return; }

//   const profileName =
//     contactObj.profileName   ||
//     contactObj.profile?.name ||
//     contactObj.name          ||
//     "WhatsApp Patient";

//   // ── [F3] Robust interactive-reply extraction ──────────────────────────────
//   let userMessage = null;
//   let listReplyId = null;

//   if (message.type === "text") {
//     userMessage = message.text?.body?.trim() || null;

//   } else if (message.type === "interactive") {
//     const ia = message.interactive || {};
//     const listReply =
//       ia.list_reply || ia.text?.list_reply || ia.action?.list_reply || null;
//     const buttonReply =
//       ia.button_reply || ia.text?.button_reply || ia.action?.button_reply || null;

//     if (listReply) {
//       userMessage = listReply.title || listReply.description || null;
//       listReplyId = listReply.id || null;
//     } else if (buttonReply) {
//       userMessage = buttonReply.title || null;
//       listReplyId = buttonReply.id || null;
//     }
//   }

//   if (!userMessage) {
//     console.log(`[WA] Ignoring non-text/interactive (type=${message.type}) from ${from}`);
//     return;
//   }

//   console.log(`[WA] From: ${profileName} (${from}) → "${userMessage}" [replyId=${listReplyId}]`);

//   const syntheticEmail    = `${from.replace(/\D/g, "")}@whatsapp.renalease.local`;
//   const normalizedMessage = userMessage.toLowerCase().trim();

//   // ── [F6] Load session; auto-expire stale ones ─────────────────────────────
//   const [sessions] = await pool.execute(
//     "SELECT * FROM whatsapp_chat_sessions WHERE phone = ? ORDER BY id DESC LIMIT 1",
//     [from]
//   );

//   let activeSession = null;
//   if (sessions.length > 0) {
//     const sess  = sessions[0];
//     const ageMs = Date.now() - (sess.created_at ? new Date(sess.created_at).getTime() : 0);
//     if (ageMs > SESSION_TTL_MS) {
//       console.log(`[WA] Session ${sess.id} stale — clearing`);
//       await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE id = ?", [sess.id]);
//     } else {
//       activeSession = sess;
//     }
//   }

//   // ── [F10] "menu" / "restart" escapes active session ───────────────────────
//   if (activeSession && (normalizedMessage === "menu" || normalizedMessage === "restart")) {
//     await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE phone = ?", [from]);
//     activeSession = null;
//   }

//   // ── [F11][C2] Emergency — checked BEFORE session flow so it always fires ──
//   // This must sit here (not only in the no-session block) because a user can
//   // tap the Emergency button from a cached welcome message while mid-booking.
//   if (normalizedMessage === "emergency" || listReplyId === "btn_emergency") {
//     await sendText(
//       from,
//       `\ud83d\udea8 *Emergency \u2014 Renalease*\n\n` +
//       `If you or your patient is facing a medical emergency, ` +
//       `please call us *immediately*:\n\n` +
//       `\ud83d\udcde *+91 97690 26133*\n\n` +
//       `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
//       `Our emergency care team is available *24 \u00d7 7* to assist you.\n\n` +
//       `For non-urgent queries, type *menu* to return to the main menu.`
//     );
//     return;
//   }

//   // ═══════════════════════════════════════════════════════════════════════════
//   // ACTIVE SESSION FLOW
//   // ═══════════════════════════════════════════════════════════════════════════

//   if (activeSession) {
//     const session = activeSession;
//     let answers   = {};
//     try {
//       answers = typeof session.answers === "string"
//         ? JSON.parse(session.answers)
//         : (session.answers || {});
//     } catch { answers = {}; }

//     // ── STEP 0 — Service Selection [C7] ──────────────────────────────────────
//     // Handles the tap/reply from the service interactive list shown on "Book Appointment".
//     if (session.current_step === STEP_SERVICE) {
//       // Resolve: interactive list tap → service name → number fallback
//       let serviceTitle = SERVICES.find((s) => s.id === listReplyId)?.title || null;

//       if (!serviceTitle) {
//         const byName = SERVICES.find((s) => s.title.toLowerCase() === normalizedMessage);
//         if (byName) {
//           serviceTitle = byName.title;
//         } else {
//           const num = parseInt(normalizedMessage, 10);
//           if (!isNaN(num) && num >= 1 && num <= SERVICES.length) {
//             serviceTitle = SERVICES[num - 1].title;
//           }
//         }
//       }

//       if (!serviceTitle) {
//         // Unrecognised input — re-show the service list
//         await sendServiceList(from);
//         return;
//       }

//       await pool.execute(
//         "UPDATE whatsapp_chat_sessions SET current_step = ?, service = ? WHERE id = ?",
//         [STEP_NAME, serviceTitle, session.id]
//       );
//       await sendText(
//         from,
//         `\u270f\ufe0f *Patient Full Name*\n\n` +
//         `You selected: *${serviceTitle}*\n\n` +
//         `To get started, please enter the *full name* of the patient:`
//       );
//       return;
//     }

//     // ── STEP 1 — Patient Full Name ────────────────────────────────────────────
//     if (session.current_step === STEP_NAME) {
//       const name = userMessage.trim();
//       if (name.length < 2) {
//         await sendText(from, "\u26a0\ufe0f Please enter a valid full name (at least 2 characters) to continue.");
//         return;
//       }
//       answers.full_name = name;
//       await pool.execute(
//         "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
//         [STEP_CONTACT, JSON.stringify(answers), session.id]
//       );
//       await sendText(
//         from,
//         `Thank you, *${name}*! \ud83d\ude4f\n\n` +
//         `\ud83d\udcde *Contact Number*\n` +
//         `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
//         `Please enter the best mobile number we can reach you on:`
//       );
//       return;
//     }

//     // ── STEP 2 — Contact Number ───────────────────────────────────────────────
//     if (session.current_step === STEP_CONTACT) {
//       const digits = userMessage.replace(/\D/g, "");
//       if (digits.length < 10) {
//         await sendText(from, "\u26a0\ufe0f Please enter a valid mobile number (at least 10 digits).");
//         return;
//       }
//       answers.contact_number = userMessage.trim();
//       await pool.execute(
//         "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
//         [STEP_CITY, JSON.stringify(answers), session.id]
//       );
//       await sendCityList(from);
//       return;
//     }

//     // ── STEP 3 — City Selection ───────────────────────────────────────────────
//     if (session.current_step === STEP_CITY) {
//       let cityTitle = CITIES.find((c) => c.id === listReplyId)?.title || null;
//       let cityId    = listReplyId || null;

//       if (!cityTitle) {
//         const byName = CITIES.find((c) => c.title.toLowerCase() === normalizedMessage);
//         if (byName) {
//           cityTitle = byName.title;
//           cityId    = byName.id;
//         } else {
//           const num = parseInt(normalizedMessage, 10);
//           if (!isNaN(num) && num >= 1 && num <= CITIES.length) {
//             cityTitle = CITIES[num - 1].title;
//             cityId    = CITIES[num - 1].id;
//           }
//         }
//       }

//       // [C3] "Other" city → ask for manual entry
//       if (cityId === "city_other" || cityTitle === "Other") {
//         await pool.execute(
//           "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
//           [STEP_CITY_MANUAL, JSON.stringify(answers), session.id]
//         );
//         await sendText(
//           from,
//           `\ud83d\udccd *Enter Your City*\n\n` +
//           `Please type the name of your city or area so we can check service availability:`
//         );
//         return;
//       }

//       if (!cityTitle) cityTitle = userMessage.trim();

//       answers.city_area = cityTitle;
//       await pool.execute(
//         "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
//         [STEP_DIALYSIS, JSON.stringify(answers), session.id]
//       );
//       await sendDialysisQuestion(from);
//       return;
//     }

//     // ── STEP 4 — Manual City Entry [C3] ──────────────────────────────────────
//     if (session.current_step === STEP_CITY_MANUAL) {
//       const manualCity = userMessage.trim();
//       if (manualCity.length < 2) {
//         await sendText(from, "\u26a0\ufe0f Please enter a valid city or area name (at least 2 characters).");
//         return;
//       }
//       answers.city_area = manualCity;
//       await pool.execute(
//         "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
//         [STEP_DIALYSIS, JSON.stringify(answers), session.id]
//       );
//       await sendDialysisQuestion(from);
//       return;
//     }

//     // ── STEP 5 — Currently on Dialysis ───────────────────────────────────────
//     if (session.current_step === STEP_DIALYSIS) {
//       let dialysisAnswer = null;
//       if      (listReplyId === "btn_dialysis_yes" || normalizedMessage === "yes") dialysisAnswer = "Yes";
//       else if (listReplyId === "btn_dialysis_no"  || normalizedMessage === "no")  dialysisAnswer = "No";

//       if (!dialysisAnswer) {
//         await sendDialysisQuestion(from);
//         return;
//       }

//       answers.on_dialysis = dialysisAnswer;
//       await pool.execute(
//         "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
//         [STEP_CONFIRM, JSON.stringify(answers), session.id]
//       );

//       const summary =
//         `\ud83d\udccb *Appointment Summary*\n` +
//         `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
//         `\ud83d\udc64 *Patient Name:*    ${answers.full_name}\n` +
//         `\ud83d\udcde *Contact No:*      ${answers.contact_number}\n` +
//         `\ud83c\udfe5 *Service:*         ${session.service || "Not specified"}\n` +
//         `\ud83d\udccd *City / Area:*     ${answers.city_area}\n` +
//         `\ud83d\udc89 *On Dialysis:*     ${answers.on_dialysis}\n` +
//         `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
//         `\u2705 Please confirm your appointment by tapping the button below.`;

//       const btnSent = await sendInteractiveButtons(
//         from, summary,
//         [{ id: "btn_confirm_appt", title: "Confirm Appointment" }]
//       );
//       if (!btnSent) {
//         await sendText(from, `${summary}\n\nPlease reply *confirm* to complete your booking.`);
//       }
//       return;
//     }

//     // ── STEP 6 — Confirmation ─────────────────────────────────────────────────
//     if (session.current_step === STEP_CONFIRM) {
//       const isConfirmed =
//         listReplyId === "btn_confirm_appt"          ||
//         normalizedMessage === "confirm appointment" ||
//         normalizedMessage === "confirm"             ||
//         normalizedMessage === "yes";

//       if (!isConfirmed) {
//         await sendText(
//           from,
//           "Please tap *Confirm Appointment* above to complete your booking, " +
//           "or reply *confirm*.\n\nType *menu* at any time to start over."
//         );
//         return;
//       }

//       const leadId      = uuidv4();
//       const enumService = resolveServiceEnum(session.service);

//       const finalNotes =
//         `Service: ${session.service}\n` +
//         `Patient Name: ${answers.full_name}\n` +
//         `Contact: ${answers.contact_number}\n` +
//         `City: ${answers.city_area}\n` +
//         `Currently on Dialysis: ${answers.on_dialysis}`;

//       // ── Save lead to CRM ─────────────────────────────────────────────────
//       await pool.execute(
//         `INSERT INTO leads (
//            id, name, email, phone, source, status, priority,
//            notes, whatsapp_number, service, created_at, updated_at
//          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
//         sanitizeParams(
//           leadId,
//           answers.full_name      || profileName,
//           syntheticEmail,
//           answers.contact_number || from,
//           "whatsapp",
//           "qualified-lead",
//           "high",
//           finalNotes,
//           from,
//           enumService
//         )
//       );

//       // ── Clean up session ─────────────────────────────────────────────────
//       await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE id = ?", [session.id]);

//       // ── Thank-you → customer ONLY ────────────────────────────────────────
//       await sendText(
//         from,
//         `\u2705 *Appointment Confirmed!*\n\n` +
//         `Dear *${answers.full_name}*, thank you for choosing *Renalease*! \ud83d\ude4f\n\n` +
//         `Your request has been successfully submitted. ` +
//         `Our care coordinator will call you on *${answers.contact_number}* shortly.\n\n` +
//         `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
//         `\ud83d\udccc *What happens next?*\n\n` +
//         `1\ufe0f\u20e3  A Renalease coordinator will call you\n` +
//         `2\ufe0f\u20e3  We\u2019ll discuss your personalised care plan\n` +
//         `3\ufe0f\u20e3  Our clinical team will visit you at home\n` +
//         `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
//         `For urgent help, call: *+91 97690 26133*\n\n` +
//         `_Renalease \u2014 Bringing Dialysis Care Home_ \ud83c\udfe5`
//       );

//       // ── Lead alert → admin only — [C6] passes `from` to exclude customer ─
//       const adminAlert =
//         `\ud83d\udd14 *New WhatsApp Lead \u2014 Renalease*\n\n` +
//         `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
//         `\ud83d\udc64 *Patient Name:*    ${answers.full_name || profileName}\n` +
//         `\ud83d\udcde *Contact No:*      ${answers.contact_number || from}\n` +
//         `\ud83c\udfe5 *Service:*         ${session.service || "Not specified"}\n` +
//         `\ud83d\udccd *City / Area:*     ${answers.city_area || "\u2014"}\n` +
//         `\ud83d\udc89 *On Dialysis:*     ${answers.on_dialysis || "\u2014"}\n` +
//         `\ud83d\udce1 *Source:*          WhatsApp\n` +
//         `\ud83d\udccb *CRM Status:*      Qualified Lead\n` +
//         `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
//         `\u23f0 *Received:* ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

//       fireLeadAlerts(adminAlert, from).catch(console.error); // [C6] `from` = customer number

//       console.log(`[WA] Lead created: ${answers.full_name} (${answers.contact_number || from}) → ${enumService}`);
//       return;
//     }
//   } // end active-session block


//   // ── [C7] Book Appointment — create session at STEP_SERVICE then show list ──
//   // Creating the session BEFORE showing the list means the user's list-tap reply
//   // arrives while a session is active and is handled by STEP_SERVICE above —
//   // giving it the exact same rendering path as the city list (which works).
//   if (
//     normalizedMessage === "book appointment" ||
//     normalizedMessage === "book"             ||
//     normalizedMessage === "menu"             ||
//     normalizedMessage === "restart"          ||
//     listReplyId === "btn_book"
//   ) {
//     await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE phone = ?", [from]);
//     await pool.execute(
//       `INSERT INTO whatsapp_chat_sessions (phone, service, current_step, answers, created_at)
//        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
//       [from, null, STEP_SERVICE, JSON.stringify({})]
//     );
//     await sendServiceList(from);
//     return;
//   }

//   // ═══════════════════════════════════════════════════════════════════════════
//   // DEFAULT FALLBACK — Welcome menu
//   // ═══════════════════════════════════════════════════════════════════════════
//   // CHANGE 2: Welcome message body updated to match the screenshot exactly —
//   //           "bringing hospital-grade treatment to the comfort of your home."
//   //           (was using \u2014 dash mid-sentence; now matches screenshot wording)
//   const menuSent = await sendInteractiveButtons(
//     from,
//     `\ud83d\udc4b *Welcome to Renalease!*\n\n` +
//     `We provide specialised kidney care & home dialysis services \u2014 ` +
//     `bringing hospital-grade treatment to the comfort of your home.\n\n` +
//     `How can we assist you today?`,
//     [
//       { id: "btn_book",      title: "Book Appointment" },
//       { id: "btn_emergency", title: "Emergency"        },
//     ]
//   );
//   if (!menuSent) {
//     await sendText(
//       from,
//       `\ud83d\udc4b *Welcome to Renalease!*\n\n` +
//       `We provide specialised kidney care & home dialysis services \u2014 ` +
//       `bringing hospital-grade treatment to the comfort of your home.\n\n` +
//       `Please reply:\n` +
//       `1\ufe0f\u20e3  *book* \u2014 Book an Appointment\n` +
//       `2\ufe0f\u20e3  *emergency* \u2014 Emergency Helpline`
//     );
//   }
// }

// module.exports = router;



//testing 




// routes/whatsapp-webhook.js
// SOW §4.1 — WhatsApp Lead Capture (first message + replies → CRM leads)
// SOW §4.2 — Real-time lead alerts to configurable admin numbers (≤5 seconds)
//
// FIX LOG (original):
//  [F1]  body.messages and body.contacts are arrays — normalised at top of handleWebhook
//  [F2]  contact phone resolved via wa_id / recipient / phone fallback chain
//  [F3]  Robust interactive-reply parsing handles every known AOC nesting variant
//  [F4]  Removed duplicate local sendWhatsAppMessage — uses services/whatsapp exclusively
//  [F5]  require('../services/whatsapp') moved to top-level (out of async function)
//  [F6]  Stale sessions older than 2 hours are auto-cleared before processing
//  [F7]  STEP_CONFIRM accepts both tap (listReplyId) AND typed "confirm"
//  [F8]  fireLeadAlerts reads live numbers from whatsapp_alert_config DB table,
//        falls back to ALERT_NUMBERS env var
//  [F9]  resolveServiceEnum correctly matches human-readable title stored in session.service
//  [F10] "menu" / "restart" keywords inside an active session clear it and show main menu
//  [F11] "Talk to Support" button replaced with "Emergency" (btn_emergency) throughout
//  [F16] sendInteractiveList header field removed — AOC portal rejects it (services/whatsapp.js)
//  [F19] City step: list-failure fallback added so STEP_CITY never silently fails
//  [F20] All sendInteractiveList / sendInteractiveButtons calls check return value
//  [C1]  Service shown as interactive LIST dropdown (same pattern as city), not text menu
//  [C2]  Emergency message: removed "type *menu*" line
//  [C3]  Selecting "Other" city prompts manual city text entry (STEP_CITY_MANUAL)
//  [C4]  Dialysis question text: "Please tap one of the options below:"
//  [C5]  PRIMARY_ADMIN_NUMBER (917039210769) hardcoded — always gets lead alert
//  [C6]  fireLeadAlerts skips customer's own number — alert never appears in customer chat
//  [C7]  Session created before showing service list — dropdown renders correctly on AOC
//  [C8]  All service row titles ≤24 chars — AOC/WhatsApp hard limit enforced
//
// CHANGE LOG (this version):
//  [D1]  Brand name corrected to "RenalEase" (capital E) everywhere
//  [D2]  "Book Appointment" renamed to "Book Inquiry" everywhere
//        (button ID kept as btn_book for backward compat; keyword "book inquiry" added)
//  [D3]  Service catalogue updated:
//          "Home Haemodialysis"  → "Haemodialysis at Home"  (desc updated)
//          "HDF At-home"         → unchanged
//          "Peritoneal Dialysis" → "Peritoneal Services"    (desc: "Peritoneal Services at Home")
//          "ANM/GNM Nurse"       → unchanged
//          "Other Services"      → unchanged
//        All titles verified ≤24 chars — no AOC rejection risk
//  [D4]  STEP_NAME: removed the "📞 Contact Number / ─────" header line from the prompt.
//        After entering their name the user is asked directly for their mobile number
//        WITHOUT the decorative header block.
//  [D5]  STEP_NEPHROLOGIST added (step 3) — new field between Contact and City:
//          🩺 Name of Nephrologist
//          "Please provide the name of the treating kidney doctor."
//        Stored in answers.nephrologist_name; included in summary, admin alert, CRM notes.
//        Step numbers shifted: City=4, CityManual=5, Dialysis=6, Confirm=7
//
// COMPLETE CONVERSATION FLOW (after all changes):
//   Welcome → Book Inquiry
//     → STEP_SERVICE      (0): interactive service dropdown
//     → STEP_NAME         (1): patient full name
//     → STEP_CONTACT      (2): mobile number  [contact header line removed]
//     → STEP_NEPHROLOGIST (3): nephrologist / treating doctor name  [NEW]
//     → STEP_CITY         (4): interactive city dropdown
//     → STEP_CITY_MANUAL  (5): only if "Other" city selected
//     → STEP_DIALYSIS     (6): Yes / No buttons
//     → STEP_CONFIRM      (7): summary + Confirm Inquiry button
//        ↳ Thank-you message → customer
//        ↳ Lead alert        → admin (917039210769) only, never to customer

"use strict";

const express        = require("express");
const { v4: uuidv4 } = require("uuid");
const { pool }       = require("../config/database");

// [F5] Top-level import — never re-require inside async handlers
const {
  sendText,
  sendInteractiveList,
  sendInteractiveButtons,
} = require("../services/whatsapp");

const router = express.Router();

// ─── Config ───────────────────────────────────────────────────────────────────

// [C5] Primary admin — always receives lead alerts after every booking confirmation.
// Stored in E.164 digits-only (no +) per AOC portal convention.
const PRIMARY_ADMIN_NUMBER = "917039210769"; // +91 70392 10769

// Additional numbers from env (optional, used alongside primary admin)
const ENV_ALERT_NUMBERS = (
  process.env.ALERT_NUMBERS || process.env.ADMIN_PHONE_NUMBER || ""
)
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

// Session TTL: discard sessions older than 2 hours [F6]
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

// ─── Service catalogue ────────────────────────────────────────────────────────
// [C8] All row titles MUST be ≤24 chars — AOC/WhatsApp silently rejects the
//      entire list payload if any single title exceeds this limit, causing
//      the plain-text fallback to fire every time.
// [D3] Services renamed per client request. Verified lengths:
//      "Haemodialysis at Home"  = 21 chars ✅
//      "HDF At-home"            = 11 chars ✅
//      "Peritoneal Services"    = 19 chars ✅
//      "ANM/GNM Nurse"          = 13 chars ✅
//      "Other Services"         = 14 chars ✅

const SERVICES = [
  {
    id:    "srv_haemo",
    title: "Haemodialysis at Home",
    desc:  "Home Haemodialysis service",
    enum:  "haemodialysis",
  },
  {
    id:    "srv_hdf",
    title: "HDF At-home",
    desc:  "Haemodialfiltration at-home service",
    enum:  "hdf",
  },
  {
    id:    "srv_peritoneal",
    title: "Peritoneal Services",
    desc:  "Peritoneal Services at Home",
    enum:  "peritoneal",
  },
  {
    id:    "srv_nurse",
    title: "ANM/GNM Nurse",
    desc:  "Nursing care at home",
    enum:  "nursing",
  },
  {
    id:    "srv_other",
    title: "Other Services",
    desc:  "Other kidney care services",
    enum:  "other",
  },
];

const SERVICE_IDS   = SERVICES.map((s) => s.id);
const SERVICE_NAMES = SERVICES.map((s) => s.title.toLowerCase());

// ─── City catalogue ───────────────────────────────────────────────────────────

const CITIES = [
  { id: "city_mumbai",    title: "Mumbai"    },
  { id: "city_pune",      title: "Pune"      },
  { id: "city_nashik",    title: "Nashik"    },
  { id: "city_ahmedabad", title: "Ahmedabad" },
  { id: "city_delhi",     title: "Delhi"     },
  { id: "city_other",     title: "Other"     },
];

// ─── Conversation step constants ──────────────────────────────────────────────
// [D5] STEP_NEPHROLOGIST (3) inserted between Contact and City.
//      All subsequent step numbers shifted up by 1.
//
//   0 → Service selection    (interactive list + text fallback)
//   1 → Patient Full Name
//   2 → Contact Number       [decorative header line removed per D4]
//   3 → Nephrologist Name    [NEW — D5]
//   4 → City                 (interactive list + text fallback)
//   5 → City Manual Entry    (only when "Other" selected)
//   6 → Currently on Dialysis? (Yes / No buttons)
//   7 → Summary + Confirm

const STEP_SERVICE        = 0;
const STEP_NAME           = 1;
const STEP_CONTACT        = 2;
const STEP_NEPHROLOGIST   = 3; // [D5] NEW
const STEP_CITY           = 4;
const STEP_CITY_MANUAL    = 5;
const STEP_DIALYSIS       = 6;
const STEP_CONFIRM        = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sanitizeParams = (...params) =>
  params.map((p) => (p === undefined ? null : p));

// [F9] Resolve service enum from list-reply ID, enum string, or human-readable title
function resolveServiceEnum(titleOrId) {
  if (!titleOrId) return "other";
  const needle = titleOrId.toLowerCase().trim();
  const found  = SERVICES.find(
    (s) =>
      s.id    === titleOrId ||
      s.enum  === needle    ||
      s.title.toLowerCase() === needle
  );
  return found ? found.enum : "other";
}

// ─── Message send helpers ─────────────────────────────────────────────────────

// [C7][D2][D3] Service interactive list with numbered-text fallback
async function sendServiceList(to) {
  const listSent = await sendInteractiveList(
    to,
    "\ud83c\udfe5 Book Inquiry",                                           // [D2] renamed
    "Please select the service you need. Our care team will guide you through the rest.",
    "Select Service",
    [{
      title: "Our Services",
      rows:  SERVICES.map((s) => ({ id: s.id, title: s.title, description: s.desc })),
    }]
  );
  if (!listSent) {
    // Plain-text fallback
    const lines = SERVICES.map((s, i) => `${i + 1}\ufe0f\u20e3  ${s.title}`).join("\n");
    await sendText(
      to,
      `\ud83c\udfe5 *Book Inquiry \u2014 Select a Service*\n\n` +          // [D2] renamed
      `Please reply with the *number* of the service you need:\n\n` +
      `${lines}\n\n` +
      `_(e.g. reply *1* for Haemodialysis at Home)_`                       // [D3] updated example
    );
  }
}

// [F19] City interactive list with numbered-text fallback
async function sendCityList(to) {
  const listSent = await sendInteractiveList(
    to,
    "\ud83d\udccd Select Your City",
    "Please select the city or area where you need our home care service:",
    "Choose City",
    [{
      title: "Cities We Serve",
      rows:  CITIES.map((c) => ({ id: c.id, title: c.title })),
    }]
  );
  if (!listSent) {
    const lines = CITIES.map((c, i) => `${i + 1}\ufe0f\u20e3  ${c.title}`).join("\n");
    await sendText(
      to,
      `\ud83d\udccd *Select Your City*\n\n` +
      `Please reply with the *number* of your city:\n\n` +
      `${lines}\n\n` +
      `_(e.g. reply *1* for Mumbai)_`
    );
  }
}

// [C4] Dialysis Yes/No interactive buttons with text fallback
async function sendDialysisQuestion(to) {
  const btnSent = await sendInteractiveButtons(
    to,
    `\ud83d\udc89 *Currently on Dialysis?*\n\n` +
    `Is the patient currently receiving dialysis treatment at a centre or hospital?\n\n` +
    `Please tap one of the options below:`,
    [
      { id: "btn_dialysis_yes", title: "Yes" },
      { id: "btn_dialysis_no",  title: "No"  },
    ]
  );
  if (!btnSent) {
    await sendText(
      to,
      `\ud83d\udc89 *Currently on Dialysis?*\n\n` +
      `Is the patient currently receiving dialysis treatment?\n\n` +
      `Please reply *Yes* or *No*:`
    );
  }
}

// ─── Alert helpers ────────────────────────────────────────────────────────────

// [F8][C5] Build alert number list — PRIMARY_ADMIN_NUMBER always included
async function getAlertNumbers() {
  let numbers = [];
  try {
    const [rows] = await pool.execute(
      `SELECT alert_numbers, alerts_enabled
       FROM whatsapp_alert_config
       ORDER BY updated_at DESC LIMIT 1`
    );
    if (rows && rows.length > 0 && rows[0].alerts_enabled) {
      const nums = typeof rows[0].alert_numbers === "string"
        ? JSON.parse(rows[0].alert_numbers)
        : (rows[0].alert_numbers || []);
      if (nums.length) numbers = nums;
    }
  } catch { /* table may not exist yet — fall through */ }

  if (!numbers.length) numbers = [...ENV_ALERT_NUMBERS];

  // Always guarantee primary admin is in the list (deduplicated)
  if (!numbers.includes(PRIMARY_ADMIN_NUMBER)) {
    numbers = [PRIMARY_ADMIN_NUMBER, ...numbers];
  }
  return numbers;
}

// [C6] Fire lead alert to admin numbers only — skip customer's own number
//      so the notification never appears in the customer's chat thread.
async function fireLeadAlerts(messageText, customerPhone) {
  const allNumbers   = await getAlertNumbers();
  const normCustomer = (customerPhone || "").replace(/\D/g, "");

  const adminOnlyNumbers = allNumbers.filter(
    (num) => num.replace(/\D/g, "") !== normCustomer
  );

  if (!adminOnlyNumbers.length) {
    console.warn("[WA] All alert numbers matched customer phone — no admin alert sent");
    return;
  }

  const results = await Promise.allSettled(
    adminOnlyNumbers.map((num) => sendText(num, messageText))
  );
  const sent   = results.filter((r) => r.status === "fulfilled" && r.value).length;
  const failed = results.length - sent;
  console.log(`[WA] Lead alert: ${sent} sent, ${failed} failed (customer number excluded)`);
}

// ─── Main Webhook ─────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  console.log("[WA] Incoming webhook:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200); // ACK immediately — WhatsApp requires <3 s
  setImmediate(() =>
    handleWebhook(req.body).catch((err) =>
      console.error("[WA] Unhandled webhook error:", err)
    )
  );
});

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleWebhook(body) {

  // ── Validate payload ──────────────────────────────────────────────────────
  if (!body || body.channel !== "whatsapp" || !body.messages || !body.contacts) {
    console.log("[WA] Ignoring non-whatsapp or invalid payload");
    return;
  }

  // [F1] Normalise: AOC portal sends messages/contacts as array OR single object
  const message    = Array.isArray(body.messages) ? body.messages[0] : body.messages;
  const contactObj = Array.isArray(body.contacts) ? body.contacts[0] : body.contacts;
  if (!message || !contactObj) {
    console.log("[WA] Empty messages/contacts — ignoring");
    return;
  }

  // [F2] Resolve sender phone via multiple possible field names
  const from =
    contactObj.wa_id     ||
    contactObj.recipient ||
    contactObj.phone     ||
    contactObj.number    ||
    null;
  if (!from) {
    console.log("[WA] Cannot resolve sender phone — ignoring");
    return;
  }

  const profileName =
    contactObj.profileName   ||
    contactObj.profile?.name ||
    contactObj.name          ||
    "WhatsApp Patient";

  // ── [F3] Robust interactive-reply extraction ──────────────────────────────
  // Handles four known AOC nesting variants for list_reply / button_reply
  let userMessage = null;
  let listReplyId = null;

  if (message.type === "text") {
    userMessage = message.text?.body?.trim() || null;

  } else if (message.type === "interactive") {
    const ia = message.interactive || {};
    const listReply =
      ia.list_reply         ||
      ia.text?.list_reply   ||
      ia.action?.list_reply ||
      null;
    const buttonReply =
      ia.button_reply         ||
      ia.text?.button_reply   ||
      ia.action?.button_reply ||
      null;

    if (listReply) {
      userMessage = listReply.title || listReply.description || null;
      listReplyId = listReply.id    || null;
    } else if (buttonReply) {
      userMessage = buttonReply.title || null;
      listReplyId = buttonReply.id    || null;
    }
  }

  if (!userMessage) {
    console.log(`[WA] Ignoring non-text/interactive (type=${message.type}) from ${from}`);
    return;
  }

  console.log(`[WA] From: ${profileName} (${from}) → "${userMessage}" [replyId=${listReplyId}]`);

  const syntheticEmail    = `${from.replace(/\D/g, "")}@whatsapp.renalease.local`;
  const normalizedMessage = userMessage.toLowerCase().trim();

  // ── [F6] Load session; auto-expire stale ones ─────────────────────────────
  const [sessions] = await pool.execute(
    "SELECT * FROM whatsapp_chat_sessions WHERE phone = ? ORDER BY id DESC LIMIT 1",
    [from]
  );

  let activeSession = null;
  if (sessions.length > 0) {
    const sess  = sessions[0];
    const ageMs = Date.now() - (sess.created_at ? new Date(sess.created_at).getTime() : 0);
    if (ageMs > SESSION_TTL_MS) {
      console.log(`[WA] Session ${sess.id} stale — clearing`);
      await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE id = ?", [sess.id]);
    } else {
      activeSession = sess;
    }
  }

  // ── [F10] "menu" / "restart" escapes an active session ───────────────────
  if (activeSession && (normalizedMessage === "menu" || normalizedMessage === "restart")) {
    await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE phone = ?", [from]);
    activeSession = null;
    // Fall through to show main menu
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE SESSION FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  if (activeSession) {
    const session = activeSession;
    let answers   = {};
    try {
      answers = typeof session.answers === "string"
        ? JSON.parse(session.answers)
        : (session.answers || {});
    } catch { answers = {}; }

    // ── STEP 0 — Service Selection ────────────────────────────────────────────
    // Handles the list tap / text reply from the service dropdown shown at start.
    if (session.current_step === STEP_SERVICE) {
      // Try: interactive list tap → exact name match → number fallback
      let serviceTitle = SERVICES.find((s) => s.id === listReplyId)?.title || null;

      if (!serviceTitle) {
        const byName = SERVICES.find((s) => s.title.toLowerCase() === normalizedMessage);
        if (byName) {
          serviceTitle = byName.title;
        } else {
          const num = parseInt(normalizedMessage, 10);
          if (!isNaN(num) && num >= 1 && num <= SERVICES.length) {
            serviceTitle = SERVICES[num - 1].title;
          }
        }
      }

      if (!serviceTitle) {
        // Unrecognised input — re-show the service list
        await sendServiceList(from);
        return;
      }

      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, service = ? WHERE id = ?",
        [STEP_NAME, serviceTitle, session.id]
      );
      await sendText(
        from,
        `\u270f\ufe0f *Patient Full Name*\n\n` +
        `You selected: *${serviceTitle}*\n\n` +
        `To get started, please enter the *full name* of the patient:`
      );
      return;
    }

    // ── STEP 1 — Patient Full Name ────────────────────────────────────────────
    if (session.current_step === STEP_NAME) {
      const name = userMessage.trim();
      if (name.length < 2) {
        await sendText(
          from,
          "\u26a0\ufe0f Please enter a valid full name (at least 2 characters) to continue."
        );
        return;
      }
      answers.full_name = name;
      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
        [STEP_CONTACT, JSON.stringify(answers), session.id]
      );
      // [D4] Decorative "📞 Contact Number / ─────" header line removed.
      //      The question is asked plainly after the thank-you.
      await sendText(
        from,
        `Thank you, *${name}*! \ud83d\ude4f\n\n` +
        `Please enter the best mobile number we can reach you on:`
      );
      return;
    }

    // ── STEP 2 — Contact Number ───────────────────────────────────────────────
    if (session.current_step === STEP_CONTACT) {
      const digits = userMessage.replace(/\D/g, "");
      if (digits.length < 10) {
        await sendText(
          from,
          "\u26a0\ufe0f Please enter a valid mobile number (at least 10 digits)."
        );
        return;
      }
      answers.contact_number = userMessage.trim();
      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
        [STEP_NEPHROLOGIST, JSON.stringify(answers), session.id]
      );
      // [D5] New nephrologist step
      await sendText(
        from,
        `\ud83e\ude7a *Name of Nephrologist*\n\n` +
        `Please provide the name of the treating kidney doctor.`
      );
      return;
    }

    // ── STEP 3 — Nephrologist / Treating Doctor Name [D5] ────────────────────
    if (session.current_step === STEP_NEPHROLOGIST) {
      const doctorName = userMessage.trim();
      if (doctorName.length < 2) {
        await sendText(
          from,
          "\u26a0\ufe0f Please enter a valid doctor name (at least 2 characters).\n\n" +
          "If you don\u2019t have a treating nephrologist yet, please type *Not assigned*."
        );
        return;
      }
      answers.nephrologist_name = doctorName;
      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
        [STEP_CITY, JSON.stringify(answers), session.id]
      );
      await sendCityList(from);
      return;
    }

    // ── STEP 4 — City Selection ───────────────────────────────────────────────
    if (session.current_step === STEP_CITY) {
      let cityTitle = CITIES.find((c) => c.id === listReplyId)?.title || null;
      let cityId    = listReplyId || null;

      if (!cityTitle) {
        const byName = CITIES.find((c) => c.title.toLowerCase() === normalizedMessage);
        if (byName) {
          cityTitle = byName.title;
          cityId    = byName.id;
        } else {
          const num = parseInt(normalizedMessage, 10);
          if (!isNaN(num) && num >= 1 && num <= CITIES.length) {
            cityTitle = CITIES[num - 1].title;
            cityId    = CITIES[num - 1].id;
          }
        }
      }

      // [C3] "Other" city → ask for manual text entry
      if (cityId === "city_other" || cityTitle === "Other") {
        await pool.execute(
          "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
          [STEP_CITY_MANUAL, JSON.stringify(answers), session.id]
        );
        await sendText(
          from,
          `\ud83d\udccd *Enter Your City*\n\n` +
          `Please type the name of your city or area so we can check service availability:`
        );
        return;
      }

      if (!cityTitle) cityTitle = userMessage.trim();

      answers.city_area = cityTitle;
      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
        [STEP_DIALYSIS, JSON.stringify(answers), session.id]
      );
      await sendDialysisQuestion(from);
      return;
    }

    // ── STEP 5 — Manual City Entry [C3] ──────────────────────────────────────
    if (session.current_step === STEP_CITY_MANUAL) {
      const manualCity = userMessage.trim();
      if (manualCity.length < 2) {
        await sendText(
          from,
          "\u26a0\ufe0f Please enter a valid city or area name (at least 2 characters)."
        );
        return;
      }
      answers.city_area = manualCity;
      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
        [STEP_DIALYSIS, JSON.stringify(answers), session.id]
      );
      await sendDialysisQuestion(from);
      return;
    }

    // ── STEP 6 — Currently on Dialysis ───────────────────────────────────────
    if (session.current_step === STEP_DIALYSIS) {
      let dialysisAnswer = null;
      if      (listReplyId === "btn_dialysis_yes" || normalizedMessage === "yes") dialysisAnswer = "Yes";
      else if (listReplyId === "btn_dialysis_no"  || normalizedMessage === "no")  dialysisAnswer = "No";

      if (!dialysisAnswer) {
        // Unrecognised — re-show the question
        await sendDialysisQuestion(from);
        return;
      }

      answers.on_dialysis = dialysisAnswer;
      await pool.execute(
        "UPDATE whatsapp_chat_sessions SET current_step = ?, answers = ? WHERE id = ?",
        [STEP_CONFIRM, JSON.stringify(answers), session.id]
      );

      // [D5] Summary now includes nephrologist field
      const summary =
        `\ud83d\udccb *Inquiry Summary*\n` +                                // [D2] renamed
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `\ud83d\udc64 *Patient Name:*      ${answers.full_name}\n` +
        `\ud83d\udcde *Contact No:*        ${answers.contact_number}\n` +
        `\ud83e\ude7a *Nephrologist:*      ${answers.nephrologist_name || "\u2014"}\n` +
        `\ud83c\udfe5 *Service:*           ${session.service || "Not specified"}\n` +
        `\ud83d\udccd *City / Area:*       ${answers.city_area}\n` +
        `\ud83d\udc89 *On Dialysis:*       ${answers.on_dialysis}\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `\u2705 Please confirm your inquiry by tapping the button below.`;   // [D2] renamed

      const btnSent = await sendInteractiveButtons(
        from,
        summary,
        [{ id: "btn_confirm_appt", title: "Confirm Inquiry" }]             // [D2] renamed
      );
      if (!btnSent) {
        await sendText(
          from,
          `${summary}\n\nPlease reply *confirm* to complete your inquiry.`  // [D2] renamed
        );
      }
      return;
    }

    // ── STEP 7 — Confirmation ─────────────────────────────────────────────────
    if (session.current_step === STEP_CONFIRM) {
      // [F7] Accept button tap OR typed text
      const isConfirmed =
        listReplyId === "btn_confirm_appt"          ||
        normalizedMessage === "confirm appointment" ||
        normalizedMessage === "confirm inquiry"     ||
        normalizedMessage === "confirm"             ||
        normalizedMessage === "yes";

      if (!isConfirmed) {
        await sendText(
          from,
          "Please tap *Confirm Inquiry* above to complete your submission, " +
          "or reply *confirm*.\n\nType *menu* at any time to start over."
        );
        return;
      }

      const leadId      = uuidv4();
      const enumService = resolveServiceEnum(session.service);

      // [D5] CRM notes include nephrologist
      const finalNotes =
        `Service: ${session.service}\n` +
        `Patient Name: ${answers.full_name}\n` +
        `Contact: ${answers.contact_number}\n` +
        `Nephrologist: ${answers.nephrologist_name || "Not provided"}\n` +
        `City: ${answers.city_area}\n` +
        `Currently on Dialysis: ${answers.on_dialysis}`;

      // ── Save lead to CRM ─────────────────────────────────────────────────
      await pool.execute(
        `INSERT INTO leads (
           id, name, email, phone, source, status, priority,
           notes, whatsapp_number, service, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        sanitizeParams(
          leadId,
          answers.full_name      || profileName,
          syntheticEmail,
          answers.contact_number || from,
          "whatsapp",
          "qualified-lead",
          "high",
          finalNotes,
          from,
          enumService
        )
      );

      // ── Clean up session ─────────────────────────────────────────────────
      await pool.execute(
        "DELETE FROM whatsapp_chat_sessions WHERE id = ?",
        [session.id]
      );

      // ── Thank-you message → customer ONLY ────────────────────────────────
      // [D1] Brand name corrected to "RenalEase" (capital E)
      await sendText(
        from,
        `\u2705 *Inquiry Confirmed!*\n\n` +                                 // [D2] renamed
        `Dear *${answers.full_name}*, thank you for choosing *RenalEase*! \ud83d\ude4f\n\n` +
        `Your inquiry has been successfully submitted. ` +
        `Our care coordinator will call you on *${answers.contact_number}* shortly.\n\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `\ud83d\udccc *What happens next?*\n\n` +
        `1\ufe0f\u20e3  A RenalEase coordinator will call you\n` +
        `2\ufe0f\u20e3  We\u2019ll discuss your personalised care plan\n` +
        `3\ufe0f\u20e3  Our clinical team will visit you at home\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `For urgent help, call: *+91 97690 26133*\n\n` +
        `_RenalEase \u2014 Bringing Dialysis Care Home_ \ud83c\udfe5`       // [D1] capital E
      );

      // ── Lead alert → admin only [C6] — `from` passed to exclude customer ─
      // [D5] Admin alert includes nephrologist field
      const adminAlert =
        `\ud83d\udd14 *New WhatsApp Inquiry \u2014 RenalEase*\n\n` +        // [D1][D2] renamed
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `\ud83d\udc64 *Patient Name:*      ${answers.full_name || profileName}\n` +
        `\ud83d\udcde *Contact No:*        ${answers.contact_number || from}\n` +
        `\ud83e\ude7a *Nephrologist:*      ${answers.nephrologist_name || "Not provided"}\n` +
        `\ud83c\udfe5 *Service:*           ${session.service || "Not specified"}\n` +
        `\ud83d\udccd *City / Area:*       ${answers.city_area || "\u2014"}\n` +
        `\ud83d\udc89 *On Dialysis:*       ${answers.on_dialysis || "\u2014"}\n` +
        `\ud83d\udce1 *Source:*            WhatsApp\n` +
        `\ud83d\udccb *CRM Status:*        Qualified Lead\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `\u23f0 *Received:* ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

      fireLeadAlerts(adminAlert, from).catch(console.error);

      console.log(
        `[WA] Lead created: ${answers.full_name} ` +
        `(${answers.contact_number || from}) → ${enumService} | ` +
        `Nephrologist: ${answers.nephrologist_name || "N/A"}`
      );
      return;
    }
  } // end active-session block

  // ═══════════════════════════════════════════════════════════════════════════
  // NO ACTIVE SESSION — keyword / menu handlers
  // ═══════════════════════════════════════════════════════════════════════════

  // ── [F11][C2] Emergency ───────────────────────────────────────────────────
  // [D1] Brand name corrected to "RenalEase"
  if (normalizedMessage === "emergency" || listReplyId === "btn_emergency") {
    await sendText(
      from,
      `\ud83d\udea8 *Emergency \u2014 RenalEase*\n\n` +                    // [D1] capital E
      `If you or your patient is facing a medical emergency, ` +
      `please call us *immediately*:\n\n` +
      `\ud83d\udcde *+91 97690 26133*\n\n` +
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
      `Our emergency care team is available *24 \u00d7 7* to assist you.`
    );
    return;
  }

  // ── [C7][D2] Book Inquiry — create session at STEP_SERVICE then show list ──
  // Session is created BEFORE showing the list so the user's reply arrives
  // inside the active-session block (STEP_SERVICE), giving the interactive
  // list the same rendering path as the city dropdown (which works on AOC).
  if (
    normalizedMessage === "book inquiry"      ||                            // [D2] NEW keyword
    normalizedMessage === "book appointment"  ||                            // backward compat
    normalizedMessage === "book"              ||
    normalizedMessage === "menu"              ||
    normalizedMessage === "restart"           ||
    listReplyId === "btn_book"
  ) {
    await pool.execute("DELETE FROM whatsapp_chat_sessions WHERE phone = ?", [from]);
    await pool.execute(
      `INSERT INTO whatsapp_chat_sessions (phone, service, current_step, answers, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [from, null, STEP_SERVICE, JSON.stringify({})]
    );
    await sendServiceList(from);
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULT FALLBACK — Welcome menu with Book Inquiry / Emergency buttons
  // ═══════════════════════════════════════════════════════════════════════════
  // [D1] Brand corrected to "RenalEase"  [D2] Button renamed to "Book Inquiry"
  const menuSent = await sendInteractiveButtons(
    from,
    `\ud83d\udc4b *Welcome to RenalEase!*\n\n` +                           // [D1] capital E
    `We provide specialised kidney care & home dialysis services \u2014 ` +
    `bringing hospital-grade treatment to the comfort of your home.\n\n` +
    `How can we assist you today?`,
    [
      { id: "btn_book",      title: "Book Inquiry" },                      // [D2] renamed
      { id: "btn_emergency", title: "Emergency"    },
    ]
  );
  if (!menuSent) {
    // Plain-text fallback
    await sendText(
      from,
      `\ud83d\udc4b *Welcome to RenalEase!*\n\n` +                         // [D1] capital E
      `We provide specialised kidney care & home dialysis services.\n\n` +
      `Please reply:\n` +
      `1\ufe0f\u20e3  *book* \u2014 Book an Inquiry\n` +                   // [D2] renamed
      `2\ufe0f\u20e3  *emergency* \u2014 Emergency Helpline`
    );
  }
}

module.exports = router;