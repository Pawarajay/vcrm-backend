
// const { pool } = require("../config/database");

// async function migrateWhatsappTables() {
//   console.log("[Migration] Creating WhatsApp tables if they don't exist...");

//   try {
//     // ── 1. whatsapp_chat_sessions ─────────────────────────────────────────
//     await pool.execute(`
//       CREATE TABLE IF NOT EXISTS whatsapp_chat_sessions (
//         id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
//         phone        VARCHAR(20)   NOT NULL,
//         service      VARCHAR(100)  DEFAULT NULL,
//         current_step TINYINT       NOT NULL DEFAULT 0,
//         answers      TEXT          NOT NULL DEFAULT '{}',
//         created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
//         updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         PRIMARY KEY (id),
//         UNIQUE KEY uq_phone (phone)
//       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
//     `);
//     console.log("[Migration] ✅ whatsapp_chat_sessions — OK");

//     // ── 2. whatsapp_messages ──────────────────────────────────────────────
//     await pool.execute(`
//       CREATE TABLE IF NOT EXISTS whatsapp_messages (
//         id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
//         customer_id  VARCHAR(36)   DEFAULT NULL,
//         phone_number VARCHAR(20)   NOT NULL,
//         message      TEXT          NOT NULL,
//         status       VARCHAR(20)   NOT NULL DEFAULT 'sent',
//         sent_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
//         PRIMARY KEY (id),
//         KEY idx_phone (phone_number),
//         KEY idx_customer (customer_id)
//       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
//     `);
//     console.log("[Migration] ✅ whatsapp_messages — OK");

//     console.log("[Migration] All WhatsApp tables ready.");
//   } catch (err) {
//     console.error("[Migration] ❌ Failed:", err.message);
//     throw err;
//   }
// }

// // Allow running standalone: node scripts/migrate-whatsapp-tables.js
// if (require.main === module) {
//   migrateWhatsappTables()
//     .then(() => process.exit(0))
//     .catch(() => process.exit(1));
// }

// module.exports = { migrateWhatsappTables };



//testing

const { pool } = require("../config/database");

async function migrateWhatsappTables() {
  console.log("[Migration] Creating WhatsApp tables if they don't exist...");

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_chat_sessions (
        id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        phone        VARCHAR(20)   NOT NULL,
        service      VARCHAR(100)  DEFAULT NULL,
        current_step TINYINT       NOT NULL DEFAULT 0,
        answers      TEXT          NULL,
        created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY   uq_wa_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("[Migration] ✅ whatsapp_chat_sessions — OK");

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        customer_id  VARCHAR(36)   DEFAULT NULL,
        phone_number VARCHAR(20)   NOT NULL,
        message      TEXT          NOT NULL,
        status       VARCHAR(20)   NOT NULL DEFAULT 'sent',
        sent_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY idx_wa_phone    (phone_number),
        KEY idx_wa_customer (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("[Migration] ✅ whatsapp_messages — OK");

    console.log("[Migration] All WhatsApp tables ready.");
  } catch (err) {
    console.error("[Migration] ❌ Failed:", err.message);
    throw err;
  }
}

if (require.main === module) {
  migrateWhatsappTables()
    .then(() => { console.log("Done."); process.exit(0); })
    .catch(() => process.exit(1));
}

module.exports = { migrateWhatsappTables };