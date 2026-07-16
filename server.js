require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { JWT_SECRET } = require("./src/middleware/auth");
const { initSchema } = require("./src/database");
const authRoutes = require("./src/routes/auth");
const vehicleTypesRoutes = require("./src/routes/vehicleTypes");
const driversRoutes = require("./src/routes/drivers");
const tripsRoutes = require("./src/routes/trips");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.set("io", io);
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "sahl-backend", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/vehicle-types", vehicleTypesRoutes);
app.use("/api/drivers", driversRoutes);
app.use("/api/trips", tripsRoutes);

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "خطأ غير متوقع في الخادم" });
});

/**
 * Socket.io: الاتصال المباشر لتتبع الرحلات
 * - السائق ينضم لغرفة خاصة به لاستقبال طلبات الرحلات: driver:<userId>
 * - الراكب والسائق ينضمان لغرفة الرحلة لتبادل التحديثات اللحظية: trip:<tripId>
 */
io.on("connection", (socket) => {
  socket.on("auth", (token) => {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.data.user = payload;
      if (payload.role === "driver") {
        socket.join(`driver:${payload.id}`);
      }
    } catch (e) {
      socket.emit("error", { message: "توثيق غير صالح" });
    }
  });

  socket.on("trip:join", (tripId) => {
    if (tripId) socket.join(`trip:${tripId}`);
  });

  socket.on("trip:leave", (tripId) => {
    if (tripId) socket.leave(`trip:${tripId}`);
  });
});

const PORT = process.env.PORT || 4000;

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`✅ خادم سهل يعمل على http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ فشل الاتصال بقاعدة البيانات:", err.message);
    console.error("تأكد من تعريف متغير DATABASE_URL بشكل صحيح");
    process.exit(1);
  });
