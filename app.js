/* ================================================================
   用户反馈分析工具 — App Logic
   ================================================================
   使用方法：将下面的 DEEPSEEK_API_KEY 替换为你的真实 Key 即可运行。
   ================================================================ */

// ──────────────────────────────────────────────
// 🔑 API 配置 — sk-7deff0d99db34d99a74bd3b73bb2ef3e
// ──────────────────────────────────────────────
const DEEPSEEK_API_KEY = 'YOUR_DEEPSEEK_API_KEY_HERE';

const API_ENDPOINT = 'https://deepseek-proxy.young-thunder-06b5.lyu343747.workers.dev';
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

// ──────────────────────────────────────────────
// 状态
// ──────────────────────────────────────────────
let feedbacks  = [];   // 当前待分析的反馈列表
let results    = [];   // 已返回的分析结果
let isAnalyzing = false;
let abortCtrl  = null; // AbortController

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
// DeepSeek API 调用
// ──────────────────────────────────────────────

/**
 * 分析单条反馈
 * @param {string} feedback - 单条反馈文本
 * @returns {Promise<object>} { feedback, sentiment, category, insight }
 */
async function analyzeOne(feedback) {
  const resp = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: feedback },
      ],
      temperature: 0.3,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    }),
    signal: abortCtrl.signal,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${body ? ': ' + body : ''}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回为空');
  }

  // 解析 JSON（兼容 markdown 代码块包裹的情况）
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/```json\n?|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  return {
    feedback,
    sentiment: parsed.sentiment ?? '中性',
    category:  parsed.category  ?? '其他',
    insight:   parsed.insight   ?? '暂无',
  };
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
  // 滚动到最新卡片
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
// 主流程：开始分析
// ──────────────────────────────────────────────

analyzeBtn.addEventListener('click', async () => {
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
  isAnalyzing = true;
  abortCtrl = new AbortController();

  // --- 清空旧结果 ---
  resultsContainer.querySelectorAll('.result-card').forEach(c => c.remove());
  emptyState.style.display = 'none';
  resultHint.textContent = '';

  // --- 按钮 loading ---
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="spinner"></span>分析中…';

  // --- 进度条 ---
  showProgress();
  updateProgress(0, feedbacks.length);

  // --- 逐条分析 ---
  let completed = 0;

  for (const fb of feedbacks) {
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

  // --- 收尾 ---
  resultHint.textContent = `共 ${results.length} 条结果`;
  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = '开始分析';
  isAnalyzing = false;
  abortCtrl = null;

  // 如果全部失败（0 条成功），恢复空状态
  const successCount = results.filter(r => r.sentiment !== '错误').length;
  if (results.length === 0) {
    emptyState.style.display = 'flex';
    resultHint.textContent = '';
  }

  hideProgress();
});

// ──────────────────────────────────────────────
// 输入框实时计数
// ──────────────────────────────────────────────
feedbackInput.addEventListener('input', updateCount);
