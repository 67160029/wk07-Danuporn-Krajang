const express = require("express");
const router = express.Router();

let students = [
  {
    id: 1,
    name: "สมชาย ใจดี",
    major: "วิทยาการคอมพิวเตอร์",
    email: "somchai@example.com",
    phone: "080-000-0001",
    courseIds: [101, 102],
  },
  {
    id: 2,
    name: "สมหญิง รักเรียน",
    major: "เทคโนโลยีสารสนเทศ",
    email: "somying@example.com",
    phone: "080-000-0002",
    courseIds: [102],
  },
];

let courses = [
  {
    id: 101,
    courseName: "การเขียนโปรแกรมเบื้องต้น",
    credit: 3,
  },
  {
    id: 102,
    courseName: "โครงสร้างข้อมูล",
    credit: 3,
  },
];

let nextId = 3;

// GET นักศึกษาทั้งหมด
router.get("/", (req, res) => {
  res.status(200).json({
    message: "สำเร็จ",
    data: students,
  });
});

// GET นักศึกษาตาม ID
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const student = students.find((s) => s.id === id);

  if (!student) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "ไม่พบข้อมูลนักศึกษา",
      },
    });
  }

  const shouldIncludeCourses = req.query.include === "courses";

  if (shouldIncludeCourses) {
    const studentCourses = courses.filter((c) =>
      student.courseIds.includes(c.id),
    );

    return res.status(200).json({
      message: "สำเร็จ",
      data: {
        ...student,
        courses: studentCourses,
      },
    });
  }

  res.status(200).json({
    message: "สำเร็จ",
    data: student,
  });
});

// POST เพิ่มนักศึกษา
router.post("/", (req, res) => {
  const { name, major, email } = req.body;

  if (!name || !major || !email) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุข้อมูลให้ครบ",
      },
    });
  }

  if (
    typeof name !== "string" ||
    typeof major !== "string" ||
    typeof email !== "string"
  ) {
    return res.status(400).json({
      error: {
        code: "TYPE_ERROR",
        message: "ชนิดข้อมูลไม่ถูกต้อง",
      },
    });
  }

  const duplicated = students.find((s) => s.email === email);

  if (duplicated) {
    return res.status(409).json({
      error: {
        code: "DUPLICATE_EMAIL",
        message: "อีเมลนี้มีอยู่แล้ว",
      },
    });
  }

  const newStudent = {
    id: nextId++,
    name,
    major,
    email,
  };

  students.push(newStudent);

  res.status(201).json({
    message: "เพิ่มข้อมูลสำเร็จ",
    data: newStudent,
  });
});

// PATCH แก้ไขนักศึกษา
router.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const student = students.find((s) => s.id === id);

  if (!student) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "ไม่พบข้อมูลนักศึกษา",
      },
    });
  }

  const { name, major, email } = req.body;

  if (name !== undefined) student.name = name;
  if (major !== undefined) student.major = major;
  if (email !== undefined) student.email = email;

  res.status(200).json({
    message: "แก้ไขข้อมูลสำเร็จ",
    data: student,
  });
});

// DELETE นักศึกษา
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const index = students.findIndex((s) => s.id === id);

  if (index === -1) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "ไม่พบข้อมูลนักศึกษา",
      },
    });
  }

  students.splice(index, 1);

  res.status(200).json({
    message: "ลบข้อมูลสำเร็จ",
  });
});

module.exports = router;
