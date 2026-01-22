-- Add role column to users table
-- Roles: 'admin', 'editor', 'viewer'
-- Admin: full access
-- Editor: can upload/edit/delete own photos
-- Viewer: can only view own photos

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'editor' NOT NULL;

-- Update existing admins
UPDATE users SET role = 'admin' WHERE is_admin = TRUE;

-- Update other users to editor
UPDATE users SET role = 'editor' WHERE is_admin = FALSE;

-- Keep is_admin for backward compatibility but use role as source of truth
