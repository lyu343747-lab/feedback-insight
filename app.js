  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>用户反馈分析工具</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>

    <!-- ====== Header ====== -->
    <header class="header">
      <div class="header-inner">
        <span class="logo-dot"></span>
        <h1>用户反馈分析工具</h1>
      </div>
    </header>

    <!-- ====== Main Layout : 三栏 ====== -->
    <main class="main">

      <!-- 左栏：输入区 -->
      <section class="panel panel-input">
        <div class="panel-header">
          <h2>📥 反馈输入</h2>
          <span class="hint" id="countHint">已输入 0 条</span>
        </div>

        <!-- CSV 文件上传区域 -->
        <div id="uploadZone" class="upload-zone">
          <div class="upload-zone-content">
            <span class="upload-icon" id="uploadIcon">📁</span>
            <div class="upload-text">
              <span id="uploadLabel">点击上传或拖拽 CSV 文件到此处</span>
              <span id="uploadFileName" class="upload-filename" style="display:none;"></span>
            </div>
            <span id="uploadStatus" class="upload-status" style="display:none;"></span>
          </div>
          <input type="file" id="uploadZoneFileInput" accept=".csv" class="upload-file-input">
        </div>

        <!-- 上传错误提示 -->
        <div id="uploadError" class="upload-error" style="display:none;"></div>

        <!-- 新增上传区域 -->
        <div class="upload-area" id="uploadArea">
          <p>点击上传或拖拽CSV文件到此处</p>
        </div>
        <input type="file" id="fileInput" accept=".csv" hidden>

        <textarea
          id="feedbackInput"
          class="input-area"
          placeholder="在此粘贴用户反馈，每条占一行&#10;&#10;例如：&#10;登录页面加载太慢了，每次都要等5秒以上&#10;客服回复很快，态度也很好，点赞&#10;希望能增加批量导出功能"
        ></textarea>

        <button id="analyzeBtn" class="btn-primary">
          开始分析
        </button>

        <!-- 进度条 -->
        <div id="progressSection" class="progress-section" style="display:none;">
          <div class="progress-info">
            <span id="progressLabel">分析中…</span>
            <span id="progressPercent">0%</span>
          </div>
          <div class="progress-track">
            <div id="progressBar" class="progress-fill"></div>
          </div>
        </div>

        <!-- 错误横幅 -->
        <div id="errorBanner" class="error-banner" style="display:none;">
          <span class="error-icon">⚠️</span>
          <span id="errorText"></span>
          <button id="dismissError" class="error-dismiss">&times;</button>
        </div>
      </section>

      <!-- 中栏：可视化图表区 -->
      <section class="panel panel-charts" id="panelCharts">
        <div class="panel-header">
          <h2>📊 分析概览</h2>
        </div>

        <!-- 初始占位 -->
        <div id="chartsPlaceholder" class="charts-placeholder">
          <div class="empty-icon">📈</div>
          <p>分析完成后此处展示图表</p>
        </div>

        <!-- 图表内容（分析完成后显示） -->
        <div id="chartsContent" class="charts-content" style="display:none;">

          <!-- 情绪分布饼图 -->
          <div class="chart-card">
            <div class="chart-card-title">情绪分布</div>
            <div class="chart-canvas-wrap">
              <canvas id="sentimentChart"></canvas>
            </div>
          </div>

          <!-- 问题类型柱状图 -->
          <div class="chart-card">
            <div class="chart-card-title">问题类型分布</div>
            <div class="chart-canvas-wrap">
              <canvas id="categoryChart"></canvas>
            </div>
          </div>

          <!-- 高频关键词 -->
          <div class="chart-card keywords-card">
            <div class="chart-card-title">高频关键词 <span class="chart-card-sub">TOP 10</span></div>
            <div id="keywordsList" class="keywords-list"></div>
          </div>

          <!-- 导出报告按钮 -->
          <button id="exportBtn" class="btn-export" disabled>
            📄 导出报告
          </button>

        </div>
      </section>

      <!-- 右栏：结果卡片列表 -->
      <section class="panel panel-results">
        <div class="panel-header">
          <h2>📋 分析结果</h2>
          <span class="hint" id="resultHint"></span>
        </div>

        <div id="resultsContainer" class="results-container">
          <!-- 空状态 -->
          <div id="emptyState" class="empty-state">
            <div class="empty-icon">📝</div>
            <p>在左侧输入反馈后点击"开始分析"</p>
            <p class="empty-sub">分析结果将以卡片形式展示在这里</p>
          </div>
        </div>
      </section>

    </main>

    <!-- ====== 报告预览模态弹窗 ====== -->
    <div id="reportModal" class="modal-overlay" style="display:none;">
      <div class="modal-box">
        <!-- 弹窗头部 -->
        <div class="modal-header">
          <span class="modal-title">📄 分析报告预览</span>
          <button id="modalClose" class="modal-close">&times;</button>
        </div>

        <!-- 弹窗内容（markdown 渲染结果） -->
        <div id="modalBody" class="modal-body"></div>

        <!-- 弹窗底部按钮 -->
        <div class="modal-footer">
          <button id="copyReportBtn" class="btn-outline">
            📋 复制报告
          </button>
          <button id="downloadReportBtn" class="btn-solid">
            💾 下载报告
          </button>
        </div>
      </div>
    </div>

    <!-- Chart.js CDN -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
    <!-- marked.js CDN —Markdown 渲染 -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="app.js"></script>
  </body>
  </html>
