-- One row per (day, app, event, version, days since install), holding only a count. days is -1 except on "opened".
CREATE TABLE IF NOT EXISTS counts (
  date    TEXT    NOT NULL,
  app     TEXT    NOT NULL,
  event   TEXT    NOT NULL,
  version TEXT    NOT NULL,
  days    INTEGER NOT NULL DEFAULT -1,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, app, event, version, days)
);
