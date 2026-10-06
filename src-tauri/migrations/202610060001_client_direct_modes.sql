-- 每个原生客户端独立记录直连；此表不保存密钥或认证内容。
CREATE TABLE client_direct_modes (
    client_key TEXT PRIMARY KEY CHECK (client_key IN ('codex', 'claude_code')),
    credential_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    credential_kind TEXT NOT NULL,
    config_path TEXT NOT NULL,
    auth_location TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL,
    config_backup_path TEXT,
    auth_backup_path TEXT,
    updated_at TEXT NOT NULL
);
