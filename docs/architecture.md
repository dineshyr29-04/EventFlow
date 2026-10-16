# Architecture and design decisions

```
React (5173) ──/api──▶ Express (5000) ──▶ MongoDB ◀── FastAPI (8000)   [reads]
                                              │
                                              └──▶ Django admin (8001)  [snapshot via sync_from_mongo]
```

## Decisions

- **Express is the only writer.** Business rules (validation, duplicate and capacity checks) live in one place.
- **Validation is hand-written** (`backend/src/services/validation.js`) instead of adding a library; Mongoose schema constraints act as a second line of defence.
- **Dates**: `date` is stored as a UTC-midnight `Date`, `time` as an `HH:MM` string. "Upcoming" = date >= start of today (UTC).
- **Duplicate registrations**: an explicit check gives a friendly 409, and a unique index on `(eventId, email)` covers concurrent requests.
- **Capacity**: atomically checked and reserved at the database level using `findOneAndUpdate` on `Event.registeredCount`, preventing race conditions from concurrent registration requests.
- **Deleting an event** also deletes its registrations.
- **FastAPI reads MongoDB directly** with PyMongo and returns three counts. It is read-only. Tests inject an in-memory `mongomock` database through a FastAPI dependency.
- **Django + MongoDB**: Django has no first-class MongoDB support. Rather than pull in an experimental backend, Django keeps a SQLite snapshot filled by `sync_from_mongo`, and the admin is read-only. This shows Django admin without a duplicate second backend.
- **Backend tests use Vitest** rather than Jest: Jest's sandbox breaks the MongoDB driver's client metadata handshake.
- **No authentication**: out of scope for the MVP; anyone who can reach the API can edit data. Do not expose it publicly as-is.
