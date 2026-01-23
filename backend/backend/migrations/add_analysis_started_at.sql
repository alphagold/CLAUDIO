-- Add analysis timing columns to photos table
ALTER TABLE photos ADD COLUMN IF NOT EXISTS analysis_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS analysis_duration_seconds INTEGER;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_photos_analysis_started_at ON photos(analysis_started_at);

-- Add helpful comment
COMMENT ON COLUMN photos.analysis_started_at IS 'Timestamp when AI analysis started';
COMMENT ON COLUMN photos.analysis_duration_seconds IS 'Total seconds taken to complete analysis';
