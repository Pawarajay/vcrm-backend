

const express = require("express");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// GET /api/users
// ✅ FIX: Admins get full user list; non-admins get empty array (no 401)
// The user list is only needed for admin filter dropdowns
router.get("/", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.json({ users: [], total: 0 });
    }

    const [users] = await pool.execute(
      `SELECT 
        id, 
        name, 
        email, 
        role,
        avatar,
        is_active,
        created_at,
        updated_at
       FROM users 
       WHERE is_active = 1
       ORDER BY name ASC`
    );

    return res.json({
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      })),
      total: users.length,
    });
  } catch (error) {
    console.error("Users fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /api/users/me — current user profile
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT 
        id, 
        name, 
        email, 
        role,
        avatar,
        is_active,
        created_at,
        updated_at
       FROM users 
       WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
  
    const user = users[0];
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (error) {
    console.error("User profile fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

// GET /api/users/:id — admin or self only
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role !== "admin" && String(req.user.id) !== String(id)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [users] = await pool.execute(
      `SELECT 
        id, 
        name, 
        email, 
        role,
        avatar,
        is_active,
        created_at,
        updated_at
       FROM users 
       WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = users[0];
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (error) {
    console.error("User fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

module.exports = router;