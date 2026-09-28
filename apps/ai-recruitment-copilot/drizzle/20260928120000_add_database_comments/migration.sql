-- PostgreSQL table and column descriptions for the current Drizzle schema.
-- Comments are metadata only; no data or constraints are changed.

COMMENT ON TABLE "public"."chat_state_subscriptions" IS '聊天线程订阅关系，由聊天状态适配器维护';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_subscriptions"."created_at" IS '订阅创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_subscriptions"."key_prefix" IS '聊天状态键前缀';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_subscriptions"."thread_id" IS '聊天线程 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_state_locks" IS '聊天线程分布式锁，由聊天状态适配器维护';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_locks"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_locks"."key_prefix" IS '聊天状态键前缀';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_locks"."thread_id" IS '聊天线程 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_locks"."token" IS '锁持有者令牌';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_locks"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_state_cache" IS '聊天状态缓存，由聊天状态适配器维护';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_cache"."cache_key" IS '缓存项键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_cache"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_cache"."key_prefix" IS '聊天状态键前缀';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_cache"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_cache"."value" IS '缓存值';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_state_lists" IS '聊天状态列表，由聊天状态适配器维护';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_lists"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_lists"."key_prefix" IS '聊天状态键前缀';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_lists"."list_key" IS '列表键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_lists"."seq" IS '队列或列表序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_lists"."value" IS '列表元素值';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_state_queues" IS '聊天状态队列，由聊天状态适配器维护';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_queues"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_queues"."key_prefix" IS '聊天状态键前缀';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_queues"."seq" IS '队列或列表序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_queues"."thread_id" IS '聊天线程 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_state_queues"."value" IS '队列元素值';
--> statement-breakpoint

COMMENT ON TABLE "public"."user" IS '平台用户及登录资料';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."ban_expires" IS '封禁到期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."ban_reason" IS '封禁原因';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."banned" IS '是否被封禁';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."email" IS '邮箱地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."email_verified" IS '邮箱是否已验证';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."feishu_tenant_key" IS '飞书租户标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."feishu_tenant_name" IS '飞书租户名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."image" IS '用户头像地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."last_active_at" IS '最近活跃时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."last_active_organization_id" IS '最近访问的工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."remark" IS '用户备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."role" IS '角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."telegram" IS 'Telegram 用户名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."telegram_bound_username" IS '绑定时的 Telegram 用户名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."telegram_chat_id" IS 'Telegram 私聊 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."user"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."session" IS '用户登录会话';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."active_organization_id" IS '当前工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."impersonated_by" IS '执行用户模拟的管理员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."ip_address" IS '登录 IP 地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."token" IS '令牌';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."user_agent" IS '客户端 User-Agent';
--> statement-breakpoint
COMMENT ON COLUMN "public"."session"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."account" IS '用户的第三方登录账号及凭据';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."access_token" IS '第三方服务访问令牌';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."access_token_expires_at" IS '访问令牌过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."account_id" IS '第三方账号标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."id_token" IS '第三方身份令牌';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."password" IS '账号密码哈希';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."provider_id" IS '身份提供方标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."refresh_token" IS '第三方服务刷新令牌';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."refresh_token_expires_at" IS '刷新令牌过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."scope" IS '适用范围';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."account"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."verification" IS '身份验证令牌和验证码';
--> statement-breakpoint
COMMENT ON COLUMN "public"."verification"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."verification"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."verification"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."verification"."identifier" IS '待验证的邮箱等对象标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."verification"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."verification"."value" IS '验证码或验证令牌值';
--> statement-breakpoint

COMMENT ON TABLE "public"."organization" IS '招聘工作区';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization"."logo" IS '工作区徽标地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization"."metadata" IS '工作区扩展元数据';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization"."slug" IS '工作区 URL 标识';
--> statement-breakpoint

COMMENT ON TABLE "public"."member" IS '工作区成员及角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."invite_link_id" IS '加入工作区使用的邀请链接 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."is_interviewer" IS '是否可担任面试官';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."odc_scope_mode" IS 'ODC 负责范围模式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."role" IS '成员角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."member_reporting_line" IS '工作区成员的直属汇报关系';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member_reporting_line"."direct_manager_id" IS '直属上级成员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member_reporting_line"."member_id" IS '工作区成员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."member_reporting_line"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."organization_role" IS '工作区自定义角色及权限';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."is_odc" IS '是否为 ODC 角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."permission" IS '角色权限配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."role" IS '角色内部标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."organization_role"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."platform_pre_registration" IS '平台用户预注册信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."direct_manager_email" IS '直属上级邮箱';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."display_name" IS '显示名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."email" IS '邮箱地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."odc_assignments" IS '预注册时分配的 ODC 职责';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."odc_scope_mode" IS 'ODC 负责范围模式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."recruiting_group_names" IS '预注册时申请加入的招聘组名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."recruiting_role" IS '招聘职责角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."telegram" IS 'Telegram 用户名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."workspace_role" IS '工作区角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."platform_pre_registration"."workspace_slug" IS '工作区 URL 标识';
--> statement-breakpoint

COMMENT ON TABLE "public"."recruiting_group" IS '招聘协作组';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."is_default" IS '是否为默认协作组';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."recruiting_group_member" IS '招聘协作组成员';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."group_id" IS '招聘协作组 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."role" IS '成员在招聘组内的角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_member"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."workspace_invite_link" IS '工作区邀请链接';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."code" IS '编码';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."disabled_at" IS '停用时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."disabled_by" IS '停用人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."initial_role" IS '通过邀请链接加入时赋予的角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."workspace_invite_link"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."invitation" IS '工作区成员邀请';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."email" IS '邮箱地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."inviter_id" IS '邀请人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."role" IS '角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."invitation"."status" IS '状态';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_interview" IS '候选人应聘记录及招聘流程状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."actual_onboarded_at" IS '实际入职时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."ai_review_approval_status" IS 'AI 简历评审审批状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."ai_review_assigned_odc_user_id" IS 'AI 简历评审负责的 ODC 用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."candidate_email" IS '候选人邮箱';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."candidate_name" IS '候选人姓名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."candidate_phone" IS '候选人电话';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."closed_at" IS '招聘流程结案时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."closed_meta" IS '招聘流程结案元数据';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."closed_reason" IS '招聘流程结案原因';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."created_by_role" IS '创建应聘记录时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."hiring_unit_id" IS '所属业务单元 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."hr_resume_assessment" IS 'HR 简历评估';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."hr_resume_assessment_updated_at" IS 'HR 简历评估更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."hr_resume_assessment_updated_by" IS 'HR 简历评估更新人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."human_interview_scheduled_at" IS '真人面试计划时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."human_interviewer_id" IS '真人面试官 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."interview_questions" IS '面试问题配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."offer_accepted_at" IS '候选人接受录用时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."offer_sent_at" IS '录用通知发送时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."onboarded_confirmed_at" IS '确认入职时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."onboarded_confirmed_by" IS '确认入职的用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."onboarded_confirmed_by_role" IS '确认入职时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."outcome" IS '候选人招聘结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."pipeline_stage" IS '当前招聘阶段';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."portfolio_attachments" IS '作品集附件';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."recommendation_text" IS '简历推荐语';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."recruitment_source" IS '招聘渠道';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."recruitment_source_detail" IS '招聘渠道补充信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_content_hash" IS '简历内容哈希';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_evaluation_status" IS '简历评估结论';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_file_name" IS '简历文件名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_parse_error" IS '简历解析错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_parse_status" IS '简历解析状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_parsed_at" IS '简历解析完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_profile" IS '解析后的简历档案';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_review" IS 'AI 简历评审结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_review_error" IS 'AI 简历评审错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_review_generated_at" IS 'AI 简历评审生成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_review_queued_at" IS 'AI 简历评审入队时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_review_run_id" IS 'AI 简历评审运行 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_review_status" IS 'AI 简历评审生成状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_screening_error" IS '简历初筛错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_screening_evaluated_at" IS '简历初筛评估时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_screening_result" IS '简历初筛结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_screening_status" IS '简历初筛状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_source_imported_at" IS '从简历池导入时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_source_imported_by" IS '从简历池导入人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_source_pool_item_id" IS '来源简历池记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_source_type" IS '应聘记录的简历来源类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_storage_key" IS '简历文件存储键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."resume_text" IS '简历提取文本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."skills_normalized" IS '标准化技能列表';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."target_role" IS '候选人目标岗位';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."written_test_scheduled_at" IS '笔试计划时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview"."written_test_score" IS '笔试成绩';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_interview_odc_assignment" IS '候选人应聘记录的 ODC 负责人分配';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_odc_assignment"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_odc_assignment"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_org_skill" IS '工作区内标准化技能词及别名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."alias_of" IS '所指向的标准技能词';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."candidate_count" IS '使用该技能词的候选人数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."display" IS '技能词显示名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."normalized" IS '标准化技能词';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_org_skill"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_source" IS '简历来源配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_source_odc_member" IS '简历来源对应的 ODC 成员及职责';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."can_approve_ai_review" IS '是否可审批 AI 简历评审';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."job_series" IS '岗位序列';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."member_id" IS '工作区成员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."resume_source_id" IS '简历来源 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_source_odc_member"."service_unit" IS '服务单元';
--> statement-breakpoint

COMMENT ON TABLE "public"."hiring_unit" IS '招聘需求所属业务单元';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."resume_source_id" IS '简历来源 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."hiring_unit_odc_member" IS '业务单元对应的 ODC 成员及职责';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit_odc_member"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit_odc_member"."hiring_unit_id" IS '所属业务单元 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit_odc_member"."job_series" IS '岗位序列';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit_odc_member"."member_id" IS '工作区成员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit_odc_member"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."hiring_unit_odc_member"."service_unit" IS '服务单元';
--> statement-breakpoint

COMMENT ON TABLE "public"."recruiting_group_hiring_unit" IS '招聘协作组与业务单元的关联';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_hiring_unit"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_hiring_unit"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_hiring_unit"."group_id" IS '招聘协作组 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_hiring_unit"."hiring_unit_id" IS '所属业务单元 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_hiring_unit"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_hiring_unit"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."recruiting_group_resume_source" IS '招聘协作组与简历来源的关联';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_resume_source"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_resume_source"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_resume_source"."group_id" IS '招聘协作组 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_resume_source"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_resume_source"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."recruiting_group_resume_source"."resume_source_id" IS '简历来源 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."department" IS '业务单元下的招聘部门';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."hiring_unit_id" IS '所属业务单元 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."odc_department_responsibility" IS 'ODC 成员对部门及简历来源的负责关系';
--> statement-breakpoint
COMMENT ON COLUMN "public"."odc_department_responsibility"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."odc_department_responsibility"."department_id" IS '所属部门 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."odc_department_responsibility"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."odc_department_responsibility"."member_id" IS '工作区成员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."odc_department_responsibility"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."odc_department_responsibility"."resume_source_id" IS '简历来源 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."department_odc_member" IS '部门对应的 ODC 成员及职责';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department_odc_member"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department_odc_member"."department_id" IS '所属部门 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department_odc_member"."job_series" IS '岗位序列';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department_odc_member"."member_id" IS '工作区成员 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department_odc_member"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."department_odc_member"."service_unit" IS '服务单元';
--> statement-breakpoint

COMMENT ON TABLE "public"."telegram_requester_binding" IS 'Telegram 请求人与工作区的绑定';
--> statement-breakpoint
COMMENT ON COLUMN "public"."telegram_requester_binding"."chat_id" IS 'Telegram 聊天 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."telegram_requester_binding"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."telegram_requester_binding"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."telegram_requester_binding"."username" IS '账号用户名';
--> statement-breakpoint

COMMENT ON TABLE "public"."interviewer" IS 'AI 面试官配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."department_id" IS '所属部门 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."prompt" IS 'AI 提示词';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interviewer"."voice" IS '音色 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."minimax_voice_preview" IS 'MiniMax 音色预览文件';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."content_type" IS '文件 MIME 类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."format" IS '音频格式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."model" IS '模型名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."preview_text" IS '音色预览文本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."preview_text_hash" IS '音色预览文本哈希';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."public_url" IS '预览文件公开链接';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."size_bytes" IS '文件大小（字节）';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."storage_key" IS '文件存储键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."minimax_voice_preview"."voice" IS 'MiniMax 音色 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."job_description" IS '招聘岗位及其需求配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."ai_interview_disabled" IS '是否禁用 AI 面试';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."allow_cross_department_interviewers" IS '是否允许跨部门面试官';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."code" IS '岗位编码';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."control_category" IS '岗位管控分类';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."created_by_role" IS '创建时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."creation_source" IS '创建来源';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."department_id" IS '所属部门 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."expected_onboard_date" IS '预计入职日期';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."feishu_chat_bound_at" IS '飞书群绑定时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."feishu_chat_bound_by" IS '飞书群绑定人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."feishu_chat_id" IS '飞书群聊 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."gap_count" IS '岗位缺口人数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."google_sheet_deleted" IS '是否已从 Google Sheets 来源中删除';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."headcount" IS '岗位计划招聘人数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."hiring_unit_id" IS '所属业务单元 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."job_level" IS '岗位职级';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."job_series" IS '岗位序列';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."manually_inactive" IS '是否手动停用岗位';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."name" IS '岗位名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."offered_pending_onboard_count" IS '已发录用通知待入职人数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."onboarded_count" IS '已入职人数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."preset_questions" IS '预设面试问题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."priority" IS '岗位优先级';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."prompt" IS '岗位专属 AI 面试提示词';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."recruitment_status" IS '岗位招聘状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."requested_date" IS '岗位需求提出日期';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."requester" IS '岗位需求提出人';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."resume_contact" IS '简历接收联系人';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."resume_screening_policy" IS '岗位简历初筛策略';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."resume_screening_policy_hash" IS '初筛策略内容哈希';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."resume_screening_policy_version" IS '初筛策略版本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."resume_source_id" IS '简历来源 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."salary_currency" IS '薪资币种';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."salary_max_amount" IS '薪资上限金额';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."salary_min_amount" IS '薪资下限金额';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."salary_range_raw" IS '原始薪资范围文本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."service_unit" IS '服务单元';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."source_sheet" IS '来源 Google 表格标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."work_end_time" IS '工作结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."work_location" IS '工作地点';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."work_start_time" IS '工作开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description"."work_timezone" IS '工作时区';
--> statement-breakpoint

COMMENT ON TABLE "public"."job_description_audit_log" IS '招聘岗位的操作审计日志';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."action" IS '操作类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."candidate_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."detail" IS '岗位操作详情';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."job_code" IS '岗位编码';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."job_name" IS '岗位名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."operator_id" IS '操作人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."operator_role" IS '操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_audit_log"."source" IS '操作来源';
--> statement-breakpoint

COMMENT ON TABLE "public"."job_description_google_sheet_sync_run" IS '岗位 Google Sheets 同步任务记录';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."error" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."finished_at" IS '结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."requested_by" IS '任务发起人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."requested_by_role" IS '发起时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."result" IS '同步任务结果详情';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."started_at" IS '开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."status" IS '状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_google_sheet_sync_run"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."job_description_interviewer" IS '招聘岗位与 AI 面试官的关联';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_interviewer"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_interviewer"."interviewer_id" IS 'AI 面试官 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_interviewer"."job_description_id" IS '岗位 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."job_description_human_interviewer" IS '招聘岗位与真人面试官的关联';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_human_interviewer"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_human_interviewer"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."job_description_human_interviewer"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_interview_schedule" IS '候选人 AI 面试场次';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."allow_text_input" IS '是否允许文字输入';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."candidate_feedback_categories" IS '候选人反馈分类';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."candidate_feedback_detail" IS '候选人反馈详情';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."candidate_feedback_submitted_at" IS '候选人提交反馈的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."cancel_reason" IS '取消原因';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."cancelled_at" IS '取消时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."completed_at" IS '完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."conversation_id" IS '关联的会话 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."created_by_role" IS '创建时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."disconnected_at" IS '面试连接断开时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."livekit_participant_identity" IS 'LiveKit 参与者标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."livekit_room_name" IS 'LiveKit 房间名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."round_label" IS '面试轮次名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."scheduled_at" IS '计划开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."scheduled_end_at" IS '计划结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."session_started_at" IS '面试会话开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."sort_order" IS '排序序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."status" IS 'AI 面试场次状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_interview_schedule"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_human_interview_round" IS '候选人真人面试轮次';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."cancel_reason" IS '取消原因';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."cancelled_at" IS '取消时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."completed_at" IS '完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."completed_by" IS '完成人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."completed_by_role" IS '完成时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."created_by_role" IS '创建时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."feedback" IS '面试官反馈';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."format" IS '真人面试形式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."label" IS '标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."location" IS '面试地点';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."meeting_url" IS '远程会议链接';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."outcome" IS '真人面试轮次结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."scheduled_at" IS '计划开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."score" IS '评分';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."sort_order" IS '排序序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."started_at" IS '开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."status" IS '真人面试轮次状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_human_interview_meeting" IS '真人面试会议';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."cancelled_at" IS '取消时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."ended_at" IS '结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."livekit_room_name" IS 'LiveKit 房间名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."recording_egress_id" IS '录制导出任务 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."recording_file_key" IS '录音文件存储键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."scheduled_at" IS '计划开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."started_at" IS '开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."status" IS '真人面试会议状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."title" IS '标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting"."valid_until" IS '有效期截止时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_human_interview_meeting_round" IS '真人面试会议与轮次的关联及候选人入会信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_round"."candidate_invite_expires_at" IS '候选人入会邀请过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_round"."candidate_invite_token_hash" IS '候选人入会令牌的哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_round"."joined_at" IS '加入时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_round"."left_at" IS '离开时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_round"."meeting_id" IS '真人面试会议 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_round"."round_id" IS '面试轮次 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_human_interview_external_interviewer" IS '真人面试轮次的外部面试官';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_external_interviewer"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_external_interviewer"."joined_at" IS '加入时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_external_interviewer"."left_at" IS '离开时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_external_interviewer"."name" IS '名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_external_interviewer"."round_id" IS '面试轮次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_external_interviewer"."telegram" IS 'Telegram 用户名';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_human_interview_meeting_interviewer" IS '真人面试会议的内部面试官';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_interviewer"."joined_at" IS '加入时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_interviewer"."left_at" IS '离开时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_interviewer"."meeting_id" IS '真人面试会议 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_interviewer"."role" IS '会议面试官角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_meeting_interviewer"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_human_interview_round_interviewer" IS '真人面试轮次的内部面试官';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round_interviewer"."round_id" IS '面试轮次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_human_interview_round_interviewer"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_offer_draft" IS '候选人录用通知草稿及发放状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."approval_attachment" IS '录用审批附件';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."base_salary" IS '基本薪资';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."bonus" IS '奖金信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."candidate_counter" IS '候选人的还价内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."created_by_role" IS '创建时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."currency" IS '薪资币种';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."equity" IS '股权信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."joining_date" IS '拟入职日期';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."position" IS '录用岗位名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."response_at" IS '候选人回复时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."sent_at" IS '发送时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."sent_by" IS '发送人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."sent_by_role" IS '发送时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."status" IS '录用通知状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_offer_draft"."version" IS '版本号';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_pool_item" IS '简历池中的候选人简历';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."candidate_email" IS '候选人邮箱';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."candidate_name" IS '候选人姓名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."candidate_phone" IS '候选人电话';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."notes" IS '备注';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."published_at" IS '发布到简历池的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."published_by" IS '发布人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."recruitment_source" IS '招聘渠道';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."recruitment_source_detail" IS '招聘渠道补充信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_content_hash" IS '简历内容哈希';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_file_name" IS '简历文件名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_parse_error" IS '简历解析错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_parse_status" IS '简历解析状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_parsed_at" IS '简历解析完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_profile" IS '解析后的简历档案';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_storage_key" IS '简历文件存储键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."resume_text" IS '简历提取文本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."scope" IS '简历池记录的可见范围';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."skills_normalized" IS '标准化技能列表';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."source_channel" IS '简历入池渠道';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."source_organization_id" IS '来源工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."source_pool_item_id" IS '来源简历池记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."source_user_id" IS '来源用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."status" IS '简历池记录状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."target_role" IS '候选人目标岗位';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_item"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_pool_import" IS '简历池记录导入候选人应聘记录的关系';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_import"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_import"."imported_at" IS '导入时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_import"."imported_by" IS '导入人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_import"."imported_resume_record_id" IS '导入后创建的应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_import"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_import"."pool_item_id" IS '简历池记录 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_pool_event" IS '简历池记录的操作事件';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."actor_id" IS '操作人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."payload" IS '简历池事件详情';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."pool_item_id" IS '简历池记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_pool_event"."type" IS '简历池事件类型';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_upload_batch" IS '批量上传简历的处理任务';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."completed_at" IS '完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."created_by_role" IS '创建时的操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."dedup_policy" IS '重复简历处理策略';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."failed_count" IS '处理失败数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."jd_mode" IS '岗位匹配方式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."processed_count" IS '已处理数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."recruitment_source" IS '招聘渠道';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."recruitment_source_detail" IS '招聘渠道补充信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."resume_pool_scope" IS '简历池可见范围';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."skipped_count" IS '跳过数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."source_channel" IS '简历来源渠道';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."status" IS '批量上传任务状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."succeeded_count" IS '处理成功数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."target" IS '导入目标';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."total_count" IS '总数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_upload_batch_item" IS '批量上传任务中的单份简历';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."attempt_count" IS '处理尝试次数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."batch_id" IS '所属批次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."current_step" IS '当前处理步骤';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."dedup_match_snapshot" IS '去重匹配结果快照';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."error_message" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."failure_count" IS '处理失败次数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."file_size" IS '文件大小（字节）';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."finished_at" IS '结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."order_index" IS '批次内顺序';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."original_file_name" IS '原始文件名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."pool_item_id" IS '简历池记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."queue_job_id" IS '后台队列任务 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."queued_at" IS '加入处理队列的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."resume_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."source_folder" IS '来源文件夹';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."started_at" IS '开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."status" IS '单份简历处理状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item"."storage_key" IS '文件存储键';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_upload_batch_item_attempt" IS '单份简历的处理尝试记录';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."attempt_number" IS '第几次处理尝试';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."ended_at" IS '结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."error_details" IS '错误详情';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."error_message" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."failed_step" IS '失败的处理步骤';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."item_id" IS '批量上传项 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."started_at" IS '开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."status" IS '本次处理尝试状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_upload_batch_item_attempt"."worker_id" IS '处理任务的工作进程 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_semantic_index" IS '简历或岗位语义向量索引状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."embedding_model" IS '向量模型名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."embedding_version" IS '向量模型版本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."error_message" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."last_indexed_at" IS '最近完成向量索引的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."profile_hash" IS '简历档案哈希';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."source_id" IS '来源记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."source_type" IS '索引来源类型：简历或岗位';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."status" IS '语义索引状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_semantic_index"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."resume_duplicate_match" IS '简历相似与重复匹配结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."embedding_version" IS '向量模型版本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."level" IS '匹配等级';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."matched_source_id" IS '匹配到的来源记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."matched_source_type" IS '匹配到的来源类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."reasons" IS '匹配原因列表';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."score" IS '评分';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."signals" IS '匹配信号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."similarity" IS '向量相似度';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."source_id" IS '来源记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."source_type" IS '待匹配来源类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."status" IS '重复匹配处理状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."resume_duplicate_match"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."mail_ingest_account" IS '邮件收件及简历导入账号配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."dedup_policy" IS '重复简历处理策略';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."email_address" IS '收件邮箱地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."enabled" IS '是否启用';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."encrypted_password" IS '加密保存的邮箱密码';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."failed_mailbox" IS '处理失败邮件的目标文件夹';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."imap_host" IS 'IMAP 服务器地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."imap_port" IS 'IMAP 服务器端口';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."imap_secure" IS '是否使用安全 IMAP 连接';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."jd_mode" IS '岗位匹配方式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_checked_at" IS '最近检查邮箱的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_error" IS '最近一次错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_run_failed" IS '上次运行失败数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_run_matched" IS '上次运行匹配数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_run_queued" IS '上次运行入队数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_run_received" IS '上次运行收到的邮件数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."last_run_subject_skipped" IS '上次运行因主题过滤跳过的数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."listen_start_at" IS '开始监听邮件的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."mailbox" IS '邮箱文件夹名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."polling_started_at" IS '邮件轮询启动时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."processed_mailbox" IS '已处理邮件的目标文件夹';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."resume_pool_scope" IS '简历池可见范围';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."subject_keyword" IS '邮件主题过滤关键词';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."target" IS '邮件简历导入目标';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."user_id" IS '用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_account"."username" IS '账号用户名';
--> statement-breakpoint

COMMENT ON TABLE "public"."mail_ingest_message" IS '邮件导入流程中的邮件处理记录';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."account_id" IS '第三方账号标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."attachment_count" IS '邮件附件总数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."batch_id" IS '所属批次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."bound_job_description_id" IS '邮件绑定的岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."error_message" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."extracted_job_codes" IS '从邮件中提取的岗位编码';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."from_address" IS '发件人地址';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."jd_bind_status" IS '邮件与岗位的绑定状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."mailbox" IS '邮件所在文件夹';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."message_id" IS '邮件 Message-ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."processed_at" IS '处理完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."received_at" IS '接收时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."resume_attachment_count" IS '简历附件数量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."skip_reason" IS '跳过原因';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."status" IS '邮件处理状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."subject" IS '邮件主题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."uid" IS '邮件 UID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."mail_ingest_message"."uid_validity" IS '邮件 UID 有效性标识';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_conversation" IS 'AI 面试会话、转写及总结';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."agent_id" IS '面试代理标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."call_successful" IS '通话是否成功';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."conversation_id" IS '外部面试会话标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."data_collection_results" IS '面试数据采集结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."dynamic_variables" IS '面试代理动态变量';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."ended_at" IS '结束时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."evaluation_criteria_results" IS '面试评估维度结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."key_information" IS '面试关键信息提取结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."key_information_attempts" IS '关键信息提取尝试次数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."key_information_error" IS '关键信息提取错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."key_information_started_at" IS '关键信息提取开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."key_information_status" IS '关键信息提取状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."last_synced_at" IS '最近同步时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."latest_error" IS '最近一次错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."metadata" IS '面试会话元数据';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."metrics" IS '会话指标';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."mode" IS '面试会话模式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."recording_duration_secs" IS '录音时长（秒）';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."recording_egress_id" IS '录制导出任务 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."recording_file_key" IS '录音文件存储键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."recording_status" IS '录音处理状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."schedule_entry_id" IS 'AI 面试场次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."started_at" IS '开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."status" IS '面试会话状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."summary_attempts" IS '面试总结尝试次数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."summary_error" IS '面试总结错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."summary_started_at" IS '面试总结开始时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."summary_status" IS '面试总结状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."transcript" IS '面试逐字稿';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."transcript_summary" IS '面试逐字稿摘要';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation"."webhook_received_at" IS 'Webhook 接收时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_conversation_turn" IS 'AI 面试会话中的单轮消息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."conversation_id" IS '关联的会话 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."message" IS '消息内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."received_at" IS '接收时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."role" IS '消息发送方角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."source" IS '消息来源';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_conversation_turn"."time_in_call_secs" IS '通话内时间偏移（秒）';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_conversation" IS '用户与招聘助手的聊天会话';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."is_title_generating" IS '是否正在生成会话标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."job_description" IS '岗位描述内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."job_description_config" IS '岗位描述配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."resume_imports" IS '本次聊天导入的简历记录';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."title" IS '标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_conversation"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_message" IS '招聘助手聊天消息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."content" IS '内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."conversation_id" IS '关联的会话 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."role" IS '消息发送方角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_message"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."chat_attachment" IS '聊天附件及其解析结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."filename" IS '文件名';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."media_type" IS '文件媒体类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_at" IS '解析完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_error" IS '附件解析错误';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_page_count" IS '解析页数';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_status" IS '附件解析状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_structured" IS '结构化解析结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_text" IS '解析出的文本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."parsed_text_source" IS '解析文本的来源';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."size" IS '附件大小（字节）';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."storage_key" IS '文件存储键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."chat_attachment"."user_id" IS '用户 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_audit_log" IS '候选人面试流程操作审计日志';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."action" IS '操作类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."detail" IS '面试流程操作详情';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."operator_id" IS '操作人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."operator_role" IS '操作人角色';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."schedule_entry_id" IS 'AI 面试场次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_audit_log"."source" IS '操作来源';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_notification" IS '面试通知及发送结果';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."conversation_id" IS '关联的会话 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."error" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."feishu_document_id" IS '飞书文档 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."feishu_document_url" IS '飞书文档链接';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."feishu_message_id" IS '飞书消息 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."provider_id" IS '第三方服务标识';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."recipient_open_id" IS '接收人的飞书 Open ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."recipient_user_id" IS '接收人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."sent_at" IS '发送时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."status" IS '通知发送状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."type" IS '通知类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_notification"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."candidate_form_template" IS '候选人信息表单模板';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."archived_at" IS '归档时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."scope" IS '表单模板适用范围';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."title" IS '标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."candidate_form_template_job_description" IS '候选人表单模板与岗位的关联';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_job_description"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_job_description"."template_id" IS '模板 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."candidate_form_template_question" IS '候选人表单模板的问题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."display_mode" IS '问题展示方式';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."helper_text" IS '问题辅助说明';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."label" IS '问题标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."options" IS '问题选项';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."required" IS '是否必填';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."sort_order" IS '排序序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."template_id" IS '模板 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."type" IS '表单问题类型';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_question"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."candidate_form_template_version" IS '候选人表单模板的不可变版本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_version"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_version"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_version"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_version"."snapshot" IS '表单模板内容快照';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_version"."template_id" IS '模板 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_template_version"."version" IS '版本号';
--> statement-breakpoint

COMMENT ON TABLE "public"."candidate_form_submission" IS '候选人提交的信息表单';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."answers" IS '候选人提交的表单答案';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."submitted_at" IS '提交时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."template_id" IS '模板 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."candidate_form_submission"."version_id" IS '模板版本 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_question_template" IS 'AI 面试题模板';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."archived_at" IS '归档时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."description" IS '描述';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."scope" IS '面试题模板适用范围';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."title" IS '标题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_question_template_job_description" IS '面试题模板与岗位的关联';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_job_description"."job_description_id" IS '岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_job_description"."template_id" IS '模板 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_question_template_question" IS '面试题模板中的题目';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."content" IS '面试题内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."difficulty" IS '题目难度';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."evaluation_focus" IS '题目考察重点';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."follow_up_directions" IS '追问方向';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."sort_order" IS '排序序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."template_id" IS '模板 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_question"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_question_template_version" IS '面试题模板的不可变版本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_version"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_version"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_version"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_version"."snapshot" IS '面试题模板内容快照';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_version"."template_id" IS '模板 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_version"."version" IS '版本号';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_question_template_binding" IS '候选人应聘记录绑定的面试题模板版本';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."disabled_by_user" IS '是否由用户主动停用';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."sort_order" IS '排序序号';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."template_id" IS '模板 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_question_template_binding"."version_id" IS '模板版本 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_context_snapshot" IS 'AI 面试使用的上下文快照';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."created_by" IS '创建人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."payload" IS '面试上下文快照内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."reason" IS '创建快照的原因';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."schedule_entry_id" IS 'AI 面试场次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."status" IS '上下文快照状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."superseded_at" IS '被新快照替代的时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_context_snapshot"."version" IS '版本号';
--> statement-breakpoint

COMMENT ON TABLE "public"."interview_evidence_snapshot" IS 'AI 面试产生的证据快照';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."content_hash" IS '内容哈希值';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."context_snapshot_id" IS '关联的面试上下文快照 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."conversation_id" IS '关联的会话 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."payload" IS '面试证据快照内容';
--> statement-breakpoint
COMMENT ON COLUMN "public"."interview_evidence_snapshot"."schedule_entry_id" IS 'AI 面试场次 ID';
--> statement-breakpoint

COMMENT ON TABLE "public"."feishu_thread_state" IS '飞书会话当前绑定的岗位状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."feishu_thread_state"."active_jd_id" IS '当前绑定的岗位 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."feishu_thread_state"."active_jd_set_at" IS '当前岗位绑定时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."feishu_thread_state"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."feishu_thread_state"."thread_id" IS '聊天线程 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."feishu_thread_state"."updated_at" IS '更新时间';
--> statement-breakpoint

COMMENT ON TABLE "public"."studio_round_email_log" IS '面试轮次邮件的发送日志';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."error_message" IS '错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."id" IS '记录主键 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."interview_record_id" IS '候选人应聘记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."resend_message_id" IS 'Resend 邮件消息 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."round_id" IS '面试轮次 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."sent_by" IS '发送人用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."status" IS '邮件发送状态';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."subject" IS '邮件主题';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."template_key" IS '邮件模板键';
--> statement-breakpoint
COMMENT ON COLUMN "public"."studio_round_email_log"."to_email" IS '收件人邮箱';
--> statement-breakpoint

COMMENT ON TABLE "public"."global_config" IS '工作区级公司及面试配置';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."closing_instructions" IS 'AI 面试结束阶段的指令';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."company_context" IS '提供给 AI 面试的公司背景';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."company_name" IS '公司名称';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."id" IS '配置记录 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."job_code_prefix" IS '岗位编码前缀';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."opening_instructions" IS 'AI 面试开场阶段的指令';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."organization_id" IS '所属工作区 ID';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "public"."global_config"."updated_by" IS '更新人用户 ID';
