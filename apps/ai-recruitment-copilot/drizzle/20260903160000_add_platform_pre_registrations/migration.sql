CREATE TABLE IF NOT EXISTS "platform_pre_registration" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_slug" text DEFAULT 'work' NOT NULL,
  "email" text NOT NULL,
  "display_name" text NOT NULL,
  "telegram" text NOT NULL,
  "recruiting_group_names" text[] NOT NULL,
  "recruiting_role" text NOT NULL,
  "direct_manager_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_pre_registration_direct_manager_fk"
    FOREIGN KEY ("direct_manager_id") REFERENCES "public"."platform_pre_registration"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "platform_pre_registration_not_self_managed"
    CHECK ("direct_manager_id" IS NULL OR "direct_manager_id" <> "id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_pre_registration_workspace_email_uq"
  ON "platform_pre_registration" USING btree ("workspace_slug", lower("email"));
CREATE INDEX IF NOT EXISTS "platform_pre_registration_manager_idx"
  ON "platform_pre_registration" USING btree ("direct_manager_id");
CREATE INDEX IF NOT EXISTS "platform_pre_registration_workspace_name_idx"
  ON "platform_pre_registration" USING btree ("workspace_slug", "display_name");

CREATE TEMP TABLE "platform_pre_registration_seed" (
  "email" text NOT NULL,
  "display_name" text NOT NULL,
  "recruiting_group_names" text[] NOT NULL,
  "recruiting_role" text NOT NULL,
  "telegram" text NOT NULL,
  "direct_manager_name" text
);

INSERT INTO "platform_pre_registration_seed" (
  "email", "display_name", "recruiting_group_names", "recruiting_role", "telegram", "direct_manager_name"
) VALUES
  ('tengdanuy@gmail.com', '吉米', ARRAY['燎原社']::text[], 'recruitingSupervisor', '@Zonex032', NULL),
  ('xumiyu8@gmail.com', '许蜜语', ARRAY['燎原社']::text[], 'hr', '@xumiyuyu', '吉米'),
  ('gejiejiege049@gmail.com', '李可', ARRAY['燎原社']::text[], 'hr', '@xung2069', '吉米'),
  ('nazii92018@gmail.com', '纳兹', ARRAY['燎原社']::text[], 'hr', '@nazii92018', '吉米'),
  ('duckseller7961@gmail.com', '心安', ARRAY['燎原社']::text[], 'hr', '@bluopq870', '吉米'),
  ('mayi62297@gmail.com', '见山', ARRAY['燎原社']::text[], 'recruitingLead', '@zduz292', '吉米'),
  ('fangxuwen58@gmail.com', '雪莉', ARRAY['燎原社']::text[], 'hr', '@Sherry_0503', '见山'),
  ('yiyi955851@gmail.com', '依依', ARRAY['燎原社']::text[], 'hr', '@yiyi2049', '见山'),
  ('ankerkeran968@gmail.com', '安克', ARRAY['燎原社']::text[], 'hr', '@anker287', '见山'),
  ('jiwuchen407@gmail.com', '叶冷', ARRAY['燎原社']::text[], 'hr', '@yeleng407', '见山'),
  ('hrevelyn2025@gmail.com', 'Evelyn', ARRAY['寻英招聘']::text[], 'recruitingSupervisor', '@hrevelyn111', NULL),
  ('ojisamer.nrcn.2025@gmail.com', 'Ojisamer', ARRAY['寻英招聘']::text[], 'recruitingLead', '@ojisamer', 'Evelyn'),
  ('bobo.nrcn.2025@gmail.com', 'Bobo', ARRAY['寻英招聘']::text[], 'hr', '@bobomiepucha', 'Ojisamer'),
  ('bruce.nrcn.2025@gmail.com', '麦满分', ARRAY['寻英招聘']::text[], 'hr', '@bruceluo123', 'Ojisamer'),
  ('a87243831@gmail.com', 'Adela', ARRAY['寻英招聘']::text[], 'hr', '@Adelaaa826', 'Evelyn'),
  ('lz.ld03302026@gmail.com', 'James', ARRAY['寻英招聘']::text[], 'hr', '@James202602', 'Evelyn'),
  ('thurothte@gmail.com', 'Orlando', ARRAY['寻英招聘']::text[], 'hr', '@orlan911', 'Evelyn'),
  ('xheng873@gmail.com', '安和', ARRAY['寻英招聘']::text[], 'hr', '@anhe2026', 'Ojisamer'),
  ('lina.xycn.2026@gmail.com', '丽娜', ARRAY['寻英招聘']::text[], 'hr', '@Lina202677', 'Ojisamer'),
  ('shengyu3208@gmail.com', '于久', ARRAY['中诚']::text[], 'recruitingSupervisor', '@yujiubole100', NULL),
  ('jingwei0025@gmail.com', '叶昔', ARRAY['中诚']::text[], 'recruitingLead', '@zhongcheng02', '于久'),
  ('zcgs2149@gmail.com', '森城', ARRAY['中诚']::text[], 'recruitingLead', '@sencheng88', '于久'),
  ('liran32798@gmail.com', '李燃', ARRAY['中诚']::text[], 'hr', '@liran32798', '叶昔'),
  ('zongcheng.gs2857@gmail.com', '李铂海', ARRAY['中诚']::text[], 'hr', '@foyakebi', '叶昔'),
  ('zhangtianfu778@gmail.com', '张天赋', ARRAY['中诚']::text[], 'hr', '@zhangtianfu778', '森城'),
  ('eluoyi85@gmail.com', '俄洛伊', ARRAY['中诚']::text[], 'hr', '@eluoyi1', '森城'),
  ('zongcheng.gs2754@gmail.com', '吴亚雯', ARRAY['中诚']::text[], 'hr', '@yawen_wu', '叶昔'),
  ('guangyongwu666@gmail.com', '吴勇光', ARRAY['中诚']::text[], 'hr', '@wuyongguang9999', '叶昔'),
  ('linyang20251998@gmail.com', '林阳', ARRAY['中诚']::text[], 'hr', '@linyang1998', '森城'),
  ('lintu588888@gmail.com', '林图', ARRAY['中诚']::text[], 'hr', '@lintu58', '叶昔'),
  ('fangyue869@gmail.com', '方月', ARRAY['中诚']::text[], 'hr', '@fangyue888', '叶昔'),
  ('yifei9982@gmail.com', '易菲', ARRAY['宏景']::text[], 'recruitingSupervisor', '@yifei9982', NULL),
  ('liduola5214@gmail.com', '李朵拉', ARRAY['宏景']::text[], 'recruitingLead', '@liduola5214', '易菲'),
  ('yuliangn123@gmail.com', '余亮', ARRAY['宏景']::text[], 'hr', '@yuliangn123', '李朵拉'),
  ('xiaoxing0149@gmail.com', '小星', ARRAY['宏景']::text[], 'hr', '@xiaoxing01491', '李朵拉'),
  ('xilanlanxi9417@gmail.com', '西兰', ARRAY['宏景']::text[], 'hr', '@xilan0251', '李朵拉'),
  ('liyang042054@gmail.com', '华天', ARRAY['宏景']::text[], 'hr', '@huazai0332', '李朵拉'),
  ('lixiaoping307@gmail.com', '伯乐', ARRAY['宏景']::text[], 'hr', '@lixiaoping11', '李朵拉'),
  ('sanmingxiong237@gmail.com', '熊三明', ARRAY['宏景']::text[], 'recruitingLead', '@mingming520222', '易菲'),
  ('qwer521587@gmail.com', '燕泽端', ARRAY['宏景']::text[], 'hr', '@shisanpot', '熊三明'),
  ('tim122489929@gmail.com', '古安', ARRAY['卓亚团队']::text[], 'recruitingSupervisor', '@guan1110', NULL),
  ('wx20250529@gmail.com', '王笑', ARRAY['卓亚团队']::text[], 'recruitingLead', '@wangxiao98', '古安'),
  ('chenmuyan221@gmail.com', '陈沐妍', ARRAY['卓亚团队']::text[], 'hr', '@chenmuyan996', '王笑'),
  ('awe816308@gmail.com', '赵洋', ARRAY['卓亚团队']::text[], 'hr', '@zhaoyang312', '王笑'),
  ('dopalohane@gmail.com', '颜姿', ARRAY['卓亚团队']::text[], 'hr', '@tanerkalilo', '王笑'),
  ('zygs.ba2006@gmail.com', '微恩', ARRAY['卓亚团队']::text[], 'recruitingLead', '@vian0804', '古安'),
  ('zygs2151@gmail.com', '沈焱霖', ARRAY['卓亚团队']::text[], 'hr', '@shenyanlin001', '微恩'),
  ('xiaofeng6104@gmail.com', '楚云飞', ARRAY['卓亚团队']::text[], 'hr', '@cyf3721', '微恩'),
  ('bboy790803@gmail.com', '哈士奇', ARRAY['卓亚团队']::text[], 'hr', '@tw7723', '微恩'),
  ('hrwangzhen@gmail.com', '王震', ARRAY['卓亚团队']::text[], 'hr', '@Huahua089', '微恩'),
  ('ziye69190@gmail.com', '叶子', ARRAY['卓亚团队']::text[], 'hr', '@boluo1205', '微恩'),
  ('leib33136@gmail.com', 'Simon', ARRAY['卓亚团队']::text[], 'hr', '@k797900', '微恩'),
  ('baoqing202107@gmail.com', '卓予希', ARRAY['万天招聘']::text[], 'recruitingSupervisor', '@zhuoyuxi', NULL),
  ('tianyou9901@gmail.com', '齐夏', ARRAY['万天招聘']::text[], 'recruitingLead', '@AK998886', '卓予希'),
  ('hedeng992@gmail.com', '肖艳', ARRAY['万天招聘']::text[], 'recruitingLead', '@zc2482', '卓予希'),
  ('fangyuant12@gmail.com', '苏圆圆', ARRAY['万天招聘']::text[], 'hr', '@fang1203', '齐夏'),
  ('santanever3455@gmail.com', '赵悟空', ARRAY['万天招聘']::text[], 'hr', '@wukong_jobs', '齐夏'),
  ('hpiv5393@gmail.com', '杨觉得', ARRAY['万天招聘']::text[], 'hr', '@yang7427', '肖艳'),
  ('samkahh81@gmail.com', '林可心', ARRAY['万天招聘']::text[], 'hr', '@linkexin', '齐夏'),
  ('ffgu4274@gmail.com', '林风', ARRAY['万天招聘']::text[], 'hr', '@feng271', '肖艳'),
  ('engi533076@gmail.com', '唐文', ARRAY['万天招聘']::text[], 'hr', '@Twen16', '齐夏'),
  ('zhenkense@gmail.com', '温斌', ARRAY['万天招聘']::text[], 'hr', '@webbin666', '肖艳'),
  ('yent577076@gmail.com', '卫星', ARRAY['万天招聘']::text[], 'hr', '@yent188', '肖艳'),
  ('niesili007@gmail.com', 'Mango', ARRAY['星探队（广州招聘）']::text[], 'recruitingLead', '@Mango111999', NULL),
  ('cpt881111@gmail.com', '杰科 杨', ARRAY['星探队（广州招聘）']::text[], 'hr', '@jayco_y', 'mango'),
  ('rogerhh113839@gmail.com', 'Hayden', ARRAY['牧星招聘（Hayden招聘）']::text[], 'recruitingLead', '@hayden1189', NULL),
  ('rroc5986@gmail.com', 'jo.ben', ARRAY['牧星招聘（Hayden招聘）']::text[], 'hr', '@Joo8en', 'Hayden'),
  ('rachel369257@gmail.com', 'Rachel', ARRAY['牧星招聘（Hayden招聘）']::text[], 'hr', '@Razh995', 'Hayden'),
  ('jaradatspritzer218@gmail.com', 'Any', ARRAY['牧星招聘（Hayden招聘）']::text[], 'hr', '@Any6728', 'Hayden'),
  ('albertc1449@gmail.com', 'Albert', ARRAY['牧星招聘（Hayden招聘）']::text[], 'hr', '@albert1449', 'Hayden'),
  ('g877933411@gmail.com', 'Pennie', ARRAY['牧星招聘（Hayden招聘）']::text[], 'hr', '@PennyGUOO', 'Hayden');

INSERT INTO "platform_pre_registration" (
  "id", "workspace_slug", "email", "display_name", "telegram",
  "recruiting_group_names", "recruiting_role", "created_at", "updated_at"
)
SELECT
  'ppr_' || md5(lower(seed."email")),
  'work',
  lower(seed."email"),
  seed."display_name",
  seed."telegram",
  seed."recruiting_group_names",
  seed."recruiting_role",
  now(),
  now()
FROM "platform_pre_registration_seed" AS seed
ON CONFLICT ("workspace_slug", lower("email")) DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "telegram" = EXCLUDED."telegram",
  "recruiting_group_names" = EXCLUDED."recruiting_group_names",
  "recruiting_role" = EXCLUDED."recruiting_role",
  "updated_at" = now();

UPDATE "platform_pre_registration" AS child
SET "direct_manager_id" = manager."id", "updated_at" = now()
FROM "platform_pre_registration_seed" AS seed
JOIN "platform_pre_registration" AS manager
  ON manager."workspace_slug" = 'work'
  AND lower(manager."display_name") = lower(seed."direct_manager_name")
WHERE child."workspace_slug" = 'work'
  AND lower(child."email") = lower(seed."email")
  AND seed."direct_manager_name" IS NOT NULL;

UPDATE "platform_pre_registration" AS child
SET "direct_manager_id" = NULL, "updated_at" = now()
FROM "platform_pre_registration_seed" AS seed
WHERE child."workspace_slug" = 'work'
  AND lower(child."email") = lower(seed."email")
  AND seed."direct_manager_name" IS NULL;

DROP TABLE "platform_pre_registration_seed";
