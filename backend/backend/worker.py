"""
Celery worker for async photo processing
TODO: Implement full Celery integration
"""
from celery import Celery
from config import settings

# Celery app
app = Celery(
    "photomemory",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

# Configuration
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)


@app.task(name="process_photo")
def process_photo_task(photo_id: str):
    """
    Process photo with Vision AI (async)
    TODO: Implement actual processing
    """
    print(f"Processing photo {photo_id}")
    return {"status": "completed", "photo_id": photo_id}


if __name__ == "__main__":
    app.start()
