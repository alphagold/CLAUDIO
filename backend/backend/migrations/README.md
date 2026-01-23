# Database Migrations

This directory contains SQL migration files for the Photo Memory database schema.

## Available Migrations

### `add_analysis_started_at.sql`
**Date**: 2026-01-23
**Description**: Adds timing columns for tracking AI analysis duration

**Changes**:
- Adds `analysis_started_at TIMESTAMP WITH TIME ZONE` column
- Adds `analysis_duration_seconds INTEGER` column
- Creates index on `analysis_started_at`
- Adds column comments

**Required**: Yes, if upgrading from version < 1.1.0

## How to Run Migrations

### Option 1: Fresh Installation (Recommended for Development)

If you don't need to preserve existing data:

```bash
# Stop and remove all containers and volumes
docker compose down -v

# Start fresh (will use updated init.sql)
docker compose up -d
```

The updated `init.sql` already includes all migration changes, so fresh installations don't need separate migrations.

### Option 2: Migrate Existing Database (Preserve Data)

If you have existing photos and users to preserve:

```bash
# From the backend directory
docker compose exec -T db psql -U photo_memory_user -d photo_memory < backend/migrations/add_analysis_started_at.sql
```

**Note**: Replace `photo_memory_user` and `photo_memory` with your actual database username and database name if different.

### Verify Migration Success

```bash
# Check that columns exist
docker compose exec db psql -U photo_memory_user -d photo_memory -c "\d photos"

# You should see:
# - analysis_started_at | timestamp with time zone |
# - analysis_duration_seconds | integer |
```

## Migration Safety

All migrations use `IF NOT EXISTS` clauses to be idempotent:
- Safe to run multiple times
- Won't fail if columns already exist
- Won't affect existing data

## Creating New Migrations

When adding new database changes:

1. Create a new SQL file with descriptive name: `YYYY-MM-DD_description.sql`
2. Use `IF NOT EXISTS` for new tables/columns
3. Add comments explaining what and why
4. Update `init.sql` to include the changes
5. Test on fresh database: `docker compose down -v && docker compose up -d`
6. Test migration on existing database with sample data
7. Document in CHANGELOG.md
8. Update this README

## Migration Best Practices

✅ **DO**:
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Add indexes for new columns that will be queried
- Include helpful column comments
- Test both fresh installs and migrations
- Document breaking changes in CHANGELOG

❌ **DON'T**:
- Rename columns (breaks existing code)
- Delete columns with data (add `deleted_at` instead)
- Add `NOT NULL` constraints to existing tables without defaults
- Change column types without data migration

## Rollback

If a migration causes issues:

```bash
# Quick rollback: restore from backup
docker compose down
docker volume rm backend_postgres_data
# Restore from backup...

# Or manually remove columns (DANGEROUS - loses data):
docker compose exec db psql -U photo_memory_user -d photo_memory -c "
  ALTER TABLE photos DROP COLUMN IF EXISTS analysis_started_at;
  ALTER TABLE photos DROP COLUMN IF EXISTS analysis_duration_seconds;
"
```

## Troubleshooting

### Error: "column already exists"
- Safe to ignore if using `IF NOT EXISTS`
- Or migration was already run successfully

### Error: "relation does not exist"
- Database not initialized yet
- Run: `docker compose down -v && docker compose up -d`

### Error: "permission denied"
- Check database user has ALTER TABLE privileges
- Verify credentials in docker-compose.yml

## Support

For migration issues:
- Check `docker compose logs db`
- Verify database connection: `docker compose exec db psql -U photo_memory_user -d photo_memory -c "\dt"`
- Report issues: https://github.com/alphagold/CLAUDIO/issues
