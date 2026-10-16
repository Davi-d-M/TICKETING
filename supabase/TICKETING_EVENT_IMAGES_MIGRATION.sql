-- Public read-only image storage for ticket event artwork.
-- Uploads and replacements are performed only by the authenticated server API.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'ticketing-event-images',
    'ticketing-event-images',
    true,
    4194304,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can view ticketing event photos" ON storage.objects;
CREATE POLICY "Public can view ticketing event photos"
    ON storage.objects FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'ticketing-event-images');

COMMIT;
