-- 为已部署的旧数据库增加手机号字段。
-- 新部署并已执行新版 schema.sql 的数据库不需要重复执行。

ALTER TABLE participants ADD COLUMN phone TEXT NOT NULL DEFAULT '';
