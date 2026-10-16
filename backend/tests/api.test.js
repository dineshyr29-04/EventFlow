import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

// Load the CommonJS app through require so the app and the tests share one Mongoose instance
const require = createRequire(import.meta.url);
const app = require('../src/app.js');
const Event = require('../src/models/Event.js');
const Registration = require('../src/models/Registration.js');
const mongoose = require('mongoose');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Registration.init(); // make sure the unique index exists
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await Event.deleteMany({});
  await Registration.deleteMany({});
});

const validEvent = (overrides = {}) => ({
  title: 'Node Meetup',
  description: 'Talks about Node.js',
  date: '2099-01-15',
  time: '18:30',
  location: 'Hyderabad',
  organizer: 'NxtLabTech',
  capacity: 2,
  ...overrides,
});

const createEvent = async (overrides) => (await request(app).post('/api/events').send(validEvent(overrides))).body;

describe('events', () => {
  test('creates an event', async () => {
    const res = await request(app).post('/api/events').send(validEvent());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Node Meetup', capacity: 2 });
    expect(res.body._id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
  });

  test('rejects invalid event data with 400', async () => {
    const res = await request(app)
      .post('/api/events')
      .send(validEvent({ title: '', date: '2026-02-31', capacity: 0 }));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details)).toEqual(expect.arrayContaining(['title', 'date', 'capacity']));
  });

  test('rejects overly long title', async () => {
    const res = await request(app).post('/api/events').send(validEvent({ title: 'x'.repeat(101) }));
    expect(res.status).toBe(400);
    expect(res.body.details.title).toBeDefined();
  });

  test('lists events sorted by date', async () => {
    await createEvent({ title: 'Later', date: '2099-05-01' });
    await createEvent({ title: 'Sooner', date: '2099-02-01' });
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.title)).toEqual(['Sooner', 'Later']);
  });

  test('gets an event by id with registration count', async () => {
    const event = await createEvent();
    const res = await request(app).get(`/api/events/${event._id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Node Meetup');
    expect(res.body.registrationCount).toBe(0);
  });

  test('returns 404 for unknown or malformed event id', async () => {
    const missing = await request(app).get(`/api/events/${new mongoose.Types.ObjectId()}`);
    expect(missing.status).toBe(404);
    const malformed = await request(app).get('/api/events/not-an-id');
    expect(malformed.status).toBe(404);
  });

  test('updates an event', async () => {
    const event = await createEvent();
    const res = await request(app)
      .put(`/api/events/${event._id}`)
      .send(validEvent({ title: 'Renamed', capacity: 10 }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Renamed', capacity: 10 });
  });

  test('does not allow capacity below current registrations', async () => {
    const event = await createEvent({ capacity: 2 });
    await request(app).post(`/api/events/${event._id}/register`).send({ name: 'A', email: 'a@x.com' });
    await request(app).post(`/api/events/${event._id}/register`).send({ name: 'B', email: 'b@x.com' });
    const res = await request(app).put(`/api/events/${event._id}`).send(validEvent({ capacity: 1 }));
    expect(res.status).toBe(400);
    expect(res.body.details.capacity).toBeDefined();
  });

  test('update of missing event returns 404', async () => {
    const res = await request(app).put(`/api/events/${new mongoose.Types.ObjectId()}`).send(validEvent());
    expect(res.status).toBe(404);
  });

  test('deletes an event and its registrations', async () => {
    const event = await createEvent();
    await request(app).post(`/api/events/${event._id}/register`).send({ name: 'A', email: 'a@x.com' });
    const res = await request(app).delete(`/api/events/${event._id}`);
    expect(res.status).toBe(200);
    expect((await request(app).get(`/api/events/${event._id}`)).status).toBe(404);
    expect(await Registration.countDocuments()).toBe(0);
  });
});

describe('registrations', () => {
  test('registers a participant and lists them', async () => {
    const event = await createEvent();
    const res = await request(app)
      .post(`/api/events/${event._id}/register`)
      .send({ name: 'Asha', email: 'Asha@Example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Asha', email: 'asha@example.com', eventId: event._id });

    const list = await request(app).get(`/api/events/${event._id}/registrations`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  test('rejects invalid name/email', async () => {
    const event = await createEvent();
    const res = await request(app).post(`/api/events/${event._id}/register`).send({ name: ' ', email: 'nope' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details)).toEqual(expect.arrayContaining(['name', 'email']));
  });

  test('rejects duplicate registration with 409', async () => {
    const event = await createEvent();
    const body = { name: 'Asha', email: 'asha@example.com' };
    await request(app).post(`/api/events/${event._id}/register`).send(body);
    const res = await request(app).post(`/api/events/${event._id}/register`).send({ ...body, email: 'ASHA@example.com' });
    expect(res.status).toBe(409);
  });

  test('rejects registration when capacity is reached', async () => {
    const event = await createEvent({ capacity: 1 });
    await request(app).post(`/api/events/${event._id}/register`).send({ name: 'A', email: 'a@x.com' });
    const res = await request(app).post(`/api/events/${event._id}/register`).send({ name: 'B', email: 'b@x.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/full/i);
  });

  test('registration for a nonexistent event returns 404', async () => {
    const id = new mongoose.Types.ObjectId();
    const post = await request(app).post(`/api/events/${id}/register`).send({ name: 'A', email: 'a@x.com' });
    expect(post.status).toBe(404);
    const get = await request(app).get(`/api/events/${id}/registrations`);
    expect(get.status).toBe(404);
  });

  test('handles simultaneous registration requests safely without exceeding capacity', async () => {
    const event = await createEvent({ capacity: 1 });
    const requests = [
      request(app).post(`/api/events/${event._id}/register`).send({ name: 'User 1', email: 'user1@example.com' }),
      request(app).post(`/api/events/${event._id}/register`).send({ name: 'User 2', email: 'user2@example.com' }),
      request(app).post(`/api/events/${event._id}/register`).send({ name: 'User 3', email: 'user3@example.com' }),
      request(app).post(`/api/events/${event._id}/register`).send({ name: 'User 4', email: 'user4@example.com' }),
    ];

    const responses = await Promise.all(requests);
    const successes = responses.filter((r) => r.status === 201);
    const fullErrors = responses.filter((r) => r.status === 409 && /full/i.test(r.body.error));

    expect(successes).toHaveLength(1);
    expect(fullErrors).toHaveLength(3);
    expect(await Registration.countDocuments({ eventId: event._id })).toBe(1);
  });

  test('handles concurrent registrations with multiple seats without overfilling', async () => {
    const event = await createEvent({ capacity: 3 });
    const requests = Array.from({ length: 6 }, (_, i) =>
      request(app)
        .post(`/api/events/${event._id}/register`)
        .send({ name: `User ${i}`, email: `user${i}@example.com` })
    );

    const responses = await Promise.all(requests);
    const successes = responses.filter((r) => r.status === 201);
    const fullErrors = responses.filter((r) => r.status === 409 && /full/i.test(r.body.error));

    expect(successes).toHaveLength(3);
    expect(fullErrors).toHaveLength(3);
    expect(await Registration.countDocuments({ eventId: event._id })).toBe(3);
  });

  test('handles concurrent registration attempts with duplicate email safely', async () => {
    const event = await createEvent({ capacity: 5 });
    const requests = [
      request(app).post(`/api/events/${event._id}/register`).send({ name: 'Asha', email: 'asha@example.com' }),
      request(app).post(`/api/events/${event._id}/register`).send({ name: 'Asha Copy', email: 'asha@example.com' }),
    ];

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await Registration.countDocuments({ eventId: event._id })).toBe(1);
  });
});

describe('stats & misc', () => {
  test('returns dashboard stats', async () => {
    const upcoming = await createEvent({ date: '2099-01-01' });
    await createEvent({ date: '2000-01-01' });
    await request(app).post(`/api/events/${upcoming._id}/register`).send({ name: 'A', email: 'a@x.com' });
    const res = await request(app).get('/api/stats');
    expect(res.body).toEqual({ totalEvents: 2, totalRegistrations: 1, upcomingEvents: 1 });
  });

  test('invalid JSON returns 400 and unknown route 404', async () => {
    const bad = await request(app).post('/api/events').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});
