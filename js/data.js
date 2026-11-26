/* 估算配置数据：费率表、功能基准、技术栈方案、项目类型
 * 所有数值均可通过「费率设置」页面修改并保存到浏览器本地。
 */
(function () {
  'use strict';

  var DEFAULTS = {
    version: 1,

    // 项目类型
    projectTypes: [
      { value: 'web_app',       label: 'Web 应用 / 官网' },
      { value: 'mini_program',  label: '微信小程序' },
      { value: 'mobile',        label: '移动 App' },
      { value: 'admin',         label: '管理后台 / SaaS' },
      { value: 'data_dashboard',label: '数据大屏 / BI' },
      { value: 'ai',            label: 'AI 应用' },
      { value: 'other',         label: '其他' }
    ],

    // 复杂度四档（系数为计价单一来源）
    complexityLevels: [
      { value: 'simple',       label: '简单',   coefficient: 0.8 },
      { value: 'normal',       label: '一般',   coefficient: 1.0 },
      { value: 'complex',      label: '复杂',   coefficient: 1.3 },
      { value: 'very_complex', label: '极复杂', coefficient: 1.6 }
    ],

    // 功能点基准人天（关键词命中或手工选择时使用）
    featureBaseline: {
      user_auth:        { label: '用户注册/登录',   days: 2.0 },
      payment:          { label: '支付集成',       days: 8.0 },
      crud:             { label: '基础增删改查',   days: 1.5 },
      realtime_chat:    { label: '即时通讯/实时',  days: 10.0 },
      dashboard:        { label: '数据看板/报表',  days: 5.0 },
      file_upload:      { label: '文件上传/存储',  days: 2.0 },
      search:           { label: '搜索/筛选',      days: 4.0 },
      third_party_api:  { label: '第三方接口对接', days: 3.0 },
      push_notify:      { label: '消息推送',       days: 3.0 },
      permission:       { label: '权限/角色管理',  days: 4.0 },
      ai_model:         { label: 'AI 模型接入',    days: 6.0 },
      data_export:      { label: '导入/导出',      days: 2.0 },
      order_workflow:   { label: '订单/业务流程',  days: 6.0 },
      map_location:     { label: '地图/定位',      days: 4.0 },
      social_share:     { label: '分享/裂变',      days: 2.5 }
    },

    // 关键词 → 功能点（自由文本自动识别）
    keywordRules: [
      { type: 'user_auth',       keywords: ['登录', '注册', '账号', '认证', '单点登录', '微信一键登录'] },
      { type: 'payment',         keywords: ['支付', '微信支付', '支付宝', '下单', '收银台', '退款'] },
      { type: 'crud',            keywords: ['增删改查', '列表管理', '表单', '内容管理'] },
      { type: 'realtime_chat',   keywords: ['即时通讯', '聊天', 'websocket', '实时消息', '客服'] },
      { type: 'dashboard',       keywords: ['看板', '报表', '统计', '图表', '大屏', '数据分析'] },
      { type: 'file_upload',     keywords: ['上传', '图片', '附件', '文件', '相册'] },
      { type: 'search',          keywords: ['搜索', '检索', '筛选', '全文检索'] },
      { type: 'third_party_api', keywords: ['接口对接', '第三方', 'api对接', '短信', 'oss'] },
      { type: 'push_notify',     keywords: ['推送', '通知', '订阅消息', '短信提醒'] },
      { type: 'permission',      keywords: ['权限', '角色', '多租户', '组织架构'] },
      { type: 'ai_model',        keywords: ['ai', '大模型', '智能推荐', 'llm', 'ocr', '识别'] },
      { type: 'data_export',     keywords: ['导出', '导入', 'excel', 'csv'] },
      { type: 'order_workflow',  keywords: ['订单', '流程', '审批', '购物车', '库存'] },
      { type: 'map_location',    keywords: ['地图', '定位', 'lbs', '轨迹'] },
      { type: 'social_share',    keywords: ['分享', '海报', '邀请', '分销'] }
    ],

    // 角色日费率（CNY / 人天）
    roleRates: {
      requirement: 1000,
      frontend:    1200,
      backend:     1500,
      qa:           900
    },

    // 阶段 × 角色分配（合计 1.00，与交付方案黄金用例一致）
    allocation: [
      { phase: '需求与设计', role: 'requirement', weight: 0.15 },
      { phase: '前端开发',   role: 'frontend',    weight: 0.30 },
      { phase: '后端开发',   role: 'backend',     weight: 0.35 },
      { phase: '测试交付',   role: 'qa',          weight: 0.20 }
    ],

    roleLabels: {
      requirement: '需求分析',
      frontend:    '前端工程',
      backend:     '后端工程',
      qa:          '测试'
    },

    // 地区系数
    regionFactor: { tier1: 1.20, tier2: 1.00, tier3: 0.85 },
    regionLabels: { tier1: '一线城市', tier2: '二线城市', tier3: '其他地区' },

    // 基础设施基线（CNY / 月）
    infraBaseline: { small: 500, medium: 1500, large: 4000 },
    infraLabels:   { small: '小型（轻量托管）', medium: '中型（独立服务器）', large: '大型（集群）' },

    // 风险缓冲区间
    contingencyLow:  0.15,
    contingencyHigh: 0.20,

    // 技术栈方案库：每个项目类型 3 套候选
    stackCatalog: {
      web_app: [
        { name: '高性价比快速上线', frontend: 'Vue 3 + Vite', backend: 'Node.js + NestJS', database: 'PostgreSQL', infra: '静态托管 + 云函数', baseScore: 88, confidence: 'high',
          pros: ['开发快、成本低', '前端生态成熟', '部署简单'], cons: ['超大规模需重构'], tags: ['crud', 'user_auth', 'search'] },
        { name: '稳健企业级', frontend: 'React + TypeScript', backend: 'Java / Spring Boot', database: 'MySQL + Redis', infra: 'Docker + Nginx', baseScore: 82, confidence: 'high',
          pros: ['生态成熟、招人容易', '事务与并发能力强'], cons: ['开发周期略长'], tags: ['payment', 'permission', 'order_workflow'] },
        { name: '全栈一体化', frontend: 'Next.js', backend: 'Next.js API Routes', database: 'PostgreSQL', infra: 'Vercel / 边缘部署', baseScore: 76, confidence: 'medium',
          pros: ['SSR 利于 SEO', '一套代码前后端'], cons: ['复杂业务分层受限'], tags: ['search', 'data_export'] }
      ],
      mini_program: [
        { name: '原生小程序 + 云开发', frontend: '微信小程序原生', backend: '云开发 CloudBase', database: '云数据库', infra: '微信云托管', baseScore: 92, confidence: 'high',
          pros: ['上线最快、免运维', '微信生态能力完整', '成本最低'], cons: ['跨平台能力弱'], tags: ['payment', 'user_auth', 'push_notify'] },
        { name: '跨端框架方案', frontend: 'Taro / uni-app', backend: 'Node.js + NestJS', database: 'PostgreSQL', infra: '轻量云服务器', baseScore: 83, confidence: 'high',
          pros: ['一套代码多端复用', '便于后续扩展 App'], cons: ['框架适配有额外成本'], tags: ['order_workflow', 'social_share'] },
        { name: '中后台分离方案', frontend: '小程序 + Vue 管理后台', backend: 'Python + FastAPI', database: 'PostgreSQL', infra: 'Docker Compose', baseScore: 78, confidence: 'medium',
          pros: ['运营后台能力完整', '适合复杂业务'], cons: ['需要两套前端'], tags: ['dashboard', 'permission', 'data_export'] }
      ],
      mobile: [
        { name: '跨平台优先', frontend: 'Flutter', backend: 'Node.js + NestJS', database: 'PostgreSQL', infra: '云服务器 + CDN', baseScore: 88, confidence: 'high',
          pros: ['一套代码双端', '性能接近原生'], cons: ['深度原生能力需插件'], tags: ['user_auth', 'file_upload'] },
        { name: 'React Native 方案', frontend: 'React Native', backend: 'Java / Spring Boot', database: 'MySQL', infra: '容器化部署', baseScore: 82, confidence: 'high',
          pros: ['前端团队易上手', '热更新灵活'], cons: ['版本兼容需维护'], tags: ['realtime_chat', 'push_notify'] },
        { name: '原生双端', frontend: 'Kotlin / Swift', backend: 'Go', database: 'PostgreSQL', infra: 'K8s', baseScore: 74, confidence: 'medium',
          pros: ['性能与体验最佳'], cons: ['人力成本翻倍'], tags: ['map_location', 'payment'] }
      ],
      admin: [
        { name: '中后台标准方案', frontend: 'Vue 3 + Element Plus', backend: 'Java / Spring Boot', database: 'MySQL + Redis', infra: 'Docker + Nginx', baseScore: 90, confidence: 'high',
          pros: ['表单/表格组件齐全', '权限体系成熟'], cons: ['前端定制自由度一般'], tags: ['permission', 'crud', 'data_export'] },
        { name: '轻量快速方案', frontend: 'React + Ant Design', backend: 'Python + FastAPI', database: 'PostgreSQL', infra: '云函数 + 托管数据库', baseScore: 84, confidence: 'high',
          pros: ['开发效率高', '数据分析生态好'], cons: ['复杂事务需额外设计'], tags: ['dashboard', 'search'] },
        { name: '低代码混合', frontend: '低代码平台 + 定制组件', backend: 'Node.js BFF', database: 'PostgreSQL', infra: 'PaaS', baseScore: 72, confidence: 'low',
          pros: ['标准模块零开发'], cons: ['深度定制受限、平台绑定'], tags: ['crud'] }
      ],
      data_dashboard: [
        { name: '可视化标准方案', frontend: 'Vue 3 + ECharts', backend: 'Python + FastAPI', database: 'ClickHouse / PostgreSQL', infra: 'Docker Compose', baseScore: 89, confidence: 'high',
          pros: ['图表生态最强', '大数据查询性能好'], cons: ['实时链路需额外设计'], tags: ['dashboard', 'data_export'] },
        { name: 'BI 工具集成', frontend: 'React + 嵌入式 BI', backend: 'Java / Spring Boot', database: '数据仓库', infra: '私有化部署', baseScore: 80, confidence: 'medium',
          pros: ['报表配置化、交付快'], cons: ['授权费用、定制受限'], tags: ['dashboard'] },
        { name: '实时流式方案', frontend: 'Vue 3 + WebSocket', backend: 'Go + Kafka', database: 'TimescaleDB', infra: 'K8s', baseScore: 75, confidence: 'medium',
          pros: ['秒级实时刷新'], cons: ['运维复杂度高'], tags: ['realtime_chat', 'dashboard'] }
      ],
      ai: [
        { name: 'LLM 应用标准栈', frontend: 'Vue 3 / Next.js', backend: 'Python + FastAPI', database: 'PostgreSQL + pgvector', infra: '云函数 + 向量库', baseScore: 90, confidence: 'high',
          pros: ['AI 生态最完善', 'RAG 检索开箱可用'], cons: ['推理调用有持续成本'], tags: ['ai_model', 'search'] },
        { name: '低代码编排方案', frontend: 'React', backend: 'Node.js + LangChain', database: 'MongoDB', infra: 'Serverless', baseScore: 80, confidence: 'medium',
          pros: ['编排迭代快'], cons: ['高并发性能有限'], tags: ['ai_model'] },
        { name: '私有化部署方案', frontend: 'Vue 3', backend: 'Python + 本地模型', database: 'PostgreSQL', infra: '自建 GPU 服务器', baseScore: 72, confidence: 'low',
          pros: ['数据不出内网'], cons: ['硬件投入高'], tags: ['ai_model', 'permission'] }
      ],
      other: [
        { name: '通用 Web 方案', frontend: 'Vue 3 + Vite', backend: 'Node.js + NestJS', database: 'PostgreSQL', infra: '静态托管 + 云函数', baseScore: 80, confidence: 'medium',
          pros: ['技术门槛低、成本可控'], cons: ['需按实际业务调整'], tags: [] },
        { name: '企业级稳健方案', frontend: 'React + TypeScript', backend: 'Java / Spring Boot', database: 'MySQL + Redis', infra: 'Docker + Nginx', baseScore: 78, confidence: 'medium',
          pros: ['可维护性强'], cons: ['交付周期较长'], tags: [] },
        { name: 'Python 全栈方案', frontend: 'Vue 3', backend: 'Python + FastAPI', database: 'PostgreSQL', infra: '轻量云服务器', baseScore: 76, confidence: 'medium',
          pros: ['数据处理能力强'], cons: ['前端生态需自行搭建'], tags: [] }
      ]
    }
  };

  window.APP_DATA = DEFAULTS;
})();
