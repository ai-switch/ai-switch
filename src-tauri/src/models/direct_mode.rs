use serde::{Deserialize, Serialize};

/// 前端只能获得账号绑定和配置状态，不返回凭据、备份位置或认证内容。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DirectModeStatus {
    pub client_key: String,
    pub credential_id: String,
    pub platform: String,
    pub credential_kind: String,
    pub status: String,
    pub updated_at: String,
    pub restart_required: bool,
}
