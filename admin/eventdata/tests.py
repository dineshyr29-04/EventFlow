from datetime import datetime, timezone
from unittest.mock import patch

import mongomock
from bson import ObjectId
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from .models import Event, Registration
from .sync import sync_from_mongo


def make_db():
    db = mongomock.MongoClient().eventflow
    event_id = ObjectId()
    db.events.insert_one(
        {
            "_id": event_id,
            "title": "Node Meetup",
            "description": "Talks",
            "date": datetime(2099, 1, 15, tzinfo=timezone.utc),
            "time": "18:30",
            "location": "Hyderabad",
            "organizer": "NxtLabTech",
            "capacity": 10,
            "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
        }
    )
    db.registrations.insert_many(
        [
            {"name": "Asha", "email": "asha@example.com", "eventId": event_id, "registeredAt": datetime(2026, 2, 1, tzinfo=timezone.utc)},
            {"name": "Orphan", "email": "o@example.com", "eventId": ObjectId()},
        ]
    )
    return db


class SyncTests(TestCase):
    def test_sync_copies_events_and_registrations(self):
        events, registrations = sync_from_mongo(make_db())
        self.assertEqual((events, registrations), (1, 1))
        event = Event.objects.get()
        self.assertEqual(event.title, "Node Meetup")
        self.assertEqual(str(event.date), "2099-01-15")
        self.assertEqual(Registration.objects.get().event, event)

    def test_sync_is_repeatable(self):
        db = make_db()
        sync_from_mongo(db)
        sync_from_mongo(db)
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 1)

    def test_sync_rejects_oversized_event_title(self):
        db = mongomock.MongoClient().eventflow
        db.events.insert_one(
            {
                "_id": ObjectId(),
                "title": "A" * 101,
                "description": "Talks",
                "date": datetime(2099, 1, 15, tzinfo=timezone.utc),
                "time": "18:30",
                "location": "Hyderabad",
                "organizer": "NxtLabTech",
                "capacity": 10,
                "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
        )
        with self.assertRaises(ValidationError) as ctx:
            sync_from_mongo(db)
        self.assertIn("title", ctx.exception.message_dict)

    def test_sync_rejects_oversized_event_location(self):
        db = mongomock.MongoClient().eventflow
        db.events.insert_one(
            {
                "_id": ObjectId(),
                "title": "Node Meetup",
                "description": "Talks",
                "date": datetime(2099, 1, 15, tzinfo=timezone.utc),
                "time": "18:30",
                "location": "L" * 201,
                "organizer": "NxtLabTech",
                "capacity": 10,
                "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
        )
        with self.assertRaises(ValidationError) as ctx:
            sync_from_mongo(db)
        self.assertIn("location", ctx.exception.message_dict)

    def test_sync_rejects_oversized_registration_name(self):
        db = mongomock.MongoClient().eventflow
        event_id = ObjectId()
        db.events.insert_one(
            {
                "_id": event_id,
                "title": "Node Meetup",
                "description": "Talks",
                "date": datetime(2099, 1, 15, tzinfo=timezone.utc),
                "time": "18:30",
                "location": "Hyderabad",
                "organizer": "NxtLabTech",
                "capacity": 10,
                "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
        )
        db.registrations.insert_one(
            {
                "_id": ObjectId(),
                "name": "N" * 101,
                "email": "user@example.com",
                "eventId": event_id,
                "registeredAt": datetime(2026, 2, 1, tzinfo=timezone.utc),
            }
        )
        with self.assertRaises(ValidationError) as ctx:
            sync_from_mongo(db)
        self.assertIn("name", ctx.exception.message_dict)

    def test_sync_rejects_invalid_registration_email(self):
        db = mongomock.MongoClient().eventflow
        event_id = ObjectId()
        db.events.insert_one(
            {
                "_id": event_id,
                "title": "Node Meetup",
                "description": "Talks",
                "date": datetime(2099, 1, 15, tzinfo=timezone.utc),
                "time": "18:30",
                "location": "Hyderabad",
                "organizer": "NxtLabTech",
                "capacity": 10,
                "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
        )
        db.registrations.insert_one(
            {
                "_id": ObjectId(),
                "name": "Asha",
                "email": "invalid-email-address",
                "eventId": event_id,
                "registeredAt": datetime(2026, 2, 1, tzinfo=timezone.utc),
            }
        )
        with self.assertRaises(ValidationError) as ctx:
            sync_from_mongo(db)
        self.assertIn("email", ctx.exception.message_dict)

    def test_sync_rolls_back_on_invalid_data(self):
        # Initial sync with valid data
        sync_from_mongo(make_db())
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 1)
        original_event = Event.objects.get()

        # Attempt to sync database with a valid event followed by an invalid event
        failing_db = mongomock.MongoClient().eventflow
        failing_db.events.insert_many(
            [
                {
                    "_id": ObjectId(),
                    "title": "Valid First Event",
                    "description": "",
                    "date": datetime(2099, 1, 1, tzinfo=timezone.utc),
                    "time": "10:00",
                    "location": "Venue",
                    "organizer": "Org",
                    "capacity": 20,
                    "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                    "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
                },
                {
                    "_id": ObjectId(),
                    "title": "T" * 105,  # oversized
                    "description": "",
                    "date": datetime(2099, 1, 2, tzinfo=timezone.utc),
                    "time": "11:00",
                    "location": "Venue 2",
                    "organizer": "Org 2",
                    "capacity": 10,
                    "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                    "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
                },
            ]
        )

        with self.assertRaises(ValidationError):
            sync_from_mongo(failing_db)

        # Existing valid data must be preserved due to transaction rollback
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 1)
        self.assertEqual(Event.objects.get().pk, original_event.pk)
        self.assertEqual(Event.objects.get().title, "Node Meetup")

    def test_sync_rolls_back_on_invalid_registration(self):
        sync_from_mongo(make_db())
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 1)

        failing_db = mongomock.MongoClient().eventflow
        event_id = ObjectId()
        failing_db.events.insert_one(
            {
                "_id": event_id,
                "title": "New Event",
                "description": "",
                "date": datetime(2099, 2, 1, tzinfo=timezone.utc),
                "time": "12:00",
                "location": "New Venue",
                "organizer": "New Org",
                "capacity": 5,
                "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
        )
        failing_db.registrations.insert_one(
            {
                "_id": ObjectId(),
                "name": "New User",
                "email": "not-an-email",
                "eventId": event_id,
                "registeredAt": datetime(2026, 2, 1, tzinfo=timezone.utc),
            }
        )

        with self.assertRaises(ValidationError):
            sync_from_mongo(failing_db)

        # Preserved previous data
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 1)
        self.assertEqual(Event.objects.get().title, "Node Meetup")


class AdminTests(TestCase):
    def setUp(self):
        sync_from_mongo(make_db())
        get_user_model().objects.create_superuser("admin", "a@example.com", "pw-for-tests-123")
        self.client.login(username="admin", password="pw-for-tests-123")

    def test_lists_load(self):
        for path in ("/eventdata/event/", "/eventdata/registration/"):
            self.assertEqual(self.client.get(path).status_code, 200)

    def test_admin_is_read_only(self):
        self.assertEqual(self.client.get("/eventdata/event/add/").status_code, 403)
        self.assertEqual(self.client.get(f"/eventdata/event/{Event.objects.get().pk}/delete/").status_code, 403)


class CommandTests(TestCase):
    @patch("eventdata.management.commands.sync_from_mongo.MongoClient")
    @patch("eventdata.management.commands.sync_from_mongo.settings.MONGODB_URI", "mongodb://localhost:27017/eventflow")
    def test_sync_command_raises_command_error_on_validation_failure(self, mock_client_cls):
        db = mongomock.MongoClient().eventflow
        db.events.insert_one(
            {
                "_id": ObjectId(),
                "title": "T" * 105,
                "description": "",
                "date": datetime(2099, 1, 1, tzinfo=timezone.utc),
                "time": "10:00",
                "location": "Venue",
                "organizer": "Org",
                "capacity": 10,
                "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "updatedAt": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
        )
        mock_client = mock_client_cls.return_value
        mock_client.get_default_database.return_value = db

        with self.assertRaises(CommandError) as ctx:
            call_command("sync_from_mongo")
        self.assertIn("Validation error", str(ctx.exception))
        self.assertIn("title", str(ctx.exception))

