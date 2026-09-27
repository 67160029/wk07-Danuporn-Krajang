require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const { redisClient, connectRedis } = require("./cache");
const {
  parsePagination,
  parseSort,
} = require("./middlewares/query-parser");

const pool = require("./db");

// ==========================
// Authentication Helper
// ==========================

const {
  hashPassword,
  verifyPassword,
  generateToken,
} = require("./auth-helpers");

// ==========================
// Authentication Middleware
// ==========================

const {
  authenticateToken,
  authorizeRole,
} = require("./middlewares/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// Middleware
// ==========================

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "100kb" }));

// ==========================
// Home
// ==========================

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Student API พร้อมใช้งาน",
  });
});

// ==================================================
// AUTH - Register
// ==================================================

app.post("/api/v1/auth/register", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ email และ password",
      },
    });
  }

  try {
    const passwordHash = await hashPassword(password);

    const [result] = await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'student')",
      [email, passwordHash],
    );

    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      data: {
        id: result.insertId,
        email,
        role: "student",
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_EMAIL",
          message: "อีเมลนี้มีอยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// ==================================================
// AUTH - Login
// ==================================================

app.post("/api/v1/auth/login", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ email และ password",
      },
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email],
    );

    if (rows.length === 0) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
        },
      });
    }

    const user = rows[0];

    const isPasswordValid = await verifyPassword(
      password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
        },
      });
    }

    const token = generateToken(user);

    res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      token,
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// AUTH - ดูข้อมูลตัวเอง
// ==================================================

app.get(
  "/api/v1/auth/me",
  authenticateToken,
  (req, res) => {
    res.status(200).json({
      message: "สำเร็จ",
      data: req.user,
    });
  },
);

// ==================================================
// GET Students
// Pagination + Filter + Sort
// ==================================================

app.get(
  "/api/v1/students",
  parsePagination,
  parseSort,
  async (req, res, next) => {
    const { major } = req.query;

    const {
      page,
      limit,
      offset,
    } = req.pagination;

    const {
      field,
      order,
    } = req.sort;

    let baseQuery = "SELECT * FROM students";
    let countQuery = "SELECT COUNT(*) AS total FROM students";

    const params = [];

    // ==========================
    // Filter by major
    // ==========================

    if (major) {
      baseQuery += " WHERE major = ?";
      countQuery += " WHERE major = ?";
      params.push(major);
    }

    // ==========================
    // Sort + Pagination
    // ==========================

    baseQuery += ` ORDER BY ${field} ${order} LIMIT ? OFFSET ?`;

    try {
      // ดึงข้อมูลตาม filter / sort / pagination
      const [rows] = await pool.query(
        baseQuery,
        [...params, limit, offset],
      );

      // นับจำนวนข้อมูลทั้งหมด
      const [[{ total }]] = await pool.query(
        countQuery,
        params,
      );

      res.status(200).json({
        message: "สำเร็จ",
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==================================================
// POST Student + Clear Cache
// ==================================================

app.post("/api/v1/students", async (req, res, next) => {
  const {
    name,
    major,
    email,
  } = req.body;

  if (!name || !major || !email) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ name, major และ email",
      },
    });
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO students (name, major, email) VALUES (?, ?, ?)",
      [name, major, email],
    );

    // ล้าง Cache เดิม
    await redisClient.del("students:all");

    res.status(201).json({
      message: "สร้างข้อมูลสำเร็จ",
      data: {
        id: result.insertId,
        name,
        major,
        email,
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_EMAIL",
          message: "อีเมลนี้มีอยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// ==========================
// GET Student by ID
// ==========================

app.get(
  "/api/v1/students/:id",
  async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM students WHERE id = ?",
        [req.params.id],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "ไม่พบข้อมูลนิสิต",
          },
        });
      }

      res.status(200).json({
        message: "สำเร็จ",
        data: rows[0],
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==================================================
// DELETE Student
// เฉพาะ Admin เท่านั้น
// ==================================================

app.delete(
  "/api/v1/students/:id",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res, next) => {
    try {
      const [result] = await pool.query(
        "DELETE FROM students WHERE id = ?",
        [req.params.id],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "ไม่พบข้อมูลนิสิต",
          },
        });
      }

      // ล้าง Cache เดิม
      await redisClient.del("students:all");

      res.status(200).json({
        message: "ลบข้อมูลสำเร็จ",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==================================================
// POST ลงทะเบียนเรียน
// ==================================================

app.post(
  "/api/v1/students/:id/enrollments",
  async (req, res, next) => {
    const studentId = req.params.id;
    const { courseId } = req.body;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [courseRows] = await connection.query(
        "SELECT * FROM courses WHERE id = ? FOR UPDATE",
        [courseId],
      );

      if (courseRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: {
            code: "COURSE_NOT_FOUND",
            message: "ไม่พบรายวิชาที่ระบุ",
          },
        });
      }

      if (courseRows[0].seat_available <= 0) {
        await connection.rollback();

        return res.status(409).json({
          error: {
            code: "SEAT_FULL",
            message: "ที่นั่งเต็มแล้ว",
          },
        });
      }

      await connection.query(
        `INSERT INTO enrollments
         (student_id, course_id)
         VALUES (?, ?)`,
        [studentId, courseId],
      );

      await connection.query(
        `UPDATE courses
         SET seat_available = seat_available - 1
         WHERE id = ?`,
        [courseId],
      );

      await connection.commit();

      res.status(201).json({
        message: "ลงทะเบียนสำเร็จ",
      });
    } catch (err) {
      await connection.rollback();

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          error: {
            code: "ALREADY_ENROLLED",
            message: "นิสิตลงทะเบียนรายวิชานี้ไปแล้ว",
          },
        });
      }

      next(err);
    } finally {
      connection.release();
    }
  },
);

// ==================================================
// GET Courses ของ Student ด้วย JOIN
// ==================================================

app.get(
  "/api/v1/students/:id/courses",
  async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT courses.*
         FROM courses
         JOIN enrollments
         ON courses.id = enrollments.course_id
         WHERE enrollments.student_id = ?`,
        [req.params.id],
      );

      res.status(200).json({
        message: "สำเร็จ",
        data: rows,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==================================================
// UNSAFE - ไม่มี Transaction
// ==================================================

app.post(
  "/api/v1/students/:id/enrollments-unsafe",
  async (req, res, next) => {
    const studentId = req.params.id;
    const { courseId } = req.body;

    try {
      await pool.query(
        `INSERT INTO enrollments
         (student_id, course_id)
         VALUES (?, ?)`,
        [studentId, courseId],
      );

      await pool.query(
        `UPDATE courses
         SET seat_available = seat_available - 1
         WHERE id = ?`,
        [courseId],
      );

      res.status(201).json({
        message: "ลงทะเบียนสำเร็จ (unsafe)",
      });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          error: {
            code: "ALREADY_ENROLLED",
            message: "นิสิตลงทะเบียนรายวิชานี้ไปแล้ว",
          },
        });
      }

      next(err);
    }
  },
);

// ==================================================
// DELETE ยกเลิกการลงทะเบียน
// ==================================================

app.delete(
  "/api/v1/students/:id/enrollments/:courseId",
  async (req, res, next) => {
    const studentId = req.params.id;
    const courseId = req.params.courseId;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `DELETE FROM enrollments
         WHERE student_id = ?
         AND course_id = ?`,
        [studentId, courseId],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: {
            code: "ENROLLMENT_NOT_FOUND",
            message: "ไม่พบการลงทะเบียน",
          },
        });
      }

      await connection.query(
        `UPDATE courses
         SET seat_available = seat_available + 1
         WHERE id = ?`,
        [courseId],
      );

      await connection.commit();

      res.status(200).json({
        message: "ยกเลิกการลงทะเบียนสำเร็จ",
      });
    } catch (err) {
      await connection.rollback();
      next(err);
    } finally {
      connection.release();
    }
  },
);

// ==================================================
// API VERSION 2
// ==================================================

const v2Router = express.Router();

v2Router.get("/students", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM students"
    );

    res.status(200).json({
      items: rows,
      count: rows.length,
    });
  } catch (err) {
    next(err);
  }
});

app.use("/api/v2", v2Router);

// ==========================
// 404
// ==========================

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "ไม่พบเส้นทางที่ร้องขอ",
    },
  });
});

// ==========================
// Error Handler
// ==========================

app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    error: {
      code: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
    },
  });
});

// ==========================
// Start Server
// ==========================

connectRedis()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Server กำลังทำงานที่พอร์ต ${PORT}`,
      );
    });
  })
  .catch((err) => {
    console.error(
      "เชื่อมต่อ Redis ไม่สำเร็จ เซิร์ฟเวอร์จะไม่เริ่มทำงาน:",
      err,
    );

    process.exit(1);
  });