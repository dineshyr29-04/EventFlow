const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    date: { type: Date, required: true, index: true },
    time: { type: String, required: true }, // "HH:MM" (24h)
    location: { type: String, required: true, trim: true, maxlength: 200 },
    organizer: { type: String, required: true, trim: true, maxlength: 100 },
    capacity: { type: Number, required: true, min: 1 },
    registeredCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', eventSchema);
