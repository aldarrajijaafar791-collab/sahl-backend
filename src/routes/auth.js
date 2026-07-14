const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

// تسجيل حساب جديد (راكب أو سائق)
router.post("/register", (req, res) => {
  const { name, phone, password, role, vehicleType, plate, carModel } = req.body;

  if (!name || !phone || !password || !role) {
    return res.status(400).json({ error: "الاسم ورقم الهاتف وكلمة المرور والدور مطلوبة" });
  }
  if (!["rider", "driver"].includes(role)) {
    return res.status(400).json({ error: "الدور يجب أن يكون rider أو driver" });
  }
  const existing = [...db.users.values()].find((u) => u.phone === phone);
  if (existing) {
    return res.status(409).json({ error: "رقم الهاتف مسجل مسبقاً" });
  }
  if (role === "driver" && !vehicleType) {
    return res.status(400).json({ error: "نوع المركبة مطلوب لحساب السائق" });
  }

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 8);
  const user = { id, name, phone, passwordHash, role };
  db.users.set(id, user);

  if (role === "driver") {
    db.drivers.set(id, {
      userId: id,
      vehicleType,
      plate: plate || "غير محدد",
      carModel: carModel || "غير محدد",
      online: false,
      lat: null,
      lng: null,
      rating: 5.0,
      totalTrips: 0,
      earningsToday: 0,
    });
  }

  const token = jwt.sign({ id, name, role }, JWT_SECRET, { expiresIn: "30d" });
  res.status(201).json({ token, user: { id, name, phone, role } });
});

router.post("/login", (req, res) => {
  const { phone, password } = req.body;
  const user = [...db.users.values()].find((u) => u.phone === phone);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, {
    expiresIn: "30d",
  });
  res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
});

module.exports = router;
