const express = require("express");
const { v4: uuid } = require("uuid");
const { db, VEHICLE_TYPES } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { distanceKm, calculateFare } = require("../utils/geo");

const router = express.Router();

/** يبحث عن أقرب سائق متصل من نفس نوع المركبة ولا يعمل على رحلة أخرى، مع استثناء من رفض الطلب مسبقاً */
function findNearestDriver(vehicleType, pickup, excludeIds = []) {
  const busyDriverIds = new Set(
    [...db.trips.values()]
      .filter((t) => ["requested", "accepted", "ongoing"].includes(t.status))
      .map((t) => t.driverId)
  );

  const candidates = [...db.drivers.values()].filter(
    (d) =>
      d.online &&
      d.vehicleType === vehicleType &&
      d.lat != null &&
      d.lng != null &&
      !busyDriverIds.has(d.userId) &&
      !excludeIds.includes(d.userId)
  );

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      distanceKm(pickup.lat, pickup.lng, a.lat, a.lng) -
      distanceKm(pickup.lat, pickup.lng, b.lat, b.lng)
  );
  return candidates[0];
}

function tripToJSON(trip) {
  const driver = trip.driverId ? db.drivers.get(trip.driverId) : null;
  const driverUser = trip.driverId ? db.users.get(trip.driverId) : null;
  return {
    ...trip,
    driver: driver && driverUser ? {
      name: driverUser.name,
      phone: driverUser.phone,
      plate: driver.plate,
      carModel: driver.carModel,
      rating: driver.rating,
      lat: driver.lat,
      lng: driver.lng,
    } : null,
  };
}

// إنشاء طلب رحلة جديد
router.post("/", requireAuth, (req, res) => {
  if (req.user.role !== "rider") return res.status(403).json({ error: "هذه الميزة للركاب فقط" });
  const { vehicleType, pickup, dropoff } = req.body;
  const vType = VEHICLE_TYPES.find((v) => v.id === vehicleType);
  if (!vType) return res.status(400).json({ error: "نوع مركبة غير صالح" });
  if (!pickup?.lat || !pickup?.lng || !dropoff?.lat || !dropoff?.lng) {
    return res.status(400).json({ error: "إحداثيات نقطة الانطلاق والوجهة مطلوبة" });
  }

  const distKm = distanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  const fare = calculateFare(vType, distKm);
  const id = uuid();

  const trip = {
    id,
    riderId: req.user.id,
    vehicleType,
    pickup,
    dropoff,
    distanceKm: Math.round(distKm * 10) / 10,
    fare,
    status: "searching",
    driverId: null,
    declinedDriverIds: [],
    createdAt: Date.now(),
  };
  db.trips.set(id, trip);

  const driver = findNearestDriver(vehicleType, pickup);
  const io = req.app.get("io");

  if (driver) {
    trip.driverId = driver.userId;
    trip.status = "requested";
    if (io) io.to(`driver:${driver.userId}`).emit("trip:request", tripToJSON(trip));
  }

  res.status(201).json({ trip: tripToJSON(trip) });
});

// إعادة محاولة المطابقة إذا لم يستجب السائق أو رفض
router.post("/:id/rematch", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.riderId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });

  const driver = findNearestDriver(trip.vehicleType, trip.pickup, trip.declinedDriverIds);
  const io = req.app.get("io");
  if (driver) {
    trip.driverId = driver.userId;
    trip.status = "requested";
    if (io) io.to(`driver:${driver.userId}`).emit("trip:request", tripToJSON(trip));
  } else {
    trip.status = "searching";
    trip.driverId = null;
  }
  res.json({ trip: tripToJSON(trip) });
});

router.get("/:id", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  res.json({ trip: tripToJSON(trip) });
});

router.get("/", requireAuth, (req, res) => {
  const mine = [...db.trips.values()]
    .filter((t) => t.riderId === req.user.id || t.driverId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ trips: mine.map(tripToJSON) });
});

router.post("/:id/accept", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
  trip.status = "accepted";
  const io = req.app.get("io");
  if (io) io.to(`trip:${trip.id}`).emit("trip:update", tripToJSON(trip));
  res.json({ trip: tripToJSON(trip) });
});

router.post("/:id/decline", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });

  trip.declinedDriverIds.push(req.user.id);
  const nextDriver = findNearestDriver(trip.vehicleType, trip.pickup, trip.declinedDriverIds);
  const io = req.app.get("io");
  if (nextDriver) {
    trip.driverId = nextDriver.userId;
    trip.status = "requested";
    if (io) io.to(`driver:${nextDriver.userId}`).emit("trip:request", tripToJSON(trip));
  } else {
    trip.driverId = null;
    trip.status = "searching";
  }
  if (io) io.to(`trip:${trip.id}`).emit("trip:update", tripToJSON(trip));
  res.json({ trip: tripToJSON(trip) });
});

router.post("/:id/start", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
  trip.status = "ongoing";
  trip.startedAt = Date.now();
  const io = req.app.get("io");
  if (io) io.to(`trip:${trip.id}`).emit("trip:update", tripToJSON(trip));
  res.json({ trip: tripToJSON(trip) });
});

router.post("/:id/complete", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
  trip.status = "completed";
  trip.completedAt = Date.now();

  const driver = db.drivers.get(req.user.id);
  if (driver) {
    driver.totalTrips += 1;
    driver.earningsToday += trip.fare;
  }
  const io = req.app.get("io");
  if (io) io.to(`trip:${trip.id}`).emit("trip:update", tripToJSON(trip));
  res.json({ trip: tripToJSON(trip) });
});

router.post("/:id/cancel", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.riderId !== req.user.id && trip.driverId !== req.user.id) {
    return res.status(403).json({ error: "غير مصرح" });
  }
  trip.status = "cancelled";
  const io = req.app.get("io");
  if (io) io.to(`trip:${trip.id}`).emit("trip:update", tripToJSON(trip));
  res.json({ trip: tripToJSON(trip) });
});

router.post("/:id/rate", requireAuth, (req, res) => {
  const trip = db.trips.get(req.params.id);
  const { stars } = req.body;
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
  if (trip.riderId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
  const driver = db.drivers.get(trip.driverId);
  if (driver && stars) {
    driver.rating = Math.round(((driver.rating + stars) / 2) * 10) / 10;
  }
  trip.riderRating = stars;
  res.json({ trip: tripToJSON(trip) });
});

module.exports = router;
