const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { Users, Drivers } = require("../repositories");
const { JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res, next) => {
  try {
    const { name, phone, password, role, vehicleType, plate, carModel } = req.body;

    if (!name || !phone || !password || !role) {
      return res.status(400).json({ error: "الاسم ورقم الهاتف وكلمة المرور والدور مطلوبة" });
    }
    if (!["rider", "driver"].includes(role)) {
      return res.status(400).json({ error: "الدور يجب أن يكون rider أو driver" });
    }
    const existing = await Users.findByPhone(phone);
    if (existing) {
      return res.status(409).json({ error: "رقم الهاتف مسجل مسبقاً" });
    }
    if (role === "driver" && !vehicleType) {
      return res.status(400).json({ error: "نوع المركبة مطلوب لحساب السائق" });
    }

    const id = uuid();
    const passwordHash = bcrypt.hashSync(password, 8);
    await Users.create({ id, name, phone, passwordHash, role });

    if (role === "driver") {
      await Drivers.create({
        userId: id,
        vehicleType,
        plate: plate || "غير محدد",
        carModel: carModel || "غير محدد",
      });
    }

    const token = jwt.sign({ id, name, role }, JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, user: { id, name, phone, role } });
  } catch (e) {
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { phone, password } = req.body;
    const user = await Users.findByPhone(phone);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
    }
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, {
      expiresIn: "30d",
    });
    res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
