/* 应用主逻辑：表单 / 估算 / 保存 / 历史 / 费率 / 备份 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) {
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var fmtDate = function (iso) {
    try {
      var d = new Date(iso);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
        ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return String(iso); }
  };
  var icon = function (name, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + name + '"></use></svg>'; };

  var cfg = Storage.getConfig();
  var currentView = 'new';
  var lastRecord = null;

  /* ---------------- toast ---------------- */
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = icon(type === 'error' ? 'info' : 'check') + '<span>' + esc(msg) + '</span>';
    $('#toastWrap').appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = '.25s';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2800);
  }

  /* ---------------- modal ---------------- */
  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalMask').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modalMask').hidden = true;
    document.body.style.overflow = '';
  }
  function confirmDialog(title, message, okText, onOk) {
    openModal(title,
      '<div class="notice notice-warn">' + icon('info') + '<div>' + esc(message) + '</div></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">' +
      '<button class="btn-outline" id="cfmCancel">取消</button>' +
      '<button class="btn-danger" id="cfmOk">' + icon('trash') + esc(okText) + '</button></div>');
    $('#cfmCancel').onclick = closeModal;
    $('#cfmOk').onclick = function () { closeModal(); onOk(); };
  }

  /* ---------------- 初始化下拉 ---------------- */
  function initSelects() {
    $('#f-type').innerHTML = cfg.projectTypes.map(function (p) {
      return '<option value="' + esc(p.value) + '">' + esc(p.label) + '</option>';
    }).join('');
    $('#f-region').innerHTML = Object.keys(cfg.regionLabels).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === 'tier2' ? ' selected' : '') + '>' + esc(cfg.regionLabels[k]) + '</option>';
    }).join('');
    $('#f-scale').innerHTML = Object.keys(cfg.infraLabels).map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(cfg.infraLabels[k]) + '</option>';
    }).join('');
    var dl = document.createElement('datalist');
    dl.id = 'featurePresets';
    dl.innerHTML = Object.keys(cfg.featureBaseline).map(function (k) {
      return '<option value="' + esc(cfg.featureBaseline[k].label) + '"></option>';
    }).join('');
    document.body.appendChild(dl);
  }

  /* ---------------- 功能行 ---------------- */
  function complexityOptions(selected) {
    return cfg.complexityLevels.map(function (c) {
      return '<option value="' + esc(c.value) + '"' + (c.value === selected ? ' selected' : '') + '>' +
        esc(c.label) + ' (×' + c.coefficient + ')</option>';
    }).join('');
  }
  function addFeatureRow(data) {
    var d = data || { name: '', complexity: 'normal' };
    var row = document.createElement('div');
    row.className = 'feature-row';
    row.innerHTML =
      '<input type="text" class="f-name" list="featurePresets" maxlength="40" placeholder="功能名称，如：微信支付" value="' + esc(d.name) + '">' +
      '<select class="f-complexity">' + complexityOptions(d.complexity) + '</select>' +
      '<button class="icon-btn f-del" type="button" aria-label="删除该功能项">' + icon('trash') + '</button>';
    $('.f-del', row).onclick = function () {
      row.remove();
      if ($$('.feature-row').length === 0) addFeatureRow();
    };
    $('#featureRows').appendChild(row);
    return row;
  }
  function readFeatureRows() {
    return $$('.feature-row').map(function (row) {
      var name = $('.f-name', row).value.trim();
      var complexity = $('.f-complexity', row).value;
      if (!name) return null;
      return { name: name, desc: '', complexity: complexity, type: guessType(name) };
    }).filter(Boolean);
  }
  function guessType(name) {
    var n = String(name).toLowerCase();
    var keys = Object.keys(cfg.featureBaseline);
    for (var i = 0; i < keys.length; i++) {
      var label = cfg.featureBaseline[keys[i]].label.toLowerCase();
      if (n === label || n.indexOf(label) !== -1 || label.indexOf(n) !== -1) return keys[i];
    }
    for (var j = 0; j < cfg.keywordRules.length; j++) {
      var r = cfg.keywordRules[j];
      for (var k = 0; k < r.keywords.length; k++) {
        if (n.indexOf(r.keywords[k]) !== -1) return r.type;
      }
    }
    return 'custom';
  }

  /* ---------------- 表单 ---------------- */
  function readForm() {
    return {
      title: $('#f-title').value.trim(),
      description: $('#f-desc').value.trim(),
      projectType: $('#f-type').value,
      region: $('#f-region').value,
      timeline: Number($('#f-timeline').value) || 1,
      scale: $('#f-scale').value,
      budget: $('#f-budget').value === '' ? null : Number($('#f-budget').value),
      techPreference: $('#f-pref').value.trim(),
      features: readFeatureRows()
    };
  }
  function fillForm(req) {
    $('#f-title').value = req.title || '';
    $('#f-desc').value = req.description || '';
    $('#f-type').value = req.projectType || 'other';
    $('#f-region').value = req.region || 'tier2';
    $('#f-timeline').value = req.timeline || 1;
    $('#f-scale').value = req.scale || 'small';
    $('#f-budget').value = req.budget == null ? '' : req.budget;
    $('#f-pref').value = req.techPreference || '';
    $('#featureRows').innerHTML = '';
    var fs = (req.features && req.features.length) ? req.features : [{ name: '', complexity: 'normal' }];
    fs.forEach(function (f) { addFeatureRow({ name: f.name, complexity: f.complexity }); });
    updateDescCount();
    switchView('new');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clearForm() {
    $('#f-title').value = '';
    $('#f-desc').value = '';
    $('#f-type').value = 'web_app';
    $('#f-region').value = 'tier2';
    $('#f-timeline').value = 1;
    $('#f-scale').value = 'small';
    $('#f-budget').value = '';
    $('#f-pref').value = '';
    $('#featureRows').innerHTML = '';
    addFeatureRow({ name: '用户注册/登录', complexity: 'normal' });
    updateDescCount();
    $$('.field').forEach(function (f) { f.classList.remove('invalid'); });
  }
  function updateDescCount() { $('#descCount').textContent = $('#f-desc').value.length; }

  function validate(req) {
    var ok = true;
    $$('.field').forEach(function (f) { f.classList.remove('invalid'); });
    if (req.title.length < 2) { $('#f-title').closest('.field').classList.add('invalid'); ok = false; }
    if (req.description.length < 20) { $('#f-desc').closest('.field').classList.add('invalid'); ok = false; }
    if (req.features.length === 0) { ok = false; }
    if (!ok) toast('请检查：项目名称至少 2 字、需求描述至少 20 字、至少填一个功能项', 'error');
    return ok;
  }

  function doEstimate() {
    var req = readForm();
    if (!validate(req)) return;
    cfg = Storage.getConfig();
    var result;
    try {
      result = window.EstimateEngine.estimate(req, cfg);
    } catch (e) {
      toast('估算失败：' + (e && e.message), 'error');
      return;
    }
    var saved = Storage.save({
      requirement: req,
      result: result,
      engineMode: result.engineMode,
      note: ''
    });
    if (!saved.ok) { toast(saved.error || '保存失败', 'error'); return; }
    lastRecord = Storage.get(saved.id);
    renderResult(lastRecord, $('#resultArea'));
    refreshCounts();
    toast('估算完成，已保存到历史报价', 'success');
  }

  /* ---------------- 结果渲染 ---------------- */
  var BAR_COLORS = ['#2563eb', '#0ea5a4', '#8b5cf6', '#f59e0b'];

  function renderResult(record, target) {
    var r = record.result, req = record.requirement;
    var typeLabel = '';
    cfg.projectTypes.forEach(function (p) { if (p.value === req.projectType) typeLabel = p.label; });
    var top = r.recommendations[0];

    var html = '';
    html += '<div class="result-head">';
    html += '<div><h2>' + esc(req.title) + '</h2><div class="sub">' + esc(typeLabel) +
      ' · 生成于 ' + esc(fmtDate(r.generatedAt)) + ' · 规则引擎 v' + esc(r.configVersion) + '</div></div>';
    html += '<div class="result-actions">' +
      '<button class="btn-outline" data-act="reload">' + icon('copy') + ' 载入重算</button>' +
      '<button class="btn-outline" data-act="print">' + icon('download') + ' 导出单条</button>' +
      '</div></div>';

    html += '<div class="metric-grid">';
    html += '<div class="metric accent"><div class="label">' + icon('wallet') + ' 项目费用区间</div>' +
      '<div class="value">¥' + esc(money(r.cost.totalLow)) + '<small>起</small></div>' +
      '<div class="desc">上限 ¥' + esc(money(r.cost.totalHigh)) + ' · 含 ' +
      (r.cost.contingencyLow * 100) + '%~' + (r.cost.contingencyHigh * 100) + '% 风险缓冲</div></div>';
    html += '<div class="metric"><div class="label">' + icon('clock') + ' 预计总工时</div>' +
      '<div class="value">' + esc(r.totalPersonDays) + '<small>人天</small></div>' +
      '<div class="desc">按 ' + esc(r.features.length) + ' 个功能点估算</div></div>';
    html += '<div class="metric"><div class="label">' + icon('spark') + ' 首选技术方案</div>' +
      '<div class="value" style="font-size:16px;line-height:1.5">' + esc(top ? top.stackName : '-') + '</div>' +
      '<div class="desc">匹配度 ' + esc(top ? top.score : 0) + '/100 · 共 ' + esc(r.recommendations.length) + ' 套候选</div></div>';
    html += '</div>';

    html += '<div class="section-title">' + icon('spark') + ' 技术栈方案对比 <span class="hint">按匹配度排序，每项均可展开查看推荐理由</span></div>';
    html += '<div class="stack-grid">';
    r.recommendations.forEach(function (s) {
      html += '<div class="stack-card' + (s.rank === 1 ? ' rank1' : '') + '">';
      html += '<div class="rank-badge">方案 ' + s.rank + (s.rank === 1 ? ' · 首选' : '') + '</div>';
      html += '<span class="badge ' + esc(s.confidence) + ' confidence">' +
        (s.confidence === 'high' ? '高置信' : s.confidence === 'medium' ? '中置信' : '低置信') + '</span>';
      html += '<div class="stack-name">' + esc(s.stackName) + '</div>';
      html += '<div class="score-line"><div class="bar"><i style="width:' + s.score + '%"></i></div><b>' + s.score + '</b></div>';
      html += '<div class="tech-lines">' +
        '<div><span>前端</span>' + esc(s.frontend) + '</div>' +
        '<div><span>后端</span>' + esc(s.backend) + '</div>' +
        '<div><span>数据库</span>' + esc(s.database) + '</div>' +
        '<div><span>部署</span>' + esc(s.infra) + '</div></div>';
      html += '<div class="proscons"><div class="p"><h5>优势</h5><ul>' +
        s.pros.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="c"><h5>局限</h5><ul>' +
        s.cons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';
      html += '<details class="details"><summary>查看推荐理由</summary><ul class="reason-list">' +
        s.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
      html += '</div>';
    });
    html += '</div>';

    html += '<div class="section-title">' + icon('chart') + ' 工时构成 <span class="hint">按阶段 × 角色拆分</span></div>';
    html += '<div class="card-block"><div class="effort-bar">';
    r.effortBreakdown.forEach(function (b, i) {
      html += '<i style="width:' + (b.personDays / r.totalPersonDays * 100) + '%;background:' + BAR_COLORS[i % BAR_COLORS.length] + '" title="' + esc(b.phase) + '"></i>';
    });
    html += '</div><div class="effort-legend">';
    r.effortBreakdown.forEach(function (b, i) {
      html += '<span><em style="background:' + BAR_COLORS[i % BAR_COLORS.length] + '"></em>' +
        esc(b.phase) + ' ' + esc(b.personDays) + ' 人天</span>';
    });
    html += '</div>';
    html += '<table><thead><tr><th>阶段</th><th>角色</th><th>人天</th><th>日费率</th><th>估算依据</th></tr></thead><tbody>';
    r.effortBreakdown.forEach(function (b) {
      html += '<tr><td>' + esc(b.phase) + '</td><td>' + esc(b.roleLabel) + '</td>' +
        '<td class="num">' + esc(b.personDays) + '</td><td class="num">¥' + esc(b.dayRate) + '</td>' +
        '<td class="basis">' + esc(b.basis) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="section-title">' + icon('wallet') + ' 费用区间与构成</div>';
    html += '<div class="card-block"><div class="cost-range">' +
      '<div class="range-track"><div class="range-fill"></div>' +
      '<div class="range-marker lo"></div><div class="range-marker hi"></div></div>' +
      '<div class="range-labels"><div>¥' + esc(money(r.cost.totalLow)) + '<small>下限（乐观）</small></div>' +
      '<div style="text-align:right">¥' + esc(money(r.cost.totalHigh)) + '<small>上限（含风险缓冲）</small></div></div></div>';
    html += '<div class="cost-breakdown">' +
      '<div class="cost-item"><div class="k">人力成本</div><div class="v">¥' + esc(money(r.cost.laborCost)) + '</div></div>' +
      '<div class="cost-item"><div class="k">基础设施</div><div class="v">¥' + esc(money(r.cost.infraCost)) + '</div></div>' +
      '<div class="cost-item"><div class="k">地区系数</div><div class="v">×' + esc(r.cost.regionFactor) + '</div></div>' +
      '<div class="cost-item"><div class="k">项目周期</div><div class="v">' + esc(req.timeline) + ' 个月</div></div></div>';
    html += '<p class="basis" style="margin-top:12px">' + esc(r.cost.basis) + '</p>';
    html += '<p class="basis">' + esc(r.cost.infraBasis) + '；' + esc(r.cost.regionLabel) + '</p>';
    html += '<div class="trace-box"><h4>估算依据与分析轨迹</h4><ol>' +
      r.trace.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>';
    html += '<details class="details" style="margin-top:8px"><summary>查看功能点明细</summary><table style="margin-top:10px">' +
      '<thead><tr><th>功能点</th><th>来源</th><th>复杂度</th><th>系数</th><th>基准</th><th>人天</th><th>依据</th></tr></thead><tbody>';
    r.features.forEach(function (f) {
      html += '<tr><td>' + esc(f.name) + '</td><td>' +
        (f.source === 'manual' ? '手工' : f.source === 'keyword' ? '自动识别' : '兜底') + '</td>' +
        '<td>' + esc(f.complexity) + '</td><td class="num">×' + esc(f.coefficient) + '</td>' +
        '<td class="num">' + esc(f.baselineDays) + '</td><td class="num">' + esc(f.days) + '</td>' +
        '<td class="basis">' + esc(f.basis) + '</td></tr>';
    });
    html += '</tbody></table></details></div></div>';
    html += '<p class="form-note" style="margin-top:14px">本结果为基于规则与经验费率的预估值，仅供报价参考，实际以需求澄清与团队评估为准。</p>';

    target.innerHTML = html;
    target.className = 'result-area';

    $$('[data-act]', target).forEach(function (btn) {
      btn.onclick = function () {
        var act = btn.getAttribute('data-act');
        if (act === 'reload') { fillForm(req); toast('已载入表单，修改后可重新估算', 'success'); }
        if (act === 'print') exportSingle(record);
      };
    });
  }

  function exportSingle(record) {
    var data = { format: 'estimate-platform-backup', version: 1, exportedAt: new Date().toISOString(), records: [record] };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '报价_' + String(record.requirement.title).replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出单条报价', 'success');
  }

  /* ---------------- 历史 ---------------- */
  function renderHistory() {
    var kw = ($('#historySearch').value || '').trim().toLowerCase();
    var items = Storage.list().filter(function (r) {
      if (!kw) return true;
      var q = r.requirement || {};
      var label = '';
      cfg.projectTypes.forEach(function (p) { if (p.value === q.projectType) label = p.label; });
      return [q.title, q.description, label, String(q.techPreference)].join(' ').toLowerCase().indexOf(kw) !== -1;
    });
    $('#historySummary').textContent = '共 ' + Storage.list().length + ' 条' + (kw ? '，匹配 ' + items.length + ' 条' : '');
    if (!items.length) {
      $('#historyList').innerHTML = '<div class="no-result">' +
        (kw ? '没有匹配的记录，换个关键词试试' : '还没有保存的项目报价，去「新建估算」生成第一条吧') + '</div>';
      return;
    }
    $('#historyList').innerHTML = items.map(function (r) {
      var q = r.requirement, c = r.result.cost;
      var label = '';
      cfg.projectTypes.forEach(function (p) { if (p.value === q.projectType) label = p.label; });
      var top = r.result.recommendations[0];
      return '<div class="hcard" data-id="' + esc(r.id) + '">' +
        '<div class="hcard-main"><h3>' + esc(q.title) + '</h3>' +
        '<div class="hcard-meta"><span>' + esc(label) + '</span><span>' + esc(r.result.totalPersonDays) + ' 人天</span>' +
        '<span>' + esc(top ? top.stackName : '-') + '</span><span>' + esc(fmtDate(r.createdAt)) + '</span></div></div>' +
        '<div class="hcard-price"><div class="p">¥' + esc(money(c.totalLow)) + ' ~ ' + esc(money(c.totalHigh)) + '</div>' +
        '<div class="d">' + esc(c.currency) + ' · ' + esc(r.result.engineMode) + '</div></div>' +
        '<div class="hcard-actions">' +
        '<button class="btn-outline" data-hact="view">' + icon('eye') + ' 详情</button>' +
        '<button class="icon-btn" data-hact="del" aria-label="删除">' + icon('trash') + '</button>' +
        '</div></div>';
    }).join('');

    $$('#historyList .hcard').forEach(function (card) {
      var id = card.getAttribute('data-id');
      $$('[data-hact]', card).forEach(function (btn) {
        btn.onclick = function () {
          var rec = Storage.get(id);
          if (!rec) return;
          var act = btn.getAttribute('data-hact');
          if (act === 'view') {
            var q = rec.requirement;
            var head = '<div class="notice" style="margin-bottom:18px">' + icon('info') +
              '<div><strong>需求描述：</strong>' + esc(q.description || '（无）') + '</div></div>';
            openModal('报价详情 · ' + q.title, head + '<div id="modalResult"></div>');
            renderResult(rec, $('#modalResult'));
          } else if (act === 'del') {
            confirmDialog('删除记录', '确定删除「' + q.title + '」及其报价结果吗？此操作不可撤销。', '确认删除', function () {
              var res = Storage.remove(id);
              if (res.ok) { renderHistory(); refreshCounts(); toast('记录已删除', 'success'); }
              else toast(res.error || '删除失败', 'error');
            });
          }
        };
      });
    });
  }

  /* ---------------- 费率设置 ---------------- */
  function configInputs() {
    $('#cfgRoleRates').innerHTML = Object.keys(cfg.roleRates).map(function (k) {
      return '<div class="config-item"><label>' + esc(cfg.roleLabels[k] || k) + '（元/人天）</label>' +
        '<input type="number" min="0" step="50" data-cfg="roleRates.' + k + '" value="' + esc(cfg.roleRates[k]) + '"></div>';
    }).join('');

    $('#cfgComplexity').innerHTML = cfg.complexityLevels.map(function (c, i) {
      return '<div class="config-item"><label>' + esc(c.label) + '（' + esc(c.value) + '）</label>' +
        '<input type="number" min="0" max="5" step="0.1" data-cfg="complexityLevels.' + i + '.coefficient" value="' + esc(c.coefficient) + '"></div>';
    }).join('');

    $('#cfgAllocation').innerHTML = cfg.allocation.map(function (a, i) {
      return '<div class="config-item"><label>' + esc(a.phase) + ' · ' + esc(cfg.roleLabels[a.role]) + '</label>' +
        '<input type="number" min="0" max="1" step="0.01" data-cfg="allocation.' + i + '.weight" value="' + esc(a.weight) + '"></div>';
    }).join('');

    $('#cfgRegion').innerHTML = Object.keys(cfg.regionLabels).map(function (k) {
      return '<div class="config-item"><label>' + esc(cfg.regionLabels[k]) + '（系数）</label>' +
        '<input type="number" min="0" max="5" step="0.05" data-cfg="regionFactor.' + k + '" value="' + esc(cfg.regionFactor[k]) + '"></div>';
    }).join('');

    var infraItems = Object.keys(cfg.infraLabels).map(function (k) {
      return '<div class="config-item"><label>' + esc(cfg.infraLabels[k]) + '（元/月）</label>' +
        '<input type="number" min="0" step="100" data-cfg="infraBaseline.' + k + '" value="' + esc(cfg.infraBaseline[k]) + '"></div>';
    });
    infraItems.push('<div class="config-item"><label>风险缓冲下限（%）</label><input type="number" min="0" max="100" step="1" data-cfg="contingencyLowPct" value="' + esc(cfg.contingencyLow * 100) + '"></div>');
    infraItems.push('<div class="config-item"><label>风险缓冲上限（%）</label><input type="number" min="0" max="100" step="1" data-cfg="contingencyHighPct" value="' + esc(cfg.contingencyHigh * 100) + '"></div>');
    $('#cfgInfra').innerHTML = infraItems.join('');

    $('#cfgBaseline').innerHTML = Object.keys(cfg.featureBaseline).map(function (k) {
      return '<div class="config-item"><label>' + esc(cfg.featureBaseline[k].label) + '</label>' +
        '<input type="number" min="0" step="0.5" data-cfg="featureBaseline.' + k + '.days" value="' + esc(cfg.featureBaseline[k].days) + '"></div>';
    }).join('');

    updateAllocCheck();
    $$('[data-cfg]').forEach(function (inp) { inp.oninput = updateAllocCheck; });
  }

  function updateAllocCheck() {
    var sum = 0;
    $$('#cfgAllocation input').forEach(function (i) { sum += Number(i.value) || 0; });
    var el = $('#allocCheck');
    var ok = Math.abs(sum - 1) < 0.0001;
    el.className = 'alloc-check ' + (ok ? 'ok' : 'bad');
    el.textContent = '当前合计 ' + (Math.round(sum * 1000) / 1000) + (ok ? '（正确，合计为 1.00）' : '（需调整为 1.00，否则工时不守恒）');
    return ok;
  }

  function saveConfigFromUI() {
    if (!updateAllocCheck()) { toast('阶段分配合计必须为 1.00', 'error'); return; }
    var next = JSON.parse(JSON.stringify(cfg));
    $$('[data-cfg]').forEach(function (inp) {
      var path = inp.getAttribute('data-cfg');
      var val = Number(inp.value);
      if (!isFinite(val)) return;
      if (path === 'contingencyLowPct') { next.contingencyLow = val / 100; return; }
      if (path === 'contingencyHighPct') { next.contingencyHigh = val / 100; return; }
      var parts = path.split('.');
      var obj = next;
      for (var i = 0; i < parts.length - 1; i++) {
        var p = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
        obj = obj[p];
      }
      obj[parts[parts.length - 1]] = val;
    });
    if (next.contingencyLow > next.contingencyHigh) { toast('缓冲下限不能大于上限', 'error'); return; }
    var res = Storage.saveConfig(next);
    if (!res.ok) { toast(res.error || '保存失败', 'error'); return; }
    cfg = Storage.getConfig();
    toast('费率设置已保存，后续估算立即生效', 'success');
  }

  /* ---------------- 备份 ---------------- */
  function refreshBackup() {
    var s = Storage.stats();
    $('#backupStats').innerHTML =
      '<div class="stat-box"><div class="k">已保存项目数</div><div class="v">' + s.count + ' 条</div></div>' +
      '<div class="stat-box"><div class="k">占用本地空间</div><div class="v">' + (s.bytes / 1024).toFixed(1) + ' KB</div></div>' +
      '<div class="stat-box"><div class="k">存储位置</div><div class="v" style="font-size:14px">localStorage</div></div>';
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(name) {
    currentView = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === name); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    if (name === 'history') renderHistory();
    if (name === 'config') { cfg = Storage.getConfig(); configInputs(); }
    if (name === 'backup') refreshBackup();
    refreshCounts();
  }
  function refreshCounts() {
    var n = Storage.list().length;
    $('#topRecordCount').textContent = n + ' 条记录';
    $('#footerVersion').textContent = '规则引擎 v1.0 · 配置 v' + cfg.version;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $$('.tab').forEach(function (t) {
      t.onclick = function () { switchView(t.getAttribute('data-view')); };
    });
    $('#f-desc').oninput = updateDescCount;
    $('#btnAddFeature').onclick = function () { addFeatureRow(); };
    $('#btnEstimate').onclick = doEstimate;
    $('#btnClearForm').onclick = function () { clearForm(); toast('表单已清空'); };
    $('#btnCloseModal').onclick = closeModal;
    $('#modalMask').onclick = function (e) { if (e.target === this) closeModal(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    $('#historySearch').oninput = renderHistory;
    $('#btnExportFromHistory').onclick = function () {
      var n = Storage.exportToFile(); toast('已导出 ' + n + ' 条记录', 'success');
    };
    $('#btnSaveConfig').onclick = saveConfigFromUI;
    $('#btnResetConfig').onclick = function () {
      confirmDialog('恢复默认费率', '将清除你自定义的费率与系数，恢复系统默认值。已保存的历史报价不受影响。', '恢复默认', function () {
        Storage.resetConfig();
        cfg = Storage.getConfig();
        configInputs();
        toast('已恢复默认费率', 'success');
      });
    };
    $('#btnExport').onclick = function () {
      var n = Storage.exportToFile();
      toast('已导出 ' + n + ' 条记录（含费率配置）', 'success');
      refreshBackup();
    };
    $('#fileImport').onchange = function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      $('#importFileName').textContent = '已选择：' + file.name;
      Storage.importFromFile(file, $('#importMode').value).then(function (res) {
        cfg = Storage.getConfig();
        refreshBackup(); refreshCounts();
        if (currentView === 'history') renderHistory();
        toast('导入成功：新增/更新 ' + res.count + ' 条，现有共 ' + res.total + ' 条', 'success');
        e.target.value = '';
      }).catch(function (err) {
        toast('导入失败：' + err.message, 'error');
        e.target.value = '';
      });
    };
    $('#btnClearAll').onclick = function () {
      confirmDialog('清空全部记录', '将删除本机保存的全部项目需求与报价，且不可恢复。强烈建议先导出备份。', '确认清空', function () {
        var res = Storage.clearAll();
        if (res.ok) {
          lastRecord = null;
          $('#resultArea').innerHTML = '';
          refreshBackup(); refreshCounts();
          if (currentView === 'history') renderHistory();
          toast('已清空全部记录', 'success');
        } else toast(res.error || '清空失败', 'error');
      });
    };
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    initSelects();
    bind();
    clearForm();
    // 复杂度下拉依赖配置，clearForm 后按当前配置刷新一次
    $$('.feature-row .f-complexity').forEach(function (sel) {
      sel.innerHTML = complexityOptions(sel.value || 'normal');
    });
    refreshCounts();
    var items = Storage.list();
    if (items.length) {
      lastRecord = items[0];
      $('#historySummary').textContent = '共 ' + items.length + ' 条';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
