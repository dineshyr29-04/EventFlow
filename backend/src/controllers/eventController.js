const Event = require('../models/Event');
const Registration = require('../models/Registration');
const HttpError = require('../utils/HttpError');
const { validateEventInput } = require('../services/validation');

async function findEventOr404(id) {
  const event = await Event.findById(id);
  if (!event) throw new HttpError(404, 'Event not found');
  return event;
}

function parseOrThrow(body) {
  const { errors, value } = validateEventInput(body);
  if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);
  return value;
}

async function createEvent(req, res) {
  const event = await Event.create(parseOrThrow(req.body));
  res.status(201).json(event);
}

async function listEvents(req, res) {
  const events = await Event.find().sort({ date: 1, time: 1 });
  res.json(events);
}

async function getEvent(req, res) {
  const event = await findEventOr404(req.params.id);
  const registrationCount = await Registration.countDocuments({ eventId: event._id });
  res.json({ ...event.toObject(), registrationCount });
}

async function updateEvent(req, res) {
  const event = await findEventOr404(req.params.id);
  const data = parseOrThrow(req.body);

  const registrationCount = await Registration.countDocuments({ eventId: event._id });
  if (data.capacity < registrationCount) {
    throw new HttpError(400, 'Validation failed', {
      capacity: `capacity cannot be lower than the current number of registrations (${registrationCount})`,
    });
  }

  event.set(data);
  event.registeredCount = registrationCount;
  await event.save();
  res.json(event);
}

async function deleteEvent(req, res) {
  const event = await findEventOr404(req.params.id);
  await Registration.deleteMany({ eventId: event._id });
  await event.deleteOne();
  res.json({ message: 'Event deleted' });
}

module.exports = { createEvent, listEvents, getEvent, updateEvent, deleteEvent, findEventOr404 };
