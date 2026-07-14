/**
 * قاعدة بيانات مؤقتة في الذاكرة (In-memory store).
 * ملاحظة مهمة: البيانات تُمسح عند إعادة تشغيل الخادم.
 * للإنتاج الحقيقي: استبدل هذا الملف بـ PostgreSQL أو MongoDB
 * مع الحفاظ على نفس الدوال (findUser, createTrip...) لتقليل التعديلات.
 */

const db = {
  users: new Map(),      // id -> { id, name, phone, passwordHash, role }
  drivers: new Map(),    // userId -> { userId, vehicleType, plate, carModel, online, lat, lng, rating }
  trips: new Map(),      // id -> trip object
};

const VEHICLE_TYPES = [
  { id: "taxi", name: "تكسي", basePrice: 2000, perKm: 700, eta: 3 },
  { id: "cargo", name: "كيا حمل", basePrice: 5000, perKm: 1800, eta: 6 },
  { id: "van", name: "كيا ركاب", basePrice: 4000, perKm: 1400, eta: 5 },
  { id: "coaster", name: "كوستر", basePrice: 10000, perKm: 3000, eta: 10 },
];

module.exports = { db, VEHICLE_TYPES };
