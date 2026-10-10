-- 视频生成计费（G-P4）
--
-- 与图像（0005）同构：单价挂在「组 × 模型」上，单位是「每条视频」。生成一次
-- 计一次，与时长无关——上游各家的时长档位不统一（可灵 5/10 秒、MiniMax
-- 6/10 秒、Sora 最长 20 秒），按「次」计价才能跨方言统一。
--
-- 诚实声明：**同一模型无法用「次」定价覆盖用户自选 5s/10s 的成本差**。若将来
-- 要按秒计价，加一列 `video_price_per_second_micros` 并在 settle_video 里按
-- 实际 duration 折算即可；本迁移只做「次」这一档，避免引入尚无定价界面的字段。
ALTER TABLE saas_group_models ADD COLUMN video_price_micros INTEGER NOT NULL DEFAULT 0 CHECK(video_price_micros>=0);
