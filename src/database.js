const { Pool } = require("pg");

/**
 * الاتصال بقاعدة البيانات:
 * - على Render: يوفّر DATABASE_URL تلقائياً عند ربط قاعدة بيانات Postgres بالخدمة
 * - محلياً: عرّف متغير DATABASE_URL بملف .env، مثال:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/sahl_test
 */
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  // Render يتطلب SSL للاتصال الخارجي، لكن ليس محلياً
  ssl: connectionString && connectionString.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('rider', 'driver')),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS drivers (
      user_id UUID PRIMARY KEY REFERENCES users(id),
      vehicle_type TEXT NOT NULL,
      plate TEXT,
      car_model TEXT,
      online BOOLEAN DEFAULT false,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      rating NUMERIC DEFAULT 5.0,
      total_trips INT DEFAULT 0,
      earnings_today NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trips (
      id UUID PRIMARY KEY,
      rider_id UUID REFERENCES users(id),
      driver_id UUID REFERENCES users(id),
      vehicle_type TEXT NOT NULL,
      pickup JSONB NOT NULL,
      dropoff JSONB NOT NULL,
      distance_km NUMERIC,
      fare NUMERIC,
      status TEXT NOT NULL,
      declined_driver_ids JSONB DEFAULT '[]',
      rider_rating INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
  `);
  console.log("✅ قاعدة البيانات جاهزة (الجداول موجودة أو تم إنشاؤها)");
}

module.exports = { pool, initSchema };
