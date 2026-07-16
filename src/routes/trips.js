const express = require("express");
const { v4: uuid } = require("uuid");
const { VEHICLE_TYPES } = require("../db");
const { Users, Drivers, Trips } = require("../repositories");
const { requireAuth } = require("../middleware/auth");
const { distanceKm, calculateFare } = require("../utils/geo");

const router = express.Router();

async function tripToJSON(trip) {
  if (!trip.driverId) return { ...trip, driver: null };
  const [driverUser, driver] = await Promise.all([
    Users.findById(trip.driverId),
    Drivers.get(trip.driverId),
  ]);
  if (!driverUser || !driver) return { ...trip, driver: null };
  return {
    ...trip,
    driver: {
      name: driverUser.name,
      phone: driverUser.phone,
      plate: driver.plate,
      carModel: driver.carModel,
      rating: driver.rating,
      lat: driver.lat,
      lng: driver.lng,
    },
  };
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
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
      id, riderId: req.user.id, vehicleType, pickup, dropoff,
      distanceKm: Math.round(distKm * 10) / 10, fare,
      status: "searching", driverId: null, declinedDriverIds: [],
    };

    const driver = await Drivers.findNearest(vehicleType, pickup);
    if (driver) {
      trip.driverId = driver.userId;
      trip.status = "requested";
    }
    await Trips.create(trip);

    const io = req.app.get("io");
    if (driver && io) io.to(`driver:${driver.userId}`).emit("trip:request", await tripToJSON(trip));

    res.status(201).json({ trip: await tripToJSON(trip) });
  } catch (e) { next(e); }
});

router.post("/:id/rematch", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.riderId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });

    const driver = await Drivers.findNearest(trip.vehicleType, trip.pickup, trip.declinedDriverIds);
    const io = req.app.get("io");
    if (driver) {
      await Trips.setDriver(trip.id, driver.userId, "requested");
      if (io) io.to(`driver:${driver.userId}`).emit("trip:request", await tripToJSON(await Trips.get(trip.id)));
    } else {
      await Trips.setDriver(trip.id, null, "searching");
    }
    res.json({ trip: await tripToJSON(await Trips.get(trip.id)) });
  } catch (e) { next(e); }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    res.json({ trip: await tripToJSON(trip) });
  } catch (e) { next(e); }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const mine = await Trips.listForUser(req.user.id);
    res.json({ trips: await Promise.all(mine.map(tripToJSON)) });
  } catch (e) { next(e); }
});

router.post("/:id/accept", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
    await Trips.setStatus(trip.id, "accepted");
    const updated = await tripToJSON(await Trips.get(trip.id));
    const io = req.app.get("io");
    if (io) io.to(`trip:${trip.id}`).emit("trip:update", updated);
    res.json({ trip: updated });
  } catch (e) { next(e); }
});

router.post("/:id/decline", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });

    await Trips.addDeclinedDriver(trip.id, req.user.id);
    const refreshed = await Trips.get(trip.id);
    const nextDriver = await Drivers.findNearest(trip.vehicleType, trip.pickup, refreshed.declinedDriverIds);
    const io = req.app.get("io");
    if (nextDriver) {
      await Trips.setDriver(trip.id, nextDriver.userId, "requested");
      if (io) io.to(`driver:${nextDriver.userId}`).emit("trip:request", await tripToJSON(await Trips.get(trip.id)));
    } else {
      await Trips.setDriver(trip.id, null, "searching");
    }
    const updated = await tripToJSON(await Trips.get(trip.id));
    if (io) io.to(`trip:${trip.id}`).emit("trip:update", updated);
    res.json({ trip: updated });
  } catch (e) { next(e); }
});

router.post("/:id/start", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
    await Trips.setStatus(trip.id, "ongoing");
    const updated = await tripToJSON(await Trips.get(trip.id));
    const io = req.app.get("io");
    if (io) io.to(`trip:${trip.id}`).emit("trip:update", updated);
    res.json({ trip: updated });
  } catch (e) { next(e); }
});

router.post("/:id/complete", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.driverId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
    await Trips.setStatus(trip.id, "completed");
    await Drivers.registerCompletedTrip(req.user.id, trip.fare);
    const updated = await tripToJSON(await Trips.get(trip.id));
    const io = req.app.get("io");
    if (io) io.to(`trip:${trip.id}`).emit("trip:update", updated);
    res.json({ trip: updated });
  } catch (e) { next(e); }
});

router.post("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.riderId !== req.user.id && trip.driverId !== req.user.id) {
      return res.status(403).json({ error: "غير مصرح" });
    }
    await Trips.setStatus(trip.id, "cancelled");
    const updated = await tripToJSON(await Trips.get(trip.id));
    const io = req.app.get("io");
    if (io) io.to(`trip:${trip.id}`).emit("trip:update", updated);
    res.json({ trip: updated });
  } catch (e) { next(e); }
});

router.post("/:id/rate", requireAuth, async (req, res, next) => {
  try {
    const trip = await Trips.get(req.params.id);
    const { stars } = req.body;
    if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة" });
    if (trip.riderId !== req.user.id) return res.status(403).json({ error: "غير مصرح" });
    if (trip.driverId && stars) {
      const driver = await Drivers.get(trip.driverId);
      const newRating = Math.round(((driver.rating + stars) / 2) * 10) / 10;
      await Drivers.updateRating(trip.driverId, newRating);
    }
    await Trips.setRating(trip.id, stars);
    res.json({ trip: await tripToJSON(await Trips.get(trip.id)) });
  } catch (e) { next(e); }
});

module.exports = router;
