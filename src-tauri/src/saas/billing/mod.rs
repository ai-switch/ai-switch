pub mod operations;
pub mod pricing;

use crate::error::AppError;
use crate::saas::{
    config,
    domain::groups,
    repository::{self, db_error, invalid},
};
use crate::videogen::protocol::{upstream_effective_duration, VideoDialect};
pub use pricing::{BillableUsage, ModelPrice};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, SqliteConnection, SqlitePool};

/// 一次视频请求最多生成几条。与 `videogen::service::MAX_VIDEO_COUNT` 保持一致，
/// 这里单独定义是为了让计费侧不依赖 videogen 模块（计费只管数量上下界）。
/// **例外是时长**：按秒计价的秒数必须与上游真的会执行的秒数同源
/// （`videogen::protocol::upstream_effective_duration`），那是本轮复审修正
/// 3a 的教训 —— 口径分叉的地方就会多收钱。
const MAX_VIDEO_COUNT: i64 = 1;
/// 一次视频请求可接受的时长上界（秒）。防呆用，不是产品限制：
/// 各家方言的最长时长由上游自己拒绝，这里只挡明显异常的输入。
const MAX_VIDEO_DURATION_SECONDS: i64 = 600;
/// 一次 TTS 请求可接受的 `input` 字符数上界。防呆用，不是产品限制：
/// **真正的每方言上限（OpenAI 4096、MiniMax 10000）由 `audiogen::protocol`
/// 在发上游之前把关**，这里只挡明显异常的输入（比如把整本书塞进来）。
const MAX_AUDIO_CHARACTERS: i64 = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApiPrincipal {
    pub user_id: String,
    pub key_id: String,
    pub group_id: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub request_id: String,
    pub user_id: String,
    pub key_id: String,
    pub group_id: String,
    pub platform: String,
    pub model: String,
    pub upstream_model: String,
    pub credential_ids: Vec<String>,
    pub reserved_micros: i64,
    pub price: ModelPrice,
    pub max_output_tokens: i64,
    pub timeout_seconds: i64,
    pub max_concurrency: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    pub request_id: String,
    pub user_id: String,
    pub key_id: String,
    pub group_id: String,
    pub model: String,
    pub status: String,
    pub price_usd_micros: Option<i64>,
    pub reserved_micros: i64,
}

#[derive(FromRow)]
struct Limits {
    balance_micros: i64,
    user_frozen: i64,
    spent_micros: i64,
    key_frozen: i64,
    limit_micros: Option<i64>,
    multiplier_micros: i64,
    max_output_tokens: i64,
    timeout_seconds: i64,
    max_concurrency: i64,
    allow_subscription: bool,
    allow_balance: bool,
}

#[derive(FromRow)]
pub(crate) struct StoredReservation {
    request_id: String,
    user_id: String,
    key_id: String,
    group_id: String,
    model: String,
    price_json: String,
    reserved_micros: i64,
    status: String,
    price_usd_micros: Option<i64>,
    funding_type: String,
    subscription_id: Option<String>,
    created_at: i64,
}

impl StoredReservation {
    fn result(&self) -> Settlement {
        Settlement {
            request_id: self.request_id.clone(),
            user_id: self.user_id.clone(),
            key_id: self.key_id.clone(),
            group_id: self.group_id.clone(),
            model: self.model.clone(),
            status: self.status.clone(),
            price_usd_micros: self.price_usd_micros,
            reserved_micros: self.reserved_micros,
        }
    }
}

/// 认证一把 `sk-saas-` key，返回它所属的组与平台。
///
/// 这里的平台白名单是「SaaS 能服务哪些平台」的总闸。**视频渠道必须在内**：
/// 少放一处，视频组的 key 就认证不过，后面所有计费代码都是死代码
/// （见 `reserve_video` 的注释与计划文档「遗留 0」）。
///
/// 视频只列 `'video'` 一项（供应商在账号的 `interface_format` 里，不是平台）。
/// 早先的写法是 `LIKE 'video:%'`：`Provider.kind` 曾是
/// 「模态:协议」，新方言不该再改一次 SQL。协议段本身的合法性由
/// `PlatformId::parse` 在凭据/导入边界把关，`video:<未知>` 到不了这里。
pub async fn authenticate_key(
    pool: &SqlitePool,
    plaintext_key: &str,
) -> Result<ApiPrincipal, AppError> {
    if !plaintext_key.starts_with("sk-saas-") || plaintext_key.len() != 72 {
        return Err(invalid("saas.invalid_key", "Invalid API key"));
    }
    let mut transaction = pool.begin().await.map_err(db_error)?;
    config::require_enabled(&mut transaction).await?;
    let principal: Option<ApiPrincipal> = sqlx::query_as("SELECT keys.user_id,keys.id AS key_id,keys.group_id,groups.platform FROM saas_api_keys keys JOIN saas_users users ON users.id=keys.user_id JOIN route_pool_groups groups ON groups.id=keys.group_id WHERE keys.token_hash=? AND keys.status='active' AND (keys.expires_at IS NULL OR keys.expires_at>?) AND users.status='active' AND (groups.platform IN ('codex','claude','gemini')) AND groups.is_internal=0 AND groups.deleted_at IS NULL")
        .bind(repository::hash_secret(plaintext_key)).bind(repository::now()).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;
    principal.ok_or_else(|| {
        invalid(
            "saas.invalid_key",
            "API key is invalid, expired or unavailable",
        )
    })
}

pub async fn reserve_image(
    pool: &SqlitePool,
    principal: &ApiPrincipal,
    model: &str,
    image_count: i64,
) -> Result<Reservation, AppError> {
    if !(1..=10).contains(&image_count) || model.is_empty() || model.len() > 256 {
        return Err(invalid(
            "saas.request_limits",
            "Invalid image model or count",
        ));
    }
    let mut transaction = repository::begin(pool).await?;
    config::require_enabled(&mut transaction).await?;
    let limits: Option<Limits> = sqlx::query_as("SELECT users.balance_micros,users.frozen_micros AS user_frozen,keys.spent_micros,keys.frozen_micros AS key_frozen,keys.limit_micros,settings.multiplier_micros,settings.max_output_tokens,settings.timeout_seconds,settings.max_concurrency,settings.allow_subscription,settings.allow_balance FROM saas_api_keys keys JOIN saas_users users ON users.id=keys.user_id JOIN route_pool_groups groups ON groups.id=keys.group_id JOIN saas_group_settings settings ON settings.group_id=groups.id WHERE keys.id=? AND keys.user_id=? AND keys.group_id=? AND groups.platform=? AND keys.status='active' AND (keys.expires_at IS NULL OR keys.expires_at>?) AND users.status='active' AND groups.platform IN ('codex','gemini') AND groups.is_internal=0 AND groups.deleted_at IS NULL")
        .bind(&principal.key_id).bind(&principal.user_id).bind(&principal.group_id).bind(&principal.platform).bind(repository::now()).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let limits =
        limits.ok_or_else(|| invalid("saas.invalid_key", "API key is no longer available"))?;
    crate::saas::domain::model_sync::reconcile_group_connection(
        &mut *transaction,
        &principal.group_id,
    )
    .await?;
    let priced: Option<(i64, String)> = sqlx::query_as("SELECT image_price_micros,upstream_model FROM saas_group_models WHERE group_id=? AND model=? AND sync_state='active' AND enabled=1")
        .bind(&principal.group_id).bind(model).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let (image_price_micros, upstream_model) =
        priced.filter(|(price, _)| *price > 0).ok_or_else(|| {
            invalid(
                "saas.model_not_allowed",
                "Image model is not priced and allowed by this group",
            )
        })?;
    let credential_ids = groups::permitted_accounts_for_capability_connection(
        &mut transaction,
        &principal.group_id,
        model,
        "image.generate",
    )
    .await?;
    if credential_ids.is_empty() {
        return Err(invalid(
            "saas.empty_pool",
            "No permitted account currently supports image generation",
        ));
    }
    let reserved_micros = repository::money(
        image_price_micros as i128 * image_count as i128 * limits.multiplier_micros as i128
            / 1_000_000_i128,
    )?;
    let reservation = reserve_fixed(
        &mut transaction,
        principal,
        model,
        upstream_model,
        credential_ids,
        reserved_micros,
        limits,
        serde_json::json!({"kind":"image","unitPriceMicros":image_price_micros,"count":image_count}).to_string(),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(reservation)
}

/// 视频生成的预留（G-P4）。计量单位是「每条视频」。
///
/// 与 `reserve_image` 的三点差异，都是视频这个模态本身带来的：
///   1. 计价列是 `video_price_micros`，不是 `image_price_micros`；
///   2. 账号筛选走 `video.generate` 能力，不是 `image.generate`；
///   3. `platform` 不再是 `codex`/`gemini` 这类**文本**池，而是
///      `video:kling` 这类**视频渠道**。上面那条 `Limits` 查询里的
///      `groups.platform IN (...)` 和 `groups.platform=?` 会直接把它挡掉，
///      所以视频必须有自己的 key/组校验查询。
///
/// 计价的时长是**方言折算后**的（`upstream_effective_duration`，复审 3a）：
/// `duration_seconds` 参数是客户端**请求**的秒数（校验用），快照里落的
/// `durationSeconds` 是上游真的会执行的秒数。
pub async fn reserve_video(
    pool: &SqlitePool,
    principal: &ApiPrincipal,
    model: &str,
    video_count: i64,
    duration_seconds: i64,
) -> Result<Reservation, AppError> {
    if !(1..=MAX_VIDEO_COUNT).contains(&video_count)
        || model.is_empty()
        || model.len() > 256
        // 时长上界只是防呆。真正计价的时长在下面按方言折算
        // （`upstream_effective_duration`）：Sora 会 clamp 到 1..20，智谱根本
        // 不收时长（按秒价按 0 计）—— 收的秒数必须等于上游会执行的秒数。
        || !(1..=MAX_VIDEO_DURATION_SECONDS).contains(&duration_seconds)
    {
        return Err(invalid(
            "saas.request_limits",
            "Invalid video model, count or duration",
        ));
    }
    let mut transaction = repository::begin(pool).await?;
    config::require_enabled(&mut transaction).await?;
    // `groups.platform` 绑的是 `principal.platform`（key 所属组的平台），所以这条
    // 查询本身就是「key 的组与这个组对得上」的一致性检查。视频账号搬进 codex 池之后
    // 这点更重要：一个 codex 组的 key 也能为视频请求付费，靠的不是 video 平台值，
    // 而是下面 `permitted_accounts_for_capability_connection` 按能力找账号。
    // （原注释说这里「刻意不限定 platform」，与 SQL 正好相反 —— 一直如此，本轮改正。）
    let limits: Option<Limits> = sqlx::query_as("SELECT users.balance_micros,users.frozen_micros AS user_frozen,keys.spent_micros,keys.frozen_micros AS key_frozen,keys.limit_micros,settings.multiplier_micros,settings.max_output_tokens,settings.timeout_seconds,settings.max_concurrency,settings.allow_subscription,settings.allow_balance FROM saas_api_keys keys JOIN saas_users users ON users.id=keys.user_id JOIN route_pool_groups groups ON groups.id=keys.group_id JOIN saas_group_settings settings ON settings.group_id=groups.id WHERE keys.id=? AND keys.user_id=? AND keys.group_id=? AND groups.platform=? AND keys.status='active' AND (keys.expires_at IS NULL OR keys.expires_at>?) AND users.status='active' AND groups.is_internal=0 AND groups.deleted_at IS NULL")
        .bind(&principal.key_id).bind(&principal.user_id).bind(&principal.group_id).bind(&principal.platform).bind(repository::now()).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let limits =
        limits.ok_or_else(|| invalid("saas.invalid_key", "API key is no longer available"))?;
    crate::saas::domain::model_sync::reconcile_group_connection(
        &mut *transaction,
        &principal.group_id,
    )
    .await?;
    // 单价 = 起步价 + 按秒价 × 时长（相加，见迁移 0008）。只配起步价的行
    // `per_second` 是 0，行为与 0007 完全一致。
    let priced: Option<(i64, i64, String)> = sqlx::query_as("SELECT video_price_micros,video_price_per_second_micros,upstream_model FROM saas_group_models WHERE group_id=? AND model=? AND sync_state='active' AND enabled=1")
        .bind(&principal.group_id).bind(model).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let (video_price_micros, video_price_per_second_micros, upstream_model) =
        priced.ok_or_else(|| {
            invalid(
                "saas.model_not_allowed",
                "Video model is not priced and allowed by this group",
            )
        })?;
    let credential_ids = groups::permitted_accounts_for_capability_connection(
        &mut transaction,
        &principal.group_id,
        model,
        "video.generate",
    )
    .await?;
    if credential_ids.is_empty() {
        return Err(invalid(
            "saas.empty_pool",
            "No permitted account currently supports video generation",
        ));
    }
    // 计价时长按**方言**折算（复审 3a）：供应商住在账号的 `interface_format` 上，
    // 候选账号的方言一致时按「上游真的会执行的时长」计价 —— Sora 只给 clamp 后
    // 的秒数，智谱不收时长（按秒价按 0 计，此时只剩起步价；只配按秒价的行会
    // fail closed，那是配置错误不是计费问题）。混合方言无法预知提交会落到哪家，
    // 退回客户端请求的时长（旧口径）；按秒价本来就不该配在混合方言的池上。
    let dialects: Vec<String> = {
        let mut query =
            sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT DISTINCT COALESCE(json_extract(config_json, '$.interface_format'), '') FROM route_credentials WHERE id IN (");
        let mut separated = query.separated(", ");
        for id in &credential_ids {
            separated.push_bind(id);
        }
        query.push(")");
        query
            .build_query_scalar::<String>()
            .fetch_all(&mut *transaction)
            .await
            .map_err(db_error)?
    };
    // config_json 没有 interface_format（不该发生：候选都声明了 video.generate）
    // 不算一种方言，从集合里剔掉。
    let dialects: Vec<String> = dialects
        .into_iter()
        .filter(|format| !format.is_empty())
        .collect();
    let billed_duration_seconds = match dialects.as_slice() {
        [only] => match VideoDialect::parse(only) {
            Some(dialect) => {
                upstream_effective_duration(dialect, duration_seconds).unwrap_or(0)
            }
            // 未知格式提交时会被 `submit` 拒掉并退款；这里维持旧口径即可。
            None => duration_seconds,
        },
        _ => duration_seconds,
    };
    // 单价 = 起步价 + 按秒价 × **折算后的**时长。只配起步价的行 `per_second`
    // 是 0，行为与 0007 完全一致。
    let unit_price = video_price_micros
        .checked_add(
            video_price_per_second_micros.saturating_mul(billed_duration_seconds),
        )
        .filter(|price| *price > 0)
        .ok_or_else(|| {
            invalid(
                "saas.model_not_allowed",
                "Video model has no usable price",
            )
        })?;
    let reserved_micros = repository::money(
        unit_price as i128 * video_count as i128 * limits.multiplier_micros as i128
            / 1_000_000_i128,
    )?;
    let reservation = reserve_fixed(
        &mut transaction,
        principal,
        model,
        upstream_model,
        credential_ids,
        reserved_micros,
        limits,
        serde_json::json!({"kind":"video","unitPriceMicros":unit_price,"count":video_count,"durationSeconds":billed_duration_seconds}).to_string(),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(reservation)
}

pub async fn reserve(
    pool: &SqlitePool,
    principal: &ApiPrincipal,
    model: &str,
    input_estimate: i64,
    output_limit: i64,
) -> Result<Reservation, AppError> {
    if !(0..=1_000_000).contains(&input_estimate)
        || !(1..=1_000_000).contains(&output_limit)
        || model.is_empty()
        || model.len() > 256
    {
        return Err(invalid(
            "saas.request_limits",
            "Invalid model or token limits",
        ));
    }
    let mut transaction = repository::begin(pool).await?;
    config::require_enabled(&mut transaction).await?;
    let limits: Option<Limits> = sqlx::query_as("SELECT users.balance_micros,users.frozen_micros AS user_frozen,keys.spent_micros,keys.frozen_micros AS key_frozen,keys.limit_micros,settings.multiplier_micros,settings.max_output_tokens,settings.timeout_seconds,settings.max_concurrency,settings.allow_subscription,settings.allow_balance FROM saas_api_keys keys JOIN saas_users users ON users.id=keys.user_id JOIN route_pool_groups groups ON groups.id=keys.group_id JOIN saas_group_settings settings ON settings.group_id=groups.id WHERE keys.id=? AND keys.user_id=? AND keys.group_id=? AND groups.platform=? AND keys.status='active' AND (keys.expires_at IS NULL OR keys.expires_at>?) AND users.status='active' AND groups.platform IN ('codex','claude','gemini') AND groups.is_internal=0 AND groups.deleted_at IS NULL")
        .bind(&principal.key_id).bind(&principal.user_id).bind(&principal.group_id).bind(&principal.platform).bind(repository::now()).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let limits =
        limits.ok_or_else(|| invalid("saas.invalid_key", "API key is no longer available"))?;
    if output_limit > limits.max_output_tokens {
        return Err(invalid(
            "saas.request_limits",
            "Requested output exceeds the group limit",
        ));
    }
    crate::saas::domain::model_sync::reconcile_group_connection(
        &mut *transaction,
        &principal.group_id,
    )
    .await?;
    let model_price: Option<(i64,i64,i64,String)> = sqlx::query_as("SELECT input_price_micros,cache_price_micros,output_price_micros,upstream_model FROM saas_group_models WHERE group_id=? AND model=? AND sync_state='active' AND enabled=1")
        .bind(&principal.group_id).bind(model).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let (input_price_micros, cache_price_micros, output_price_micros, upstream_model) = model_price
        .ok_or_else(|| {
            invalid(
                "saas.model_not_allowed",
                "Model is not priced and allowed by this group",
            )
        })?;
    let credential_ids =
        groups::permitted_accounts_connection(&mut transaction, &principal.group_id, Some(model))
            .await?;
    if credential_ids.is_empty() {
        return Err(invalid(
            "saas.empty_pool",
            "No permitted account currently supports this model",
        ));
    }
    let price = ModelPrice {
        input_price_micros,
        cache_price_micros,
        output_price_micros,
        multiplier_micros: limits.multiplier_micros,
    };
    let mut conservative_price = price.clone();
    conservative_price.input_price_micros = input_price_micros.max(cache_price_micros);
    let reserved_micros = conservative_price.charge(&BillableUsage {
        input_tokens: input_estimate,
        output_tokens: output_limit,
        ..Default::default()
    })?;
    let subscription_day = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let subscription_id: Option<String> = if limits.allow_subscription {
        sqlx::query_scalar("SELECT subscriptions.id FROM saas_subscriptions subscriptions LEFT JOIN saas_subscription_daily_usage daily ON daily.subscription_id=subscriptions.id AND daily.day=? WHERE subscriptions.user_id=? AND subscriptions.status='active' AND subscriptions.starts_at<=? AND subscriptions.expires_at>? AND subscriptions.quota_micros-COALESCE(daily.used_micros,0)-COALESCE(daily.frozen_micros,0)>=? ORDER BY subscriptions.expires_at,subscriptions.created_at,subscriptions.id LIMIT 1")
            .bind(&subscription_day).bind(&principal.user_id).bind(repository::now()).bind(repository::now()).bind(reserved_micros).fetch_optional(&mut *transaction).await.map_err(db_error)?
    } else {
        None
    };
    if reserved_micros > 0
        && subscription_id.is_none()
        && (!limits.allow_balance
            || limits.balance_micros as i128 - (limits.user_frozen as i128)
                < reserved_micros as i128)
    {
        return Err(invalid(
            "saas.insufficient_balance",
            "No eligible subscription or sufficient available balance",
        ));
    }
    let key_total =
        limits.spent_micros as i128 + limits.key_frozen as i128 + reserved_micros as i128;
    if limits
        .limit_micros
        .is_some_and(|limit| key_total > limit as i128)
    {
        return Err(invalid(
            "saas.key_quota",
            "API key spending limit has been reached",
        ));
    }
    let active: (i64,i64) = sqlx::query_as("SELECT COUNT(*),COALESCE(SUM(CASE WHEN key_id=? THEN 1 ELSE 0 END),0) FROM saas_billing_reservations WHERE user_id=? AND status='reserved'")
        .bind(&principal.key_id).bind(&principal.user_id).fetch_one(&mut *transaction).await.map_err(db_error)?;
    if active.0 >= limits.max_concurrency || active.1 >= limits.max_concurrency {
        return Err(invalid(
            "saas.concurrency_limit",
            "Too many concurrent requests",
        ));
    }
    let funding_type = if subscription_id.is_some() {
        "subscription"
    } else {
        "balance"
    };
    let user_frozen = repository::money(
        limits.user_frozen as i128
            + if subscription_id.is_none() {
                reserved_micros as i128
            } else {
                0
            },
    )?;
    let key_frozen = repository::money(limits.key_frozen as i128 + reserved_micros as i128)?;
    sqlx::query("UPDATE saas_users SET frozen_micros=?,updated_at=? WHERE id=?")
        .bind(user_frozen)
        .bind(repository::now())
        .bind(&principal.user_id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    if let Some(subscription_id) = &subscription_id {
        sqlx::query("INSERT INTO saas_subscription_daily_usage(subscription_id,day,used_micros,frozen_micros,updated_at) VALUES(?,?,0,?,?) ON CONFLICT(subscription_id,day) DO UPDATE SET frozen_micros=frozen_micros+excluded.frozen_micros,updated_at=excluded.updated_at")
            .bind(subscription_id).bind(&subscription_day).bind(reserved_micros).bind(repository::now()).execute(&mut *transaction).await.map_err(db_error)?;
    }
    sqlx::query("UPDATE saas_api_keys SET frozen_micros=?,updated_at=? WHERE id=?")
        .bind(key_frozen)
        .bind(repository::now())
        .bind(&principal.key_id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    let request_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO saas_billing_reservations(request_id,user_id,key_id,group_id,platform,model,price_json,reserved_micros,status,funding_type,subscription_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,?,?,?)")
        .bind(&request_id).bind(&principal.user_id).bind(&principal.key_id).bind(&principal.group_id).bind(&principal.platform).bind(model)
        .bind(serde_json::to_string(&price).map_err(|_| invalid("saas.pricing", "Could not preserve pricing snapshot"))?).bind(reserved_micros).bind(funding_type).bind(&subscription_id).bind(repository::now()).bind(repository::now()).execute(&mut *transaction).await.map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;
    Ok(Reservation {
        request_id,
        user_id: principal.user_id.clone(),
        key_id: principal.key_id.clone(),
        group_id: principal.group_id.clone(),
        platform: principal.platform.clone(),
        model: model.into(),
        upstream_model,
        credential_ids,
        reserved_micros,
        price,
        max_output_tokens: limits.max_output_tokens,
        timeout_seconds: limits.timeout_seconds,
        max_concurrency: limits.max_concurrency,
    })
}

async fn reserve_fixed(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &ApiPrincipal,
    model: &str,
    upstream_model: String,
    credential_ids: Vec<String>,
    reserved_micros: i64,
    limits: Limits,
    price_json: String,
) -> Result<Reservation, AppError> {
    let subscription_day = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let subscription_id: Option<String> = if limits.allow_subscription {
        sqlx::query_scalar("SELECT subscriptions.id FROM saas_subscriptions subscriptions LEFT JOIN saas_subscription_daily_usage daily ON daily.subscription_id=subscriptions.id AND daily.day=? WHERE subscriptions.user_id=? AND subscriptions.status='active' AND subscriptions.starts_at<=? AND subscriptions.expires_at>? AND subscriptions.quota_micros-COALESCE(daily.used_micros,0)-COALESCE(daily.frozen_micros,0)>=? ORDER BY subscriptions.expires_at,subscriptions.created_at,subscriptions.id LIMIT 1")
            .bind(&subscription_day).bind(&principal.user_id).bind(repository::now()).bind(repository::now()).bind(reserved_micros).fetch_optional(&mut **transaction).await.map_err(db_error)?
    } else {
        None
    };
    if reserved_micros > 0
        && subscription_id.is_none()
        && (!limits.allow_balance || limits.balance_micros - limits.user_frozen < reserved_micros)
    {
        return Err(invalid(
            "saas.insufficient_balance",
            "No eligible subscription or sufficient available balance",
        ));
    }
    if limits.limit_micros.is_some_and(|limit| {
        limits.spent_micros as i128 + limits.key_frozen as i128 + reserved_micros as i128
            > limit as i128
    }) {
        return Err(invalid(
            "saas.key_quota",
            "API key spending limit has been reached",
        ));
    }
    let active: (i64,i64) = sqlx::query_as("SELECT COUNT(*),COALESCE(SUM(CASE WHEN key_id=? THEN 1 ELSE 0 END),0) FROM saas_billing_reservations WHERE user_id=? AND status='reserved'")
        .bind(&principal.key_id).bind(&principal.user_id).fetch_one(&mut **transaction).await.map_err(db_error)?;
    if active.0 >= limits.max_concurrency || active.1 >= limits.max_concurrency {
        return Err(invalid(
            "saas.concurrency_limit",
            "Too many concurrent requests",
        ));
    }
    let funding_type = if subscription_id.is_some() {
        "subscription"
    } else {
        "balance"
    };
    if subscription_id.is_none() {
        sqlx::query("UPDATE saas_users SET frozen_micros=frozen_micros+?,updated_at=? WHERE id=?")
            .bind(reserved_micros)
            .bind(repository::now())
            .bind(&principal.user_id)
            .execute(&mut **transaction)
            .await
            .map_err(db_error)?;
    } else if let Some(subscription_id) = &subscription_id {
        sqlx::query("INSERT INTO saas_subscription_daily_usage(subscription_id,day,used_micros,frozen_micros,updated_at) VALUES(?,?,0,?,?) ON CONFLICT(subscription_id,day) DO UPDATE SET frozen_micros=frozen_micros+excluded.frozen_micros,updated_at=excluded.updated_at")
            .bind(subscription_id).bind(&subscription_day).bind(reserved_micros).bind(repository::now()).execute(&mut **transaction).await.map_err(db_error)?;
    }
    sqlx::query("UPDATE saas_api_keys SET frozen_micros=frozen_micros+?,updated_at=? WHERE id=?")
        .bind(reserved_micros)
        .bind(repository::now())
        .bind(&principal.key_id)
        .execute(&mut **transaction)
        .await
        .map_err(db_error)?;
    let request_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO saas_billing_reservations(request_id,user_id,key_id,group_id,platform,model,price_json,reserved_micros,status,funding_type,subscription_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,?,?,?)")
        .bind(&request_id).bind(&principal.user_id).bind(&principal.key_id).bind(&principal.group_id).bind(&principal.platform).bind(model).bind(price_json).bind(reserved_micros).bind(funding_type).bind(&subscription_id).bind(repository::now()).bind(repository::now()).execute(&mut **transaction).await.map_err(db_error)?;
    Ok(Reservation {
        request_id,
        user_id: principal.user_id.clone(),
        key_id: principal.key_id.clone(),
        group_id: principal.group_id.clone(),
        platform: principal.platform.clone(),
        model: model.into(),
        upstream_model,
        credential_ids,
        reserved_micros,
        price: ModelPrice {
            input_price_micros: 0,
            cache_price_micros: 0,
            output_price_micros: 0,
            multiplier_micros: 1_000_000,
        },
        max_output_tokens: limits.max_output_tokens,
        timeout_seconds: limits.timeout_seconds,
        max_concurrency: limits.max_concurrency,
    })
}

pub async fn settle_image(
    pool: &SqlitePool,
    request_id: &str,
    success_count: Option<i64>,
    success: bool,
) -> Result<Settlement, AppError> {
    let mut transaction = repository::begin(pool).await?;
    let mut reservation = load_reservation(&mut transaction, request_id).await?;
    if ["settled", "refunded"].contains(&reservation.status.as_str()) {
        return Ok(reservation.result());
    }
    if success_count.is_none() && success {
        sqlx::query("UPDATE saas_billing_reservations SET status='pending_review',updated_at=? WHERE request_id=?").bind(repository::now()).bind(request_id).execute(&mut *transaction).await.map_err(db_error)?;
        reservation.status = "pending_review".into();
        transaction.commit().await.map_err(db_error)?;
        return Ok(reservation.result());
    }
    let snapshot: serde_json::Value = serde_json::from_str(&reservation.price_json)
        .map_err(|_| invalid("saas.pricing_snapshot", "Invalid image price snapshot"))?;
    if snapshot.get("kind").and_then(serde_json::Value::as_str) != Some("image") {
        return Err(invalid(
            "saas.pricing_snapshot",
            "Reservation is not image billing",
        ));
    }
    let count = success_count.unwrap_or(0);
    let unit = snapshot
        .get("unitPriceMicros")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| invalid("saas.pricing_snapshot", "Invalid image unit price"))?;
    let requested = snapshot
        .get("count")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    if count < 0 || count > requested {
        return Err(invalid(
            "saas.pricing_snapshot",
            "Invalid successful image count",
        ));
    }
    let cost = repository::money(
        reservation.reserved_micros as i128 * count as i128 / requested.max(1) as i128,
    )?;
    let status = if count == 0 { "refunded" } else { "settled" };
    let result = finish(
        &mut transaction,
        &reservation,
        cost,
        None,
        status,
        "proxy",
        Some(&format!("image_count={count};unit={unit}")),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
}

/// 视频的结算（G-P4）。与 `settle_image` 同构，差异只有快照 `kind` 与审计原因。
///
/// **诚实声明：** 与图像不同，视频的成本高峰在「提交之后、出片之前」——
/// 上游已经开始烧算了。所以上游 2xx 就代表「这单要收」，哪怕客户端随后
/// 一直没来查状态（任务超时失败由轮询器的 `MIN_POLL_ATTEMPTS` 预算兜底，
/// 那时才走 `settle_video(count=0)` 退款）。
pub async fn settle_video(
    pool: &SqlitePool,
    request_id: &str,
    success_count: Option<i64>,
    success: bool,
) -> Result<Settlement, AppError> {
    let mut transaction = repository::begin(pool).await?;
    let mut reservation = load_reservation(&mut transaction, request_id).await?;
    if ["settled", "refunded"].contains(&reservation.status.as_str()) {
        return Ok(reservation.result());
    }
    if success_count.is_none() && success {
        sqlx::query("UPDATE saas_billing_reservations SET status='pending_review',updated_at=? WHERE request_id=?").bind(repository::now()).bind(request_id).execute(&mut *transaction).await.map_err(db_error)?;
        reservation.status = "pending_review".into();
        transaction.commit().await.map_err(db_error)?;
        return Ok(reservation.result());
    }
    let snapshot: serde_json::Value = serde_json::from_str(&reservation.price_json)
        .map_err(|_| invalid("saas.pricing_snapshot", "Invalid video price snapshot"))?;
    if snapshot.get("kind").and_then(serde_json::Value::as_str) != Some("video") {
        return Err(invalid(
            "saas.pricing_snapshot",
            "Reservation is not video billing",
        ));
    }
    let count = success_count.unwrap_or(0);
    let unit = snapshot
        .get("unitPriceMicros")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| invalid("saas.pricing_snapshot", "Invalid video unit price"))?;
    let requested = snapshot
        .get("count")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    if count < 0 || count > requested {
        return Err(invalid(
            "saas.pricing_snapshot",
            "Invalid successful video count",
        ));
    }
    let cost = repository::money(
        reservation.reserved_micros as i128 * count as i128 / requested.max(1) as i128,
    )?;
    let status = if count == 0 { "refunded" } else { "settled" };
    let result = finish(
        &mut transaction,
        &reservation,
        cost,
        None,
        status,
        "proxy",
        Some(&format!("video_count={count};unit={unit}")),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
}

/// 音频（TTS）的预留。
///
/// 与 `reserve_video` 同构：单价在**预留时**就折成最终总额并冻结进快照，结算只读
/// 快照。差别是计价维度——视频按秒，音频按**字符**。
///
/// `characters` 必须由调用方从**同一份请求体**算出（`audiogen::protocol`），
/// 这样「计费的文本」与「发给上游的文本」不会分叉（视频那条「计价口径与上游口径
/// 必须同源」的同一个教训）。上游侧的上限校验也在那里做，这里只挡防呆上界。
pub async fn reserve_audio(
    pool: &SqlitePool,
    principal: &ApiPrincipal,
    model: &str,
    characters: i64,
) -> Result<Reservation, AppError> {
    if !(1..=MAX_AUDIO_CHARACTERS).contains(&characters)
        || model.is_empty()
        || model.len() > 256
    {
        return Err(invalid(
            "saas.request_limits",
            "Invalid audio model or character count",
        ));
    }
    let mut transaction = repository::begin(pool).await?;
    config::require_enabled(&mut transaction).await?;
    let limits: Option<Limits> = sqlx::query_as("SELECT users.balance_micros,users.frozen_micros AS user_frozen,keys.spent_micros,keys.frozen_micros AS key_frozen,keys.limit_micros,settings.multiplier_micros,settings.max_output_tokens,settings.timeout_seconds,settings.max_concurrency,settings.allow_subscription,settings.allow_balance FROM saas_api_keys keys JOIN saas_users users ON users.id=keys.user_id JOIN route_pool_groups groups ON groups.id=keys.group_id JOIN saas_group_settings settings ON settings.group_id=groups.id WHERE keys.id=? AND keys.user_id=? AND keys.group_id=? AND groups.platform=? AND keys.status='active' AND (keys.expires_at IS NULL OR keys.expires_at>?) AND users.status='active' AND groups.is_internal=0 AND groups.deleted_at IS NULL")
        .bind(&principal.key_id).bind(&principal.user_id).bind(&principal.group_id).bind(&principal.platform).bind(repository::now()).fetch_optional(&mut *transaction).await.map_err(db_error)?;
    let limits =
        limits.ok_or_else(|| invalid("saas.invalid_key", "API key is no longer available"))?;
    crate::saas::domain::model_sync::reconcile_group_connection(
        &mut *transaction,
        &principal.group_id,
    )
    .await?;
    let priced: Option<(i64, String)> = sqlx::query_as(
        "SELECT audio_price_micros_per_1k_chars,upstream_model FROM saas_group_models WHERE group_id=? AND model=? AND sync_state='active' AND enabled=1",
    )
    .bind(&principal.group_id)
    .bind(model)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(db_error)?;
    // 单价必须 > 0：0 价在 `settle` 里会被当成「没定价」，与「免费」分不开。
    let (price_per_1k_chars, upstream_model) =
        priced.filter(|(price, _)| *price > 0).ok_or_else(|| {
            invalid(
                "saas.model_not_allowed",
                "Audio model is not priced and allowed by this group",
            )
        })?;
    let credential_ids = groups::permitted_accounts_for_capability_connection(
        &mut transaction,
        &principal.group_id,
        model,
        "audio.generate",
    )
    .await?;
    if credential_ids.is_empty() {
        return Err(invalid(
            "saas.empty_pool",
            "No permitted account currently supports speech synthesis",
        ));
    }
    // 取整方向**向上**：宁可多收一个 micro，也不漏收。取整只在这里做一次，
    // 结果（总额）进快照，结算不再重复取整——两处各算一次迟早会分叉。
    let base_micros = (characters as i128 * price_per_1k_chars as i128 + 999) / 1000;
    let reserved_micros = repository::money(
        base_micros * limits.multiplier_micros as i128 / 1_000_000_i128,
    )?;
    let reservation = reserve_fixed(
        &mut transaction,
        principal,
        model,
        upstream_model,
        credential_ids,
        reserved_micros,
        limits,
        serde_json::json!({
            "kind": "audio",
            "unitPriceMicros": price_per_1k_chars,
            "characters": characters,
        })
        .to_string(),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(reservation)
}

/// 音频（TTS）的结算。
///
/// **全有或全无**：音频是同步接口，上游 2xx 就代表这单的文本已经合成完，
/// 失败则整笔退款。没有「成功几个字」这种中间态——那是图像/视频按条数的模型，
/// 它们能从响应体里数出成功了几条；音频的响应是二进制，数不出来（也不该去数）。
pub async fn settle_audio(
    pool: &SqlitePool,
    request_id: &str,
    success: bool,
) -> Result<Settlement, AppError> {
    let mut transaction = repository::begin(pool).await?;
    let mut reservation = load_reservation(&mut transaction, request_id).await?;
    if ["settled", "refunded"].contains(&reservation.status.as_str()) {
        return Ok(reservation.result());
    }
    let snapshot: serde_json::Value = serde_json::from_str(&reservation.price_json)
        .map_err(|_| invalid("saas.pricing_snapshot", "Invalid audio price snapshot"))?;
    if snapshot.get("kind").and_then(serde_json::Value::as_str) != Some("audio") {
        return Err(invalid(
            "saas.pricing_snapshot",
            "Reservation is not audio billing",
        ));
    }
    let characters = snapshot
        .get("characters")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let cost = if success {
        reservation.reserved_micros
    } else {
        0
    };
    let status = if success { "settled" } else { "refunded" };
    let result = finish(
        &mut transaction,
        &reservation,
        cost,
        None,
        status,
        "proxy",
        Some(&format!("characters={characters}")),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
}

async fn load_reservation(
    connection: &mut SqliteConnection,
    request_id: &str,
) -> Result<StoredReservation, AppError> {
    sqlx::query_as("SELECT request_id,user_id,key_id,group_id,model,price_json,reserved_micros,status,price_usd_micros,funding_type,subscription_id,created_at FROM saas_billing_reservations WHERE request_id=?")
        .bind(request_id).fetch_optional(connection).await.map_err(db_error)?.ok_or_else(|| invalid("saas.reservation_not_found", "Billing reservation is unavailable"))
}

pub async fn settle(
    pool: &SqlitePool,
    request_id: &str,
    usage: Option<BillableUsage>,
    success: bool,
) -> Result<Settlement, AppError> {
    let mut transaction = repository::begin(pool).await?;
    let mut reservation = load_reservation(&mut transaction, request_id).await?;
    if ["settled", "refunded"].contains(&reservation.status.as_str()) {
        return Ok(reservation.result());
    }
    if usage.is_none() && (success || reservation.status == "pending_review") {
        sqlx::query("UPDATE saas_billing_reservations SET status='pending_review',updated_at=? WHERE request_id=?").bind(repository::now()).bind(request_id).execute(&mut *transaction).await.map_err(db_error)?;
        reservation.status = "pending_review".into();
        transaction.commit().await.map_err(db_error)?;
        return Ok(reservation.result());
    }
    let price: ModelPrice = serde_json::from_str(&reservation.price_json).map_err(|_| {
        invalid(
            "saas.pricing_snapshot",
            "Stored pricing snapshot is invalid; manual review is required",
        )
    })?;
    let cost = match &usage {
        Some(usage) => price.charge(usage)?,
        None => 0,
    };
    let status = if usage.is_none() {
        "refunded"
    } else {
        "settled"
    };
    let result = finish(
        &mut transaction,
        &reservation,
        cost,
        usage.as_ref(),
        status,
        "proxy",
        None,
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
}

async fn finish(
    connection: &mut SqliteConnection,
    reservation: &StoredReservation,
    cost: i64,
    usage: Option<&BillableUsage>,
    status: &str,
    actor: &str,
    reason: Option<&str>,
) -> Result<Settlement, AppError> {
    let (balance, frozen): (i64, i64) =
        sqlx::query_as("SELECT balance_micros,frozen_micros FROM saas_users WHERE id=?")
            .bind(&reservation.user_id)
            .fetch_one(&mut *connection)
            .await
            .map_err(db_error)?;
    let (spent, key_frozen): (i64, i64) =
        sqlx::query_as("SELECT spent_micros,frozen_micros FROM saas_api_keys WHERE id=?")
            .bind(&reservation.key_id)
            .fetch_one(&mut *connection)
            .await
            .map_err(db_error)?;
    if cost < 0
        || (reservation.funding_type == "balance" && frozen < reservation.reserved_micros)
        || key_frozen < reservation.reserved_micros
    {
        return Err(invalid(
            "saas.billing_invariant",
            "Billing balances require manual review",
        ));
    }
    let after = repository::money(
        balance as i128
            - if reservation.funding_type == "balance" {
                cost as i128
            } else {
                0
            },
    )?;
    let total_spent = repository::money(spent as i128 + cost as i128)?;
    let current = repository::now();
    sqlx::query("UPDATE saas_users SET balance_micros=?,frozen_micros=frozen_micros-?,updated_at=? WHERE id=?").bind(after).bind(if reservation.funding_type == "balance" { reservation.reserved_micros } else { 0 }).bind(current).bind(&reservation.user_id).execute(&mut *connection).await.map_err(db_error)?;
    sqlx::query("UPDATE saas_api_keys SET spent_micros=?,frozen_micros=frozen_micros-?,updated_at=? WHERE id=?").bind(total_spent).bind(reservation.reserved_micros).bind(current).bind(&reservation.key_id).execute(&mut *connection).await.map_err(db_error)?;
    if let Some(subscription_id) = &reservation.subscription_id {
        let day = repository::timestamp(reservation.created_at)[..10].to_string();
        let available: Option<i64> = sqlx::query_scalar("SELECT subscriptions.quota_micros-daily.used_micros FROM saas_subscriptions subscriptions JOIN saas_subscription_daily_usage daily ON daily.subscription_id=subscriptions.id AND daily.day=? WHERE subscriptions.id=? AND daily.frozen_micros>=?")
            .bind(&day).bind(subscription_id).bind(reservation.reserved_micros).fetch_optional(&mut *connection).await.map_err(db_error)?;
        if available.is_none_or(|value| value < cost) {
            return Err(invalid(
                "saas.billing_invariant",
                "Subscription daily quota requires manual review",
            ));
        }
        sqlx::query("UPDATE saas_subscription_daily_usage SET used_micros=used_micros+?,frozen_micros=frozen_micros-?,updated_at=? WHERE subscription_id=? AND day=?")
            .bind(cost).bind(reservation.reserved_micros).bind(current).bind(subscription_id).bind(&day).execute(&mut *connection).await.map_err(db_error)?;
        let used_after: i64 = sqlx::query_scalar("SELECT used_micros FROM saas_subscription_daily_usage WHERE subscription_id=? AND day=?").bind(subscription_id).bind(&day).fetch_one(&mut *connection).await.map_err(db_error)?;
        sqlx::query("INSERT INTO saas_subscription_ledger(id,subscription_id,user_id,kind,amount_micros,used_after_micros,request_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(subscription_id).bind(&reservation.user_id).bind(if status=="refunded"{"release"}else{"usage"}).bind(cost).bind(used_after).bind(&reservation.request_id).bind(reason).bind(current).execute(&mut *connection).await.map_err(db_error)?;
    } else {
        sqlx::query("INSERT INTO saas_wallet_ledger(id,user_id,kind,amount_micros,balance_after_micros,source_id,request_id,idempotency_key,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&reservation.user_id).bind(if status=="refunded" {"release"} else {"usage"}).bind(-cost).bind(after).bind(&reservation.request_id).bind(&reservation.request_id)
        .bind(format!("billing:{}",reservation.request_id)).bind(reason).bind(actor).bind(current).execute(&mut *connection).await.map_err(db_error)?;
    }
    if status == "settled" {
        let unconfirmed = i64::from(usage.is_none());
        let empty_usage = BillableUsage::default();
        let usage = usage.unwrap_or(&empty_usage);
        sqlx::query("INSERT INTO saas_usage_hourly(user_id,key_id,group_id,model,hour,request_count,input_tokens,cache_read_tokens,cache_write_tokens,output_tokens,cost_micros,unconfirmed_usage_count) VALUES(?,?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT(user_id,key_id,group_id,model,hour) DO UPDATE SET request_count=request_count+1,input_tokens=input_tokens+excluded.input_tokens,cache_read_tokens=cache_read_tokens+excluded.cache_read_tokens,cache_write_tokens=cache_write_tokens+excluded.cache_write_tokens,output_tokens=output_tokens+excluded.output_tokens,cost_micros=cost_micros+excluded.cost_micros,unconfirmed_usage_count=unconfirmed_usage_count+excluded.unconfirmed_usage_count")
            .bind(&reservation.user_id).bind(&reservation.key_id).bind(&reservation.group_id).bind(&reservation.model).bind(reservation.created_at/3600*3600).bind(usage.input_tokens).bind(usage.cache_read_tokens).bind(usage.cache_write_tokens).bind(usage.output_tokens).bind(cost)
            .bind(unconfirmed)
            .execute(&mut *connection).await.map_err(db_error)?;
    }
    sqlx::query("UPDATE saas_billing_reservations SET status=?,price_usd_micros=?,updated_at=? WHERE request_id=? AND status IN ('reserved','pending_review')")
        .bind(status).bind(cost).bind(current).bind(&reservation.request_id).execute(&mut *connection).await.map_err(db_error)?;
    let mut result = reservation.result();
    result.status = status.into();
    result.price_usd_micros = Some(cost);
    Ok(result)
}

pub async fn recover_pending(pool: &SqlitePool) -> Result<u64, AppError> {
    let mut transaction = repository::begin(pool).await?;
    let count = sqlx::query("UPDATE saas_billing_reservations SET status='pending_review',updated_at=? WHERE status='reserved'")
        .bind(repository::now()).execute(&mut *transaction).await.map_err(db_error)?.rows_affected();
    if count > 0 {
        repository::audit(
            &mut transaction,
            "ledger.recover",
            None,
            json!({"pendingRequests":count}),
        )
        .await?;
    }
    transaction.commit().await.map_err(db_error)?;
    Ok(count)
}

pub async fn reconcile(
    pool: &SqlitePool,
    payload: serde_json::Value,
) -> Result<Settlement, AppError> {
    let request_id = repository::text(&payload, "requestId")?;
    let action = repository::text(&payload, "action")?;
    let reason = repository::text(&payload, "reason")?;
    if !["refund", "settle"].contains(&action) {
        return Err(invalid(
            "saas.validation",
            "Reconciliation action must be refund or settle",
        ));
    }
    let mut transaction = repository::begin(pool).await?;
    let reservation = load_reservation(&mut transaction, request_id).await?;
    if ["settled", "refunded"].contains(&reservation.status.as_str()) {
        return Ok(reservation.result());
    }
    if reservation.status != "pending_review" {
        return Err(invalid(
            "saas.billing_active",
            "Only requests awaiting review may be reconciled",
        ));
    }
    let usage: Option<BillableUsage> = payload
        .get("usage")
        .map(|value| {
            serde_json::from_value(value.clone()).map_err(|_| {
                invalid(
                    "saas.validation",
                    "All four usage categories must be provided",
                )
            })
        })
        .transpose()?;
    let cost = if action == "refund" {
        0
    } else if let Some(usage) = &usage {
        let price: ModelPrice = serde_json::from_str(&reservation.price_json)
            .map_err(|_| invalid("saas.pricing_snapshot", "Invalid price snapshot"))?;
        price.charge(usage)?
    } else {
        payload
            .get("amountMicros")
            .and_then(serde_json::Value::as_i64)
            .filter(|amount| (0..=repository::MAX_MONEY).contains(amount))
            .ok_or_else(|| {
                invalid(
                    "saas.validation",
                    "Verified usage or amountMicros is required",
                )
            })?
    };
    let result = finish(
        &mut transaction,
        &reservation,
        cost,
        if action == "refund" {
            None
        } else {
            usage.as_ref()
        },
        if action == "refund" {
            "refunded"
        } else {
            "settled"
        },
        "administrator",
        Some(reason),
    )
    .await?;
    repository::audit(
        &mut transaction,
        "ledger.reconcile",
        Some(request_id),
        json!({"action":action,"reason":reason,"amountMicros":cost}),
    )
    .await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
}

#[cfg(test)]
mod tests;
