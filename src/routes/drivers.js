const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

function requireDriver(req, res, next) {
  if (req.user.role !== "driver") return res.status(403).json({ error: "لهذه الميزة للسائقين فقط" });
  const driver = db.drivers.get(req.user.id);
  if (!driver) return res.status(404).json({ error: "ملف السائق غير موجود" });
  req.driver = driver;
  next();
}

router.get("/me", requireAuth, requireDriver, (req, res) => {
  res.json({ driver: req.driver });
});

router.post("/online", requireAuth, requireDriver, (req, res) => {
  const { lat, lng } = req.body;
  req.driver.online = true;
  if (lat != null && lng != null) {
    req.driver.lat = lat;
    req.driver.lng = lng;
  }
  res.json({ driver: req.driver });
});

router.post("/offline", requireAuth, requireDriver, (req, res) => {
  req.driver.online = false;
  res.json({ driver: req.driver });
});

router.post("/location", requireAuth, requireDriver, (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: "الإحداثيات مطلوبة" });
  req.driver.lat = lat;
  req.driver.lng = lng;

  // إذا كان لدى السائق رحلة جارية، أبلغ الراكب بالموقع الجديد لحظياً
  const activeTrip = [...db.trips.values()].find(
    (t) => t.driverId === req.user.id && ["accepted", "ongoing"].includes(t.status)
  );
  const io = req.app.get("io");
  if (activeTrip && io) {
    io.to(`trip:${activeTrip.id}`).emit("driver:location", { tripId: activeTrip.id, lat, lng });
  }
  res.json({ ok: true });
});

module.exports = router;
