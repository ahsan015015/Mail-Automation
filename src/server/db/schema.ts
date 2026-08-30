/**
 * Migrations, applied in order and versioned through `PRAGMA user_version`.
 * Timestamps are always ISO-8601 UTC strings (`Date.toISOString()`), which are
 * lexicographically ordered, so range filters work without SQLite date maths.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'owner',
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE lists (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL UNIQUE,
    description    TEXT NOT NULL DEFAULT '',
    subscribe_token TEXT NOT NULL DEFAULT '',
    archived       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE TABLE contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL DEFAULT '',
    fields          TEXT NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'subscribed',
    unsubscribed_at TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX contacts_status_idx ON contacts(status);
  CREATE INDEX contacts_created_idx ON contacts(created_at DESC, id DESC);

  CREATE TABLE contact_lists (
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (contact_id, list_id)
  );
  CREATE INDEX contact_lists_list_idx ON contact_lists(list_id);

  CREATE TABLE tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL
  );

  CREATE TABLE contact_tags (
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
  );
  CREATE INDEX contact_tags_tag_idx ON contact_tags(tag_id);

  CREATE TABLE templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    subject    TEXT NOT NULL DEFAULT '',
    preheader  TEXT NOT NULL DEFAULT '',
    html       TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE campaigns (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    type               TEXT NOT NULL DEFAULT 'broadcast',
    status             TEXT NOT NULL DEFAULT 'draft',
    from_name          TEXT NOT NULL DEFAULT '',
    from_email         TEXT NOT NULL DEFAULT '',
    reply_to           TEXT NOT NULL DEFAULT '',
    segment            TEXT NOT NULL DEFAULT '{}',
    schedule           TEXT NOT NULL DEFAULT '{}',
    tracking           TEXT NOT NULL DEFAULT '{}',
    scheduled_start_at TEXT,
    started_at         TEXT,
    completed_at       TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );
  CREATE INDEX campaigns_status_idx ON campaigns(status);

  CREATE TABLE steps (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL DEFAULT 0,
    name           TEXT NOT NULL DEFAULT '',
    template_id    INTEGER REFERENCES templates(id) ON DELETE SET NULL,
    subject        TEXT NOT NULL DEFAULT '',
    preheader       TEXT NOT NULL DEFAULT '',
    html           TEXT NOT NULL DEFAULT '',
    text           TEXT NOT NULL DEFAULT '',
    delay_minutes  INTEGER NOT NULL DEFAULT 0,
    skip_if_opened INTEGER NOT NULL DEFAULT 0,
    skip_if_clicked INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE UNIQUE INDEX steps_position_uq ON steps(campaign_id, position);
  CREATE INDEX steps_campaign_idx ON steps(campaign_id);

  /* One row per (step, contact): the queue *and* the delivery record. */
  CREATE TABLE sends (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step_id     INTEGER REFERENCES steps(id) ON DELETE CASCADE,
    contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    to_email    TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'queued',
    attempts    INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    message_id  TEXT,
    transport   TEXT,
    send_after  TEXT NOT NULL,
    sent_at     TEXT,
    opened_at   TEXT,
    clicked_at  TEXT,
    open_count  INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (step_id, contact_id)
  );
  CREATE INDEX sends_due_idx ON sends(status, send_after);
  CREATE INDEX sends_campaign_idx ON sends(campaign_id, status);
  CREATE INDEX sends_contact_idx ON sends(contact_id);
  CREATE INDEX sends_sent_at_idx ON sends(sent_at DESC, id DESC);

  CREATE TABLE events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    campaign_id INTEGER,
    contact_id  INTEGER,
    send_id     INTEGER,
    message     TEXT NOT NULL DEFAULT '',
    meta        TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
  );
  CREATE INDEX events_recent_idx ON events(created_at DESC, id DESC);
  CREATE INDEX events_campaign_idx ON events(campaign_id);

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  /* Local mail catcher: every rendered message is stored here when the
     transport is not a real SMTP server, so the app is demoable offline. */
  CREATE TABLE mailbox (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email          TEXT NOT NULL,
    to_name           TEXT NOT NULL DEFAULT '',
    from_email        TEXT NOT NULL DEFAULT '',
    from_name         TEXT NOT NULL DEFAULT '',
    reply_to          TEXT NOT NULL DEFAULT '',
    subject           TEXT NOT NULL DEFAULT '',
    html              TEXT NOT NULL DEFAULT '',
    text              TEXT NOT NULL DEFAULT '',
    headers           TEXT NOT NULL DEFAULT '{}',
    message_id        TEXT,
    send_id           INTEGER,
    campaign_id       INTEGER,
    eml_path          TEXT,
    simulated_open_at TEXT,
    created_at        TEXT NOT NULL
  );
  CREATE INDEX mailbox_created_idx ON mailbox(created_at DESC, id DESC);
  CREATE INDEX mailbox_send_idx ON mailbox(send_id);
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length
