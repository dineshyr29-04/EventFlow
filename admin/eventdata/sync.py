from datetime import timezone

from django.db import transaction

from .models import Event, Registration


def _aware(dt):
    # pymongo returns naive datetimes (always UTC) unless tz_aware is set
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


def sync_from_mongo(db):
    """Replace the local snapshot with the current contents of MongoDB.

    `db` is a pymongo Database (or mongomock). Returns (events, registrations) counts.
    """
    with transaction.atomic():
        Registration.objects.all().delete()
        Event.objects.all().delete()

        events = {}
        for doc in db["events"].find():
            doc_date = doc.get("date")
            event_date = doc_date.date() if hasattr(doc_date, "date") else doc_date
            event = Event(
                mongo_id=str(doc["_id"]),
                title=doc.get("title"),
                description=doc.get("description", ""),
                date=event_date,
                time=doc.get("time"),
                location=doc.get("location"),
                organizer=doc.get("organizer"),
                capacity=doc.get("capacity"),
                created_at=_aware(doc.get("createdAt")),
                updated_at=_aware(doc.get("updatedAt")),
            )
            exclude = []
            if doc.get("createdAt") is None:
                exclude.append("created_at")
            if doc.get("updatedAt") is None:
                exclude.append("updated_at")
            event.full_clean(exclude=exclude or None)
            event.save()
            events[doc["_id"]] = event

        registrations = 0
        for doc in db["registrations"].find():
            event = events.get(doc["eventId"])
            if event is None:  # orphaned registration; skip it
                continue
            registration = Registration(
                mongo_id=str(doc["_id"]),
                name=doc.get("name"),
                email=doc.get("email"),
                event=event,
                registered_at=_aware(doc.get("registeredAt")),
            )
            exclude = []
            if doc.get("registeredAt") is None:
                exclude.append("registered_at")
            registration.full_clean(exclude=exclude or None)
            registration.save()
            registrations += 1

    return len(events), registrations
