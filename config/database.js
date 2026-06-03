const mysql = require("mysql2/promise")
require("dotenv").config()


// const dbConfig = {
//   host: process.env.DB_HOST || "13.203.39.243",
//   user: process.env.DB_USER || "ajay",
//   password: process.env.DB_PASSWORD || "vt_dev_db@ajay",
//   database: process.env.DB_NAME || "vasifytech_dev",
//   port: process.env.DB_PORT || 54751,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
// }
// root:xwFhUnSPQGmyDMDWWHRIRKevBCXGXrre@gondola.proxy.rlwy.net:35644/railway

const dbConfig = {
  host: process.env.DB_HOST || "acela.proxy.rlwy.net",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "AdmDcUZRvXbCRyPoDdJzvKsyZFqCHCzl",
  database: process.env.DB_NAME || "railway",
  port: process.env.DB_PORT || 11254,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}
// mysql://root:duiIZCIaqOMpVlWpMlHjKIRBxwHtbGYt@zephyr.proxy.rlwy.net:50860/railway
// # mysql://root:iGxSfAxEKEscPTUwfsQrpvTzRfCUKXFP@ballast.proxy.rlwy.net:48199/railway
// const dbConfig = {
//   host: process.env.DB_HOST || "localhost",
//   user: process.env.DB_USER || "root",
//   password: process.env.DB_PASSWORD || "Ajay@7039",
//   database: process.env.DB_NAME || "vasify_crm",
//   port: process.env.DB_PORT || 3306,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
// }



const pool = mysql.createPool(dbConfig)

async function testConnection() {
  try {
    const connection = await pool.getConnection()
    console.log(" Database connected successfully")
    connection.release()
  } catch (error) {
    console.error(" Database connection failed:", error.message)
    process.exit(1)
  }
}

module.exports = { pool, testConnection }
