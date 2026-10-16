from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from eventdata.sync import sync_from_mongo


class Command(BaseCommand):
    help = "Copy events and registrations from the EventFlow MongoDB database into the admin snapshot."

    def handle(self, *args, **options):
        if not settings.MONGODB_URI:
            raise CommandError("MONGODB_URI is not set. Copy .env.example to .env and set it.")
        client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=3000)
        try:
            events, registrations = sync_from_mongo(client.get_default_database())
        except PyMongoError as exc:
            raise CommandError(f"Could not read from MongoDB: {exc}") from exc
        except ValidationError as exc:
            raise CommandError(f"Validation error: {exc}") from exc
        finally:
            client.close()
        self.stdout.write(self.style.SUCCESS(f"Synced {events} events and {registrations} registrations."))
