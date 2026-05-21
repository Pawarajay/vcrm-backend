// scripts/resetAdminPassword.js

const bcrypt = require("bcryptjs");
const { pool, testConnection } = require("../config/database");

(async () => {
  try {
    // 1. Test DB connection
    await testConnection();

    // 2. Define password
    const plainPassword = "Admin@123";

    // 3. Generate hash
    const hash = await bcrypt.hash(plainPassword, 10);

    console.log("Generated Hash:", hash); // 👈 IMPORTANT

    // 4. Update DB
    const [result] = await pool.execute(
      "UPDATE users SET password = ? WHERE email = ?",
      [hash, "admin@vasifytech.com"]
    );

    console.log("Rows affected:", result.affectedRows);

    if (result.affectedRows === 0) {
      console.log("⚠️ No user found with this email");
    } else {
      console.log("✅ Password reset successful");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
})();