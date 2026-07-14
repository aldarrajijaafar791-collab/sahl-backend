const express = require("express");
const { VEHICLE_TYPES } = require("../db");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ vehicleTypes: VEHICLE_TYPES });
});

module.exports = router;
