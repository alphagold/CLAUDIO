# Changelog

All notable changes to the Photo Memory project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Analysis timing tracking with server-side timestamps
  - `analysis_started_at` column to track exact start time of AI analysis
  - `analysis_duration_seconds` column to track total analysis time
  - Database index on `analysis_started_at` for faster queries
- Modern UI/UX improvements across all pages
  - RegisterPage: Gradient backgrounds, animated elements, modern buttons
  - MapPage: Custom animated markers with pulse effects, enhanced popups
  - GalleryPage: Fade-in animations for all photo cards
  - PhotoDetailPage: Fade-in animations for all detail cards
  - PhotoUpload: Enhanced gradient effects and animated drop zone
- Performance optimizations
  - Code splitting with React.lazy() for all pages
  - Suspense loading fallback with modern design
  - React.memo for PhotoSkeleton component
  - Lazy loading images already implemented
- Custom Leaflet marker and popup styles with animations

### Changed
- Database schema updated with timing columns in `init.sql`
- Frontend TypeScript types updated to include new timing fields
- Pydantic schemas include `analysis_started_at` and `analysis_duration_seconds`
- SQLAlchemy models include new timing columns

### Fixed
- TypeScript error in PhotoUpload component accessing `uploadResponse.photo.id`
- Removed unused `ImageIcon` import from MapPage

### Migration Required
⚠️ **Breaking Change**: Database schema has been updated.

For existing installations, run:
```bash
# Option 1: Full reset (recommended for development)
docker compose down -v
docker compose up -d

# Option 2: Run migration (preserves existing data)
docker compose exec -T db psql -U photo_memory_user -d photo_memory < backend/migrations/add_analysis_started_at.sql
```

## [1.0.0] - 2026-01-23

### Initial Release
- FastAPI backend with JWT authentication
- PostgreSQL database with pgvector for semantic search
- Ollama Vision AI integration (Moondream, Llama 3.2 Vision)
- Photo upload with EXIF extraction
- AI-powered photo analysis with tags, descriptions, and object detection
- Gallery view with multiple display modes (grid small/large, list, details)
- Map view with geolocation support
- Admin dashboard with system monitoring
- React frontend with TypeScript
- Docker Compose deployment
- Default test user: test@example.com / test123

---

**Note**: For detailed migration instructions, see [backend/migrations/README.md](backend/migrations/README.md)
