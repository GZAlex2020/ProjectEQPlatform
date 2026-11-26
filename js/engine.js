/* 估算引擎（纯前端规则版，对应交付方案 6 步流程）
 * 输出结构与后端 GET /api/v1/analyses/{id} 的 data 对齐，便于日后接服务端。
 */
(function () {
  'use strict';

  // 加极小 epsilon 修正二进制浮点误差（如 10827.5×1.15=12451.625 应进位为 12451.63）
  function round2(n) { return Math.round((n + 1e-9) * 100) / 100; }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function coefficientOf(config, value) {
    var levels = config.complexityLevels || [];
    for (var i = 0; i < levels.length; i++) {
      if (levels[i].value === value) return Number(levels[i].coefficient);
    }
    return 1.0;
  }

  // ① 预处理
  function preprocess(req) {
    var parts = [req.title || '', req.description || ''];
    (req.features || []).forEach(function (f) {
      parts.push(f.name || '', f.desc || '');
    });
    if (req.techPreference) parts.push(req.techPreference);
    return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // ② 特征提取：手工功能项 + 关键词自动识别（去重）
  function extractFeatures(req, config, text) {
    var out = [];
    var seen = {};
    var baselines = config.featureBaseline;
    var levels = config.complexityLevels;

    (req.features || []).forEach(function (f) {
      var name = (f.name || '').trim();
      if (!name) return;
      var type = f.type || 'custom';
      var base = baselines[type] ? baselines[type].days : 2.0;
      var label = baselines[type] ? baselines[type].label : name;
      var key = name + '|' + type;
      if (seen[key]) return;
      seen[key] = true;
      var coef = coefficientOf(config, f.complexity || 'normal');
      out.push({
        type: type, label: label, name: name,
        complexity: f.complexity || 'normal',
        coefficient: coef, baselineDays: base,
        days: round3(base * coef),
        source: 'manual',
        basis: '手工功能项「' + name + '」：基准 ' + base + ' 人天 × 复杂度系数 ' + coef
      });
    });

    (config.keywordRules || []).forEach(function (rule) {
      var hit = null;
      for (var i = 0; i < rule.keywords.length; i++) {
        if (text.indexOf(rule.keywords[i]) !== -1) { hit = rule.keywords[i]; break; }
      }
      if (!hit) return;
      // 手工已填同类型功能项则不重复计入
      var dup = out.some(function (f) { return f.type === rule.type && f.source === 'manual'; });
      if (dup) return;
      var base = baselines[rule.type] ? baselines[rule.type].days : 2.0;
      var label = baselines[rule.type] ? baselines[rule.type].label : rule.type;
      out.push({
        type: rule.type, label: label, name: label,
        complexity: 'normal', coefficient: 1.0, baselineDays: base,
        days: round3(base), source: 'keyword',
        basis: '需求文本命中关键词「' + hit + '」→ ' + label + '，基准 ' + base + ' 人天'
      });
    });

    if (out.length === 0) {
      var base0 = baselines.crud.days;
      out.push({
        type: 'crud', label: '基础页面与数据管理', name: '基础功能',
        complexity: 'normal', coefficient: 1.0, baselineDays: base0,
        days: round3(base0), source: 'fallback',
        basis: '未识别到具体功能点，按最小可用功能集（基础增删改查）兜底估算'
      });
    }
    return out;
  }

  // ③ 技术栈候选：按项目类型取 3 套，按命中特征与约束微调打分
  function buildStacks(req, config, features) {
    var types = req.projectType || 'other';
    var catalog = config.stackCatalog[types] || config.stackCatalog.other;
    var featureTypes = features.map(function (f) { return f.type; });
    var projectLabel = '';
    config.projectTypes.forEach(function (p) { if (p.value === types) projectLabel = p.label; });

    var budgetLow = /^(small|low)$/.test(String(req.budgetLevel || '')) || Number(req.budget) > 0 && Number(req.budget) < 50000;

    var stacks = catalog.map(function (s) {
      var matchedTags = (s.tags || []).filter(function (t) { return featureTypes.indexOf(t) !== -1; });
      var score = s.baseScore + matchedTags.length * 3;
      if (budgetLow && s.name.indexOf('高性价比') !== -1) score += 5;
      if (req.techPreference && (s.frontend + s.backend).toLowerCase().indexOf(String(req.techPreference).toLowerCase()) !== -1) score += 6;
      score = clamp(Math.round(score), 0, 100);

      var reasons = [];
      reasons.push('项目类型为「' + projectLabel + '」，匹配预设技术栈方案库');
      if (matchedTags.length) {
        reasons.push('命中功能特征：' + matchedTags.map(function (t) {
          return config.featureBaseline[t] ? config.featureBaseline[t].label : t;
        }).join('、') + '（该技术栈对此类场景支持更好）');
      }
      if (req.techPreference) reasons.push('已考虑技术偏好：' + req.techPreference);
      if (budgetLow) reasons.push('预算偏紧，优先推荐低成本交付路径');
      if (req.timeline) reasons.push('期望周期 ' + req.timeline + ' 个月，方案交付节奏可匹配');

      return {
        stackName: s.name,
        frontend: s.frontend, backend: s.backend,
        database: s.database, infra: s.infra,
        score: score,
        confidence: score >= 85 ? 'high' : (score >= 70 ? 'medium' : 'low'),
        reasons: reasons,
        pros: s.pros.slice(), cons: s.cons.slice()
      };
    });

    stacks.sort(function (a, b) { return b.score - a.score; });
    return stacks.slice(0, 3).map(function (s, i) { s.rank = i + 1; return s; });
  }

  // ④ 工时估算 + ⑤ 费用估算
  function estimateEffortAndCost(req, config, features) {
    var totalDays = 0;
    features.forEach(function (f) { totalDays += f.days; });
    totalDays = round3(Math.max(0, totalDays));

    var allocation = config.allocation;
    var rates = config.roleRates;
    var breakdown = [];
    var labor = 0;
    allocation.forEach(function (a) {
      var pd = totalDays * a.weight;
      var cost = pd * rates[a.role];
      labor += cost;
      breakdown.push({
        phase: a.phase, role: a.role,
        roleLabel: config.roleLabels[a.role] || a.role,
        personDays: round3(pd),
        dayRate: rates[a.role],
        basis: '总功能点 ' + totalDays + ' 人天 × ' + a.phase + '占比 ' + a.weight +
               '，日费率 ' + rates[a.role] + ' 元/人天'
      });
    });
    labor = round2(labor);

    var months = Math.max(1, Number(req.timeline) || 1);
    var scale = req.scale || 'small';
    var infraUnit = config.infraBaseline[scale];
    var infra = round2(infraUnit * months);
    var region = req.region || 'tier2';
    var factor = config.regionFactor[region];
    var subtotal = round2((labor + infra) * factor);

    var low = round2(subtotal * (1 + config.contingencyLow));
    var high = round2(subtotal * (1 + config.contingencyHigh));

    return {
      totalPersonDays: totalDays,
      effortBreakdown: breakdown,
      cost: {
        currency: 'CNY',
        laborCost: labor,
        infraCost: infra,
        infraBasis: config.infraLabels[scale] + ' ' + infraUnit + ' 元/月 × ' + months + ' 个月',
        regionFactor: factor,
        regionLabel: config.regionLabels[region],
        subtotal: subtotal,
        contingencyLow: config.contingencyLow,
        contingencyHigh: config.contingencyHigh,
        totalLow: low,
        totalHigh: high,
        basis: '人力 ' + labor + ' + 基础设施 ' + infra + ' = ' + round2(labor + infra) +
               '，' + config.regionLabels[region] + '系数 ' + factor + ' → ' + subtotal +
               '，风险缓冲 ' + (config.contingencyLow * 100) + '%~' + (config.contingencyHigh * 100) + '%',
        rateSnapshot: JSON.parse(JSON.stringify(rates))
      }
    };
  }

  // ⑥ 主入口
  function estimate(requirement, config) {
    var cfg = config || window.APP_DATA;
    var text = preprocess(requirement);
    var features = extractFeatures(requirement, cfg, text);
    var stacks = buildStacks(requirement, cfg, features);
    var calc = estimateEffortAndCost(requirement, cfg, features);

    var trace = [
      '步骤1 预处理：合并标题、描述与功能项文本，共 ' + text.length + ' 字符',
      '步骤2 特征提取：识别 ' + features.length + ' 个功能点（手工 ' +
        features.filter(function (f) { return f.source === 'manual'; }).length +
        ' / 关键词 ' + features.filter(function (f) { return f.source === 'keyword'; }).length + '）',
      '步骤3 技术栈候选：按项目类型匹配方案库并加权打分，输出 Top 3',
      '步骤4 工时估算：功能点法合计 ' + calc.totalPersonDays + ' 人天',
      '步骤5 费用估算：输出区间 ' + calc.cost.totalLow + ' ~ ' + calc.cost.totalHigh + ' ' + calc.cost.currency,
      '步骤6 可解释性：每条推荐附 reasons，每项工时/费用附 basis'
    ];

    return {
      engineMode: 'rule',
      degraded: false,
      degradation: null,
      generatedAt: new Date().toISOString(),
      configVersion: cfg.version,
      features: features,
      recommendations: stacks,
      totalPersonDays: calc.totalPersonDays,
      effortBreakdown: calc.effortBreakdown,
      cost: calc.cost,
      trace: trace
    };
  }

  window.EstimateEngine = { estimate: estimate };
})();
