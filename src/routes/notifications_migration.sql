-- Upgrade complaints
ALTER TABLE complaints
ADD COLUMN IF NOT EXISTS admin_response TEXT,
ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- Allow the complaint workflow:
-- open -> in_progress -> resolved
ALTER TABLE complaints
DROP CONSTRAINT IF EXISTS complaints_status_check;

ALTER TABLE complaints
ADD CONSTRAINT complaints_status_check
CHECK (status IN ('open', 'in_progress', 'resolved'));

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
ON notifications(recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
ON notifications(recipient_user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created
ON notifications(created_at DESC);
