const express = require("express");
const { Drivers, Trips } = require("../repositories");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

async function requireDriver(req, res, next) {
  if (req.user.role !== "driver") return res.status(403).json({ error: "لهذه الميزة للسائقين فقط" });
  const driver = await Drivers.get(req.user.id);
  if (!driver) return res.status(404).json({ error: "ملف السائق غير موجود" });
  req.driver = driver;
  next();
}

router.get("/me", requireAuth, requireDriver, (req, res) => {
  res.json({ driver: req.driver });
});

router.post("/online", requireAuth, requireDriver, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    await Drivers.setOnline(req.user.id, lat ?? null, lng ?? null);
    const driver = await Drivers.get(req.user.id);
    res.json({ driver });
  } catch (e) { next(e); }
});

router.post("/offline", requireAuth, requireDriver, async (req, res, next) => {
  try {
    await Drivers.setOffline(req.user.id);
    const driver = await Drivers.get(req.user.id);
    res.json({ driver });
  } catch (e) { next(e); }
});

router.post("/location", requireAuth, requireDriver, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: "الإحداثيات مطلوبة" });
    await Drivers.updateLocation(req.user.id, lat, lng);

    const mine = await Trips.listForUser(req.user.id);
    const activeTrip = mine.find(
      (t) => t.driverId === req.user.id && ["accepted", "ongoing"].includes(t.status)
    );
    const io = req.app.get("io");
    if (activeTrip && io) {
      io.to(`trip:${activeTrip.id}`).emit("driver:location", { tripId: activeTrip.id, lat, lng });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
