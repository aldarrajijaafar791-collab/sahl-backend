const { pool } = require("./database");
const { distanceKm } = require("./utils/geo");

function rowToTrip(row) {
  if (!row) return null;
  return {
    id: row.id,
    riderId: row.rider_id,
    driverId: row.driver_id,
    vehicleType: row.vehicle_type,
    pickup: row.pickup,
    dropoff: row.dropoff,
    distanceKm: row.distance_km != null ? Number(row.distance_km) : null,
    fare: row.fare != null ? Number(row.fare) : null,
    status: row.status,
    declinedDriverIds: row.declined_driver_ids || [],
    riderRating: row.rider_rating,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function rowToDriver(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    vehicleType: row.vehicle_type,
    plate: row.plate,
    carModel: row.car_model,
    online: row.online,
    lat: row.lat,
    lng: row.lng,
    rating: row.rating != null ? Number(row.rating) : null,
    totalTrips: row.total_trips,
    earningsToday: row.earnings_today != null ? Number(row.earnings_today) : 0,
  };
}

const Users = {
  async findByPhone(phone) {
    const r = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
    return r.rows[0] || null;
  },
  async findById(id) {
    const r = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return r.rows[0] || null;
  },
  async create({ id, name, phone, passwordHash, role }) {
    await pool.query(
      "INSERT INTO users (id, name, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5)",
      [id, name, phone, passwordHash, role]
    );
  },
};

const Drivers = {
  async create({ userId, vehicleType, plate, carModel }) {
    await pool.query(
      `INSERT INTO drivers (user_id, vehicle_type, plate, car_model, online, rating, total_trips, earnings_today)
       VALUES ($1,$2,$3,$4,false,5.0,0,0)`,
      [userId, vehicleType, plate, carModel]
    );
  },
  async get(userId) {
    const r = await pool.query("SELECT * FROM drivers WHERE user_id = $1", [userId]);
    return rowToDriver(r.rows[0]);
  },
  async setOnline(userId, lat, lng) {
    await pool.query(
      "UPDATE drivers SET online = true, lat = COALESCE($2, lat), lng = COALESCE($3, lng) WHERE user_id = $1",
      [userId, lat, lng]
    );
  },
  async setOffline(userId) {
    await pool.query("UPDATE drivers SET online = false WHERE user_id = $1", [userId]);
  },
  async updateLocation(userId, lat, lng) {
    await pool.query("UPDATE drivers SET lat = $2, lng = $3 WHERE user_id = $1", [userId, lat, lng]);
  },
  async registerCompletedTrip(userId, fare) {
    await pool.query(
      "UPDATE drivers SET total_trips = total_trips + 1, earnings_today = earnings_today + $2 WHERE user_id = $1",
      [userId, fare]
    );
  },
  async updateRating(userId, newRating) {
    await pool.query("UPDATE drivers SET rating = $2 WHERE user_id = $1", [userId, newRating]);
  },
  /** يبحث عن أقرب سائق متصل من نفس نوع المركبة وغير مشغول بغض النظر عن مطابقات سابقة مرفوضة */
  async findNearest(vehicleType, pickup, excludeIds = []) {
    const busyRes = await pool.query(
      `SELECT driver_id FROM trips WHERE status IN ('requested','accepted','ongoing') AND driver_id IS NOT NULL`
    );
    const busyIds = new Set(busyRes.rows.map((r) => r.driver_id));

    const r = await pool.query(
      `SELECT * FROM drivers WHERE online = true AND vehicle_type = $1 AND lat IS NOT NULL AND lng IS NOT NULL`,
      [vehicleType]
    );
    const candidates = r.rows
      .map(rowToDriver)
      .filter((d) => !busyIds.has(d.userId) && !excludeIds.includes(d.userId));

    if (candidates.length === 0) return null;
    candidates.sort(
      (a, b) =>
        distanceKm(pickup.lat, pickup.lng, a.lat, a.lng) -
        distanceKm(pickup.lat, pickup.lng, b.lat, b.lng)
    );
    return candidates[0];
  },
};

const Trips = {
  async create(trip) {
    await pool.query(
      `INSERT INTO trips (id, rider_id, driver_id, vehicle_type, pickup, dropoff, distance_km, fare, status, declined_driver_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        trip.id, trip.riderId, trip.driverId, trip.vehicleType,
        JSON.stringify(trip.pickup), JSON.stringify(trip.dropoff),
        trip.distanceKm, trip.fare, trip.status, JSON.stringify(trip.declinedDriverIds || []),
      ]
    );
  },
  async get(id) {
    const r = await pool.query("SELECT * FROM trips WHERE id = $1", [id]);
    return rowToTrip(r.rows[0]);
  },
  async listForUser(userId) {
    const r = await pool.query(
      "SELECT * FROM trips WHERE rider_id = $1 OR driver_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return r.rows.map(rowToTrip);
  },
  async setDriver(id, driverId, status) {
    await pool.query("UPDATE trips SET driver_id = $2, status = $3 WHERE id = $1", [id, driverId, status]);
  },
  async addDeclinedDriver(id, driverId) {
    await pool.query(
      "UPDATE trips SET declined_driver_ids = declined_driver_ids || $2::jsonb WHERE id = $1",
      [id, JSON.stringify([driverId])]
    );
  },
  async setStatus(id, status) {
    const col = status === "ongoing" ? "started_at" : status === "completed" ? "completed_at" : null;
    if (col) {
      await pool.query(`UPDATE trips SET status = $2, ${col} = now() WHERE id = $1`, [id, status]);
    } else {
      await pool.query("UPDATE trips SET status = $2 WHERE id = $1", [id, status]);
    }
  },
  async setRating(id, stars) {
    await pool.query("UPDATE trips SET rider_rating = $2 WHERE id = $1", [id, stars]);
  },
};

module.exports = { Users, Drivers, Trips };
