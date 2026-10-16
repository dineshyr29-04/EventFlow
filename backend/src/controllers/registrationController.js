const Event = require('../models/Event');
const Registration = require('../models/Registration');
const HttpError = require('../utils/HttpError');
const { validateRegistrationInput } = require('../services/validation');
const { findEventOr404 } = require('./eventController');

async function registerParticipant(req, res) {
  const { eventId } = req.params;

  const { errors, value } = validateRegistrationInput(req.body);
  if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);

  const existing = await Registration.exists({ eventId, email: value.email });
  if (existing) throw new HttpError(409, 'This email is already registered for this event');

  // Initialize registeredCount if not present on older documents
  await Event.updateOne(
    { _id: eventId, registeredCount: { $exists: false } },
    { $set: { registeredCount: await Registration.countDocuments({ eventId }) } }
  );

  // Atomically claim a seat if registeredCount is less than capacity
  const event = await Event.findOneAndUpdate(
    {
      _id: eventId,
      $expr: { $lt: [{ $ifNull: ['$registeredCount', 0] }, '$capacity'] },
    },
    { $inc: { registeredCount: 1 } },
    { returnDocument: 'after' }
  );

  if (!event) {
    const eventExists = await Event.findById(eventId);
    if (!eventExists) throw new HttpError(404, 'Event not found');
    throw new HttpError(409, 'Event is full');
  }

  try {
    const registration = await Registration.create({ ...value, eventId: event._id });
    res.status(201).json(registration);
  } catch (err) {
    await Event.updateOne({ _id: event._id }, { $inc: { registeredCount: -1 } });
    throw err;
  }
}

async function listRegistrations(req, res) {
  const event = await findEventOr404(req.params.eventId);
  const registrations = await Registration.find({ eventId: event._id }).sort({ registeredAt: 1 });
  res.json(registrations);
}

module.exports = { registerParticipant, listRegistrations };
