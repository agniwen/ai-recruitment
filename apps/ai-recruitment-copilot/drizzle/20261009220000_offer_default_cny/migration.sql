-- 新建 Offer 未指定币种时默认使用人民币；保留已有记录的币种和金额。
ALTER TABLE "public"."studio_offer_draft" ALTER COLUMN "currency" SET DEFAULT 'CNY';
COMMENT ON COLUMN "public"."studio_offer_draft"."currency" IS 'Offer 金额使用的币种；新建时默认人民币 CNY，也可选择 USD、GBP 或自定义币种；编辑时保留已保存的币种，修改默认值不改变历史记录';
