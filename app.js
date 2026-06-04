/* ================================================================
   用户反馈分析工具 — App Logic
   ================================================================
   使用方法：将下面的 DEEPSEEK_API_KEY 替换为你的真实 Key 即可运行。
   ================================================================ */

// ──────────────────────────────────────────────
// 🔑 API 配置 — 请在此处填入你的 API Key
// ──────────────────────────────────────────────
const DEEPSEEK_API_KEY = window.DEEPSEEK_API_KEY || '';

const API_ENDPOINT = '/api/deepseek';
const MODEL_NAME    = 'deepseek-v4-pro';

const SYSTEM_PROMPT = [
  '你是一个用户反馈分析专家。请分析以下用户反馈，',
  '返回纯JSON格式，包含三个字段：',
  'sentiment（正面/负面/中性）、',
  'category（功能需求/bug反馈/体验问题/性能问题/其他）、',
  'insight（一句话总结用户核心诉求）。',
  '不要返回JSON之外的任何内容。',
].join('');

// ──────────────────────────────────────────────
// DOM 引用
// ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const feedbackInput    = $('#feedbackInput');
const analyzeBtn       = $('#analyzeBtn');
const countHint        = $('#countHint');
const progressSection  = $('#progressSection');
const progressLabel    = $('#progressLabel');
const progressPercent  = $('#progressPercent');
const progressBar      = $('#progressBar');
const resultsContainer = $('#resultsContainer');
const emptyState       = $('#emptyState');
const resultHint       = $('#resultHint');
const errorBanner      = $('#errorBanner');
const errorText        = $('#errorText');
const dismissError     = $('#dismissError');

// 图表区
const chartsPlaceholder = $('#chartsPlaceholder');
const chartsContent     = $('#chartsContent');
const keywordsList      = $('#keywordsList');
const exportBtn         = $('#exportBtn');

// CSV 上传
const uploadZone     = $('#uploadZone');
const fileInput      = $('#fileInput');
const uploadIcon     = $('#uploadIcon');
const uploadLabel    = $('#uploadLabel');
const uploadFileName = $('#uploadFileName');
const uploadStatus   = $('#uploadStatus');
const uploadError    = $('#uploadError');

// 报告弹窗
const reportModal     = $('#reportModal');
const modalBody       = $('#modalBody');
const modalClose      = $('#modalClose');
const copyReportBtn   = $('#copyReportBtn');
const downloadReportBtn = $('#downloadReportBtn');

// ──────────────────────────────────────────────
// 状态
// ──────────────────────────────────────────────
let feedbacks    = [];   // 当前待分析的反馈列表
let results      = [];   // 已返回的分析结果
let isAnalyzing  = false;
let abortCtrl    = null; // AbortController
let sentimentChart = null; // Chart.js 实例
let categoryChart  = null;
let reportMarkdown = ''; // 最新生成的报告原始 Markdown

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

/** 解析 textarea 中的反馈（换行分隔，去除空行） */
function parseFeedbacks() {
  const raw = feedbackInput.value.trim();
  if (!raw) return [];
  return raw.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/** 转义 HTML 特殊字符 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/** 更新输入计数 */
function updateCount() {
  feedbacks = parseFeedbacks();
  countHint.textContent = `已输入 ${feedbacks.length} 条`;
}

/** 格式化日期时间为 YYYY-MM-DD HH:mm */
function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 格式化日期时间为文件名格式 YYYY-MM-DD_HH-mm */
function formatDateForFilename(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

// ──────────────────────────────────────────────
// 错误提示
// ──────────────────────────────────────────────

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.style.display = 'flex';
}

function hideError() {
  errorBanner.style.display = 'none';
}

dismissError.addEventListener('click', hideError);

// ──────────────────────────────────────────────
// 进度条
// ──────────────────────────────────────────────

function showProgress() {
  progressSection.style.display = 'block';
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressLabel.textContent = `分析中… ${current} / ${total}`;
  progressPercent.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
}

function hideProgress() {
  progressSection.style.display = 'none';
}

// ──────────────────────────────────────────────
// CSV 上传 — 解析与处理
// ──────────────────────────────────────────────

/**
 * 解析一行 CSV，正确处理引号包裹的字段（含逗号、换行）
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * 检测 CSV 表头中匹配反馈内容的列索引
 * 策略：
 *   1. 收集表头列名包含关键词的候选列
 *   2. 如果有多列候选，取数据行中平均文本长度最长的列
 *   3. 如果没有匹配到关键词，默认取第一列
 */
const HEADER_KEYWORDS = ['反馈', '内容', '评论', '评价', '意见', '建议', '留言', '描述', '问题', '投诉'];
const HEADER_EXCLUDE  = ['id', '编号', '序号', '日期', '时间', '来源', '渠道', '分类', '状态', '处理人'];

function detectFeedbackColumn(headerLine, dataLines) {
  const headers = parseCSVLine(headerLine);
  const candidateIndices = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    // 排除明显不是反馈内容的列
    if (HEADER_EXCLUDE.some(kw => h.includes(kw))) continue;
    // 匹配关键词
    if (HEADER_KEYWORDS.some(kw => h.includes(kw))) {
      candidateIndices.push(i);
    }
  }

  // 如果没有匹配到关键词，检查是否所有列名都不像反馈内容
  if (candidateIndices.length === 0) {
    // 如果没有明显表头，默认取第一列
    return 0;
  }

  if (candidateIndices.length === 1) {
    return candidateIndices[0];
  }

  // 多列候选：计算每列数据行的平均文本长度，选最长的
  const avgLengths = candidateIndices.map(idx => {
    let totalLen = 0;
    let count = 0;
    for (const line of dataLines) {
      const parts = parseCSVLine(line);
      if (parts[idx] && parts[idx].trim()) {
        totalLen += parts[idx].trim().length;
        count++;
      }
    }
    return { idx, avg: count > 0 ? totalLen / count : 0 };
  });

  avgLengths.sort((a, b) => b.avg - a.avg);
  return avgLengths[0].idx;
}

/**
 * 处理 CSV 文件内容
 * @param {string} text   - CSV 原始文本
 * @param {string} fileName - 文件名（用于展示）
 */
function processCSVContent(text, fileName) {
  // 按换行分割，过滤全空行
  const allLines = text.split(/\r?\n/).filter(line => line.trim() !== '');

  if (allLines.length === 0) {
    showUploadError('CSV 文件为空。');
    return;
  }

  // 取第一行作为可能的表头
  const firstLine = allLines[0];
  const firstParts = parseCSVLine(firstLine);

  // 判断第一行是否更像表头（包含关键词，或者与第二行内容风格不同）
  const hasHeaderKeyword = HEADER_KEYWORDS.some(kw =>
    firstParts.some(p => p.toLowerCase().includes(kw))
  );

  let colIdx;
  let dataStartIdx;

  if (hasHeaderKeyword || allLines.length > 1 && looksLikeHeader(firstParts, allLines[1])) {
    // 第一行是表头
    colIdx = detectFeedbackColumn(firstLine, allLines.slice(1));
    dataStartIdx = 1;
  } else {
    // 无表头，取第一列
    colIdx = 0;
    dataStartIdx = 0;
  }

  // 提取反馈内容
  const feedbackLines = [];
  for (let i = dataStartIdx; i < allLines.length; i++) {
    const parts = parseCSVLine(allLines[i]);
    const val = parts[colIdx] ? parts[colIdx].trim() : '';
    if (val) {
      feedbackLines.push(val);
    }
  }

  if (feedbackLines.length === 0) {
    showUploadError('未能从 CSV 文件中提取到有效反馈内容。请检查文件格式。');
    return;
  }

  // 成功：填入 textarea，更新上传区域 UI
  feedbackInput.value = feedbackLines.join('\n');
  updateCount();
  hideUploadError();

  // 更新上传区域为成功状态
  uploadZone.classList.add('has-file');
  uploadIcon.textContent = '📁';
  uploadLabel.style.display = 'none';
  uploadFileName.style.display = 'inline';
  uploadFileName.textContent = `✅ ${fileName}（${feedbackLines.length} 条）`;
  uploadStatus.style.display = 'inline';
  uploadStatus.className = 'upload-status success';
  uploadStatus.textContent = '✓';

  // 自动触发分析
  runAnalysis();
}

/**
 * 试探性判断第一行是否像表头
 * 策略：如果第二行的第一列明显更像用户反馈文本（更长、包含中文），则第一行可能是表头
 */
function looksLikeHeader(headerParts, secondLine) {
  const secondParts = parseCSVLine(secondLine);
  // 如果第一行的列数明显不同于第二行，可能是数据格式问题，保守认为无表头
  if (headerParts.length > 1 && headerParts.length !== secondParts.length) {
    return true; // 列数不同，第一行更像是独立表头
  }
  // 如果第一行第一列很短、第二行第一列较长，大概率第一行是表头
  const h0 = (headerParts[0] || '').trim();
  const d0 = (secondParts[0] || '').trim();
  if (h0.length <= 10 && d0.length > 15 && /[一-龥]/.test(d0)) {
    return true;
  }
  return false;
}

/** 显示上传区域内的错误 */
function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.style.display = 'block';
  // 重置上传区域状态
  resetUploadUI();
}

/** 隐藏上传区域内的错误 */
function hideUploadError() {
  uploadError.style.display = 'none';
}

/** 重置上传区域 UI */
function resetUploadUI() {
  uploadZone.classList.remove('has-file');
  uploadIcon.textContent = '📁';
  uploadLabel.style.display = 'inline';
  uploadFileName.style.display = 'none';
  uploadFileName.textContent = '';
  uploadStatus.style.display = 'none';
  uploadStatus.className = 'upload-status';
  uploadStatus.textContent = '';
  fileInput.value = '';
}

// ──────────────────────────────────────────────
// CSV 上传 — 事件绑定
// ──────────────────────────────────────────────

// 点击上传区域 → 打开文件选择器
uploadZone.addEventListener('click', (e) => {
  // 如果正在分析中，阻止上传
  if (isAnalyzing) return;
  // 点击的是隐藏的 file input 时不做额外处理（浏览器会正常触发）
});

// 文件选择
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  handleCSVFile(file);
});

// 拖拽事件
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (isAnalyzing) return;
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  if (isAnalyzing) return;

  const file = e.dataTransfer.files[0];
  if (!file) return;
  handleCSVFile(file);
});

/**
 * 处理 CSV 文件
 */
function handleCSVFile(file) {
  hideUploadError();

  // 校验文件类型
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showUploadError('仅支持 .csv 格式的文件，请重新选择。');
    return;
  }

  // 校验文件大小（最大 10MB）
  if (file.size > 10 * 1024 * 1024) {
    showUploadError('文件过大（超过 10MB），请拆分后重试。');
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const text = e.target.result;
      if (!text || text.trim() === '') {
        showUploadError('CSV 文件内容为空。');
        return;
      }
      processCSVContent(text, file.name);
    } catch (err) {
      console.error('[CSV] 解析异常:', err);
      showUploadError('CSV 文件解析失败：' + (err.message || '未知错误'));
    }
  };

  reader.onerror = () => {
    showUploadError('文件读取失败，请重试。');
  };

  reader.readAsText(file, 'UTF-8');
}

// ──────────────────────────────────────────────
// DeepSeek API 调用
// ──────────────────────────────────────────────

/**
 * 延迟工具（毫秒）
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 分析单条反馈（带重试）
 * @param {string} feedback - 单条反馈文本
 * @param {number} retries  - 最大重试次数
 * @returns {Promise<object>} { feedback, sentiment, category, insight }
 */
async function analyzeOne(feedback, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: feedback },
        ],
        temperature: 0.3,
        max_tokens: 200,
        // 注意：不使用 response_format，DeepSeek v1 对此参数支持不稳定，
        // 容易导致 content 为空。改为仅靠 system prompt 约束 JSON 输出。
      }),
      signal: abortCtrl.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}${body ? ': ' + body : ''}`);
    }

    const data = await resp.json();
    console.log(`[DeepSeek] 第 ${attempt} 次尝试，完整响应:`, JSON.stringify(data, null, 2));

    const content = data.choices?.[0]?.message?.content;

    if (!content || content.trim() === '') {
      console.warn(`[DeepSeek] content 为空（attempt ${attempt}/${retries}），准备重试...`);
      if (attempt < retries) {
        await delay(800);  // 等 800ms 再重试
        continue;
      }
      throw new Error('API 返回为空（已重试 ' + retries + ' 次）');
    }

    // 解析 JSON（兼容 markdown 代码块包裹的情况）
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const cleaned = content.replace(/```json\s*|```/g, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('[DeepSeek] JSON 解析失败，原始内容:', content);
        throw new Error('API 返回格式异常，无法解析 JSON');
      }
    }

    return {
      feedback,
      sentiment: parsed.sentiment ?? '中性',
      category:  parsed.category  ?? '其他',
      insight:   parsed.insight   ?? '暂无',
    };
  }
}

// ──────────────────────────────────────────────
// 渲染结果卡片
// ──────────────────────────────────────────────

function renderResultCard(result) {
  const card = document.createElement('div');
  card.className = 'result-card';

  // 情绪 → class 映射
  const sentClassMap = {
    '正面': 'positive',
    '负面': 'negative',
    '中性': 'neutral',
  };
  const sentClass = sentClassMap[result.sentiment] || 'neutral';

  card.innerHTML = [
    `<div class="card-feedback">${escapeHtml(result.feedback)}</div>`,
    `<div class="card-tags">`,
      `<span class="tag-sentiment tag-${sentClass}">${escapeHtml(result.sentiment)}</span>`,
      `<span class="tag-category">${escapeHtml(result.category)}</span>`,
    `</div>`,
    `<div class="card-insight">${escapeHtml(result.insight)}</div>`,
  ].join('');

  resultsContainer.appendChild(card);
  resultsContainer.scrollTop = resultsContainer.scrollHeight;
}

/** 渲染错误卡片（API 调用失败时） */
function renderErrorCard(feedback, errMsg) {
  const card = document.createElement('div');
  card.className = 'result-card';

  card.innerHTML = [
    `<div class="card-feedback">${escapeHtml(feedback)}</div>`,
    `<div class="card-tags">`,
      `<span class="tag-sentiment tag-neutral">错误</span>`,
      `<span class="tag-category" style="background:#fdf2f2;color:#e03e3e;">请求失败</span>`,
    `</div>`,
    `<div class="card-insight" style="color:#e03e3e;">${escapeHtml(errMsg)}</div>`,
  ].join('');

  resultsContainer.appendChild(card);
  resultsContainer.scrollTop = resultsContainer.scrollHeight;
}

// ──────────────────────────────────────────────
// 可视化图表
// ──────────────────────────────────────────────

/** 中文停用词（精简版） */
const STOP_WORDS = new Set([
  '的','了','在','是','我','有','和','就','不','人','都','一','一个',
  '上','也','很','到','说','要','去','你','会','着','没有','看','好',
  '自己','这','他','她','它','们','那','些','什么','怎么','如何',
  '可以','能够','应该','需要','希望','认为','觉得','知道','这个',
  '那个','还是','但是','因为','所以','如果','虽然','而且','或者',
  '以及','进行','使用','通过','对于','关于','已经','比较','非常',
  '更加','特别','一直','目前','现在','之前','之后','以后','时候',
  '其中','其他','以上','以下','等等','各种','每个','所有','任何',
  '不能','不会','可能','能否','是否','为什么','怎么样','怎么办',
  '让','把','被','从','对','与','为','以','请','吧','吗','呢','啊',
  '哦','嗯','嘛','哈','呀','哇','哎','唉','嘿','喂',
]);

/**
 * 从 insight 文本中提取关键词
 * 策略：按标点/空格切分 → 过滤停用词和短词 → 统计频率
 */
function extractKeywords(insights) {
  const wordFreq = {};

  for (const text of insights) {
    // 按中文标点、空格、英文标点切分
    const segments = text.split(/[，。！？；：、\s,\.!\?;:\-\(\)（）""]+/);
    for (const seg of segments) {
      const word = seg.trim();
      // 过滤：长度 >= 2、非纯数字、非停用词
      if (word.length >= 2 && !/^\d+$/.test(word) && !STOP_WORDS.has(word)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }
  }

  // 按频次降序，取 top 10
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

/**
 * 渲染关键词标签
 */
function renderKeywords(insights) {
  const keywords = extractKeywords(insights);
  keywordsList.innerHTML = '';

  if (keywords.length === 0) {
    keywordsList.innerHTML = '<span style="font-size:12px;color:var(--color-text-muted);">暂无关键词</span>';
    return;
  }

  // 最大频次，用于字号微调
  const maxFreq = keywords[0][1];

  for (const [word, count] of keywords) {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    // 频次越高字号略大（12px ~ 15px）
    const size = 12 + Math.round((count / maxFreq) * 3);
    tag.style.fontSize = size + 'px';
    tag.innerHTML = `${escapeHtml(word)}<span class="kw-count">${count}</span>`;
    keywordsList.appendChild(tag);
  }
}

/**
 * 销毁旧图表实例
 */
function destroyCharts() {
  if (sentimentChart) { sentimentChart.destroy(); sentimentChart = null; }
  if (categoryChart)  { categoryChart.destroy();  categoryChart  = null; }
}

/**
 * 渲染情绪分布饼图
 */
function renderSentimentChart() {
  const counts = { '正面': 0, '负面': 0, '中性': 0 };
  for (const r of results) {
    if (counts.hasOwnProperty(r.sentiment)) counts[r.sentiment]++;
  }

  const ctx = document.getElementById('sentimentChart').getContext('2d');

  sentimentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['正面', '负面', '中性'],
      datasets: [{
        data: [counts['正面'], counts['负面'], counts['中性']],
        backgroundColor: ['#0f7b4e', '#e03e3e', '#9b9b9b'],
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverBorderColor: '#ffffff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 8,
            font: { size: 11, family: 'inherit' },
            color: '#6b6b6b',
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((ctx.raw / total) * 100) : 0;
              return ` ${ctx.label}: ${ctx.raw} 条 (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/**
 * 渲染问题类型柱状图
 */
function renderCategoryChart() {
  const catCounts = {};
  for (const r of results) {
    const c = r.category || '其他';
    catCounts[c] = (catCounts[c] || 0) + 1;
  }

  // 按固定顺序排列
  const order = ['功能需求', 'bug反馈', '体验问题', '性能问题', '其他'];
  const labels = order.filter(k => catCounts.hasOwnProperty(k));
  const data   = labels.map(k => catCounts[k]);

  const ctx = document.getElementById('categoryChart').getContext('2d');

  categoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '反馈数量',
        data,
        backgroundColor: [
          '#2383e2', '#0f7b4e', '#d97706', '#e03e3e', '#9b9b9b',
        ],
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.raw} 条`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, family: 'inherit' }, color: '#6b6b6b' },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f0f0f0' },
          ticks: {
            stepSize: 1,
            font: { size: 11, family: 'inherit' },
            color: '#9b9b9b',
            callback: (v) => Number.isInteger(v) ? v : '',
          },
        },
      },
    },
  });
}

/**
 * 渲染所有图表（分析完成后调用）
 */
function renderAllCharts() {
  destroyCharts();

  // 只统计成功的分析结果
  const successResults = results.filter(r => r.sentiment !== '错误');
  if (successResults.length === 0) return;

  chartsPlaceholder.style.display = 'none';
  chartsContent.style.display = 'flex';

  renderSentimentChart();
  renderCategoryChart();

  const insights = successResults.map(r => r.insight).filter(Boolean);
  renderKeywords(insights);
}

/** 隐藏图表区，恢复占位状态 */
function resetCharts() {
  destroyCharts();
  chartsPlaceholder.style.display = 'flex';
  chartsContent.style.display = 'none';
  keywordsList.innerHTML = '';
}

// ──────────────────────────────────────────────
// 报告导出 — 生成 Markdown
// ──────────────────────────────────────────────

/**
 * 生成 Markdown 格式的报告内容
 */
function generateReportMarkdown() {
  const now = new Date();
  const successResults = results.filter(r => r.sentiment !== '错误');
  const total = successResults.length;

  // --- 情绪统计 ---
  const sentimentCounts = { '正面': 0, '负面': 0, '中性': 0 };
  for (const r of successResults) {
    if (sentimentCounts.hasOwnProperty(r.sentiment)) sentimentCounts[r.sentiment]++;
  }

  // --- 关键词 ---
  const insights = successResults.map(r => r.insight).filter(Boolean);
  const keywords = extractKeywords(insights).slice(0, 5);

  // --- 问题类型分布 ---
  const catCounts = {};
  for (const r of successResults) {
    const c = r.category || '其他';
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  // --- 代表性负面反馈（最多 5 条） ---
  const negativeResults = successResults.filter(r => r.sentiment === '负面').slice(0, 5);

  // --- 代表性正面反馈（最多 3 条） ---
  const positiveResults = successResults.filter(r => r.sentiment === '正面').slice(0, 3);

  // === 拼装 Markdown ===
  const lines = [];

  lines.push('# 用户反馈分析报告');
  lines.push('');
  lines.push(`> 生成时间：${formatDateTime(now)}  |  分析反馈总数：**${total}** 条`);
  lines.push('');

  // 分析概览
  lines.push('## 📊 分析概览');
  lines.push('');
  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  lines.push(`| 情绪 | 数量 | 占比 |`);
  lines.push(`|------|------|------|`);
  lines.push(`| 😊 正面 | **${sentimentCounts['正面']}** | ${pct(sentimentCounts['正面'])}% |`);
  lines.push(`| 😔 负面 | **${sentimentCounts['负面']}** | ${pct(sentimentCounts['负面'])}% |`);
  lines.push(`| 😐 中性 | **${sentimentCounts['中性']}** | ${pct(sentimentCounts['中性'])}% |`);
  lines.push('');

  // 高频关键词
  lines.push('## 🔑 高频关键词 TOP 5');
  lines.push('');
  if (keywords.length > 0) {
    for (const [word, count] of keywords) {
      lines.push(`- **${word}** — ${count} 次`);
    }
  } else {
    lines.push('> 暂无关键词数据');
  }
  lines.push('');

  // 问题类型分布
  lines.push('## 🏷️ 问题类型分布');
  lines.push('');
  if (sortedCats.length > 0) {
    for (const [cat, count] of sortedCats) {
      const bar = '█'.repeat(Math.max(1, Math.round(count / Math.max(...sortedCats.map(c => c[1])) * 20)));
      lines.push(`- **${cat}**：${count} 条 ${bar}`);
    }
  } else {
    lines.push('> 暂无分类数据');
  }
  lines.push('');

  // 代表性负面反馈
  lines.push('## 🔴 代表性负面反馈');
  lines.push('');
  if (negativeResults.length > 0) {
    for (let i = 0; i < negativeResults.length; i++) {
      const r = negativeResults[i];
      lines.push(`### ${i + 1}. 用户反馈`);
      lines.push(`> ${r.feedback}`);
      lines.push('');
      lines.push(`💡 **核心诉求**：${r.insight}`);
      lines.push('');
    }
  } else {
    lines.push('> 暂无负面反馈');
    lines.push('');
  }

  // 代表性正面反馈
  lines.push('## 🟢 代表性正面反馈');
  lines.push('');
  if (positiveResults.length > 0) {
    for (let i = 0; i < positiveResults.length; i++) {
      const r = positiveResults[i];
      lines.push(`### ${i + 1}. 用户反馈`);
      lines.push(`> ${r.feedback}`);
      lines.push('');
      lines.push(`💡 **核心评价**：${r.insight}`);
      lines.push('');
    }
  } else {
    lines.push('> 暂无正面反馈');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 将 Markdown 文本转为展示用 HTML（回退方案，当 marked 不可用时使用）
 */
function simpleMarkdownToHTML(md) {
  const lines = md.split('\n');
  const html = [];
  let inTable = false;
  let tableRows = [];

  for (const line of lines) {
    // 表格
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) { inTable = true; tableRows = []; }
      if (!line.includes('---')) {
        const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim());
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      inTable = false;
      if (tableRows.length > 0) {
        html.push('<table class="report-table">');
        const header = tableRows[0];
        html.push('<thead><tr>' + header.map(h => `<th>${h}</th>`).join('') + '</tr></thead>');
        html.push('<tbody>');
        for (let i = 1; i < tableRows.length; i++) {
          html.push('<tr>' + tableRows[i].map(c => `<td>${c}</td>`).join('') + '</tr>');
        }
        html.push('</tbody></table>');
      }
      tableRows = [];
    }

    if (/^### /.test(line)) {
      html.push(`<h3>${line.replace(/^### /, '')}</h3>`);
    } else if (/^## /.test(line)) {
      html.push(`<h2>${line.replace(/^## /, '')}</h2>`);
    } else if (/^# /.test(line)) {
      html.push(`<h1>${line.replace(/^# /, '')}</h1>`);
    } else if (/^> /.test(line)) {
      html.push(`<blockquote>${line.replace(/^> /, '')}</blockquote>`);
    } else if (/^- /.test(line)) {
      html.push(`<li>${line.replace(/^- /, '')}</li>`);
    } else if (line.trim() === '') {
      html.push('<br>');
    } else {
      html.push(`<p>${line}</p>`);
    }
  }
  return html.join('\n');
}

// ──────────────────────────────────────────────
// 报告导出 — 模态弹窗
// ──────────────────────────────────────────────

/**
 * 打开报告预览弹窗
 */
function openReportModal() {
  if (results.length === 0) return;

  // 生成 Markdown 报告
  reportMarkdown = generateReportMarkdown();

  // 使用 marked.js 渲染，如果不可用则回退到简单渲染
  let rendered;
  if (typeof marked !== 'undefined' && marked.parse) {
    rendered = marked.parse(reportMarkdown);
  } else {
    console.warn('[Report] marked.js 未加载，使用简单渲染');
    rendered = simpleMarkdownToHTML(reportMarkdown);
  }

  modalBody.innerHTML = rendered;
  reportModal.style.display = 'flex';
  // 阻止 body 滚动
  document.body.style.overflow = 'hidden';
}

/**
 * 关闭报告预览弹窗
 */
function closeReportModal() {
  reportModal.style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * 复制报告到剪贴板
 */
async function copyReport() {
  if (!reportMarkdown) return;
  try {
    await navigator.clipboard.writeText(reportMarkdown);
    // 按钮临时反馈
    const origText = copyReportBtn.innerHTML;
    copyReportBtn.innerHTML = '✅ 已复制';
    copyReportBtn.style.color = '#0f7b4e';
    copyReportBtn.style.borderColor = '#0f7b4e';
    setTimeout(() => {
      copyReportBtn.innerHTML = origText;
      copyReportBtn.style.color = '';
      copyReportBtn.style.borderColor = '';
    }, 2000);
  } catch (err) {
    console.error('[Report] 复制失败:', err);
    alert('复制失败，请手动复制。');
  }
}

/**
 * 下载报告为 .md 文件
 */
function downloadReport() {
  if (!reportMarkdown) return;
  const filename = `反馈分析报告_${formatDateForFilename(new Date())}.md`;
  const blob = new Blob(['﻿' + reportMarkdown], { type: 'text/markdown;charset=UTF-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────
// 报告导出 — 事件绑定
// ──────────────────────────────────────────────

exportBtn.addEventListener('click', () => {
  if (exportBtn.disabled) return;
  openReportModal();
});

modalClose.addEventListener('click', closeReportModal);

// 点击遮罩层关闭
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) closeReportModal();
});

// ESC 关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && reportModal.style.display === 'flex') {
    closeReportModal();
  }
});

copyReportBtn.addEventListener('click', copyReport);
downloadReportBtn.addEventListener('click', downloadReport);

// ──────────────────────────────────────────────
// 核心分析流程（提取为独立函数，供按钮点击和 CSV 上传复用）
// ──────────────────────────────────────────────

async function runAnalysis() {
  // --- 校验 ---
  if (isAnalyzing) return;

  feedbacks = parseFeedbacks();
  if (feedbacks.length === 0) {
    showError('请先在输入框中粘贴反馈内容（每行一条）。');
    return;
  }

  if (DEEPSEEK_API_KEY === 'YOUR_DEEPSEEK_API_KEY_HERE') {
    showError('请先在 app.js 中将 DEEPSEEK_API_KEY 替换为你的真实 API Key。');
    return;
  }

  // --- 重置状态 ---
  hideError();
  results = [];
  reportMarkdown = '';
  isAnalyzing = true;
  abortCtrl = new AbortController();

  // --- 清空旧结果 ---
  resultsContainer.querySelectorAll('.result-card').forEach(c => c.remove());
  emptyState.style.display = 'none';
  resultHint.textContent = '';

  // --- 重置图表 ---
  resetCharts();

  // --- 导出按钮变灰 ---
  exportBtn.disabled = true;

  // --- 按钮 loading ---
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="spinner"></span>分析中…';

  // --- 进度条 ---
  showProgress();
  updateProgress(0, feedbacks.length);

  // --- 逐条分析（间隔 600ms，避免限流导致空响应） ---
  let completed = 0;

  for (const fb of feedbacks) {
    // 非首条请求前等待，降低限流概率
    if (completed > 0) {
      await delay(600);
    }
    try {
      const result = await analyzeOne(fb);
      results.push(result);
      renderResultCard(result);
    } catch (err) {
      // 用户主动取消
      if (err.name === 'AbortError') {
        break;
      }
      // API 调用失败
      results.push({ feedback: fb, sentiment: '错误', category: '—', insight: err.message });
      renderErrorCard(fb, err.message);
    }

    completed++;
    updateProgress(completed, feedbacks.length);
  }

  // --- 渲染图表 ---
  if (results.length > 0) {
    renderAllCharts();
  }

  // --- 结果出来 → 导出按钮可点击 ---
  if (results.length > 0) {
    exportBtn.disabled = false;
  }

  // --- 收尾 ---
  resultHint.textContent = `共 ${results.length} 条结果`;
  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = '开始分析';
  isAnalyzing = false;
  abortCtrl = null;

  if (results.length === 0) {
    emptyState.style.display = 'flex';
    resultHint.textContent = '';
  }

  hideProgress();
}

// ──────────────────────────────────────────────
// 事件绑定
// ──────────────────────────────────────────────

// 手动点击"开始分析"按钮
analyzeBtn.addEventListener('click', runAnalysis);

// 输入框实时计数
feedbackInput.addEventListener('input', updateCount);
