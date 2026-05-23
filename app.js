import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';

// ─── State ───────────────────────────────────────────────────────────────────
let videoFile = null;
let videoDuration = 0;
let marks = [];           // sorted array of timestamps (seconds)
let clips = [];           // [{id, start, end, name, blob, url}]
let ffmpeg = null;
let ffmpegReady = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('file-input');
const videoWrapper = document.getElementById('video-wrapper');
const video        = document.getElementById('video');
const timelineSection = document.getElementById('timeline-section');
const timelineBar  = document.getElementById('timeline-bar');
const timelineProgress = document.getElementById('timeline-progress');
const marksList    = document.getElementById('marks-list');
const clipsList    = document.getElementById('clips-list');
const btnMark      = document.getElementById('btn-mark');
const btnPlay      = document.getElementById('btn-play');
const btnClearMarks = document.getElementById('btn-clear-marks');
const btnProcess   = document.getElementById('btn-process');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnSelectAll = document.getElementById('btn-select-all');
const timeDisplay  = document.getElementById('time-display');
const statusText   = document.getElementById('status-text');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const ffmpegLoading = document.getElementById('ffmpeg-loading');
const ffmpegLoadText = document.getElementById('ffmpeg-load-text');
const toastContainer = document.getElementById('toast-container');

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(s, decimals = 0) {
  if (!isFinite(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secStr = decimals > 0
    ? sec.toFixed(decimals).padStart(4 + decimals, '0')
    : String(Math.floor(sec)).padStart(2, '0');
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${secStr}`
    : `${m}:${secStr}`;
}

function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function setStatus(msg, progress = null) {
  statusText.textContent = msg;
  if (progress !== null) {
    progressWrap.style.display = 'block';
    progressFill.style.width = `${Math.round(progress * 100)}%`;
  } else {
    progressWrap.style.display = 'none';
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── FFmpeg init ─────────────────────────────────────────────────────────────
async function loadFFmpeg() {
  if (ffmpegReady) return;
  ffmpegLoading.classList.add('show');
  try {
    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.debug('[ffmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      setStatus(`Processing… ${Math.round(progress * 100)}%`, progress);
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegReady = true;
    ffmpegLoadText.textContent = 'FFmpeg ready!';
    setTimeout(() => ffmpegLoading.classList.remove('show'), 600);
    toast('FFmpeg loaded — ready to extract audio', 'success');
  } catch (err) {
    ffmpegLoading.classList.remove('show');
    toast('Failed to load FFmpeg: ' + err.message, 'error', 6000);
    console.error(err);
  }
}

// ─── File Loading ─────────────────────────────────────────────────────────────
function loadVideoFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    toast('Please select a valid video file', 'error');
    return;
  }
  videoFile = file;
  marks = [];
  clips = [];
  renderMarks();
  renderClips();

  const url = URL.createObjectURL(file);
  video.src = url;
  video.load();

  dropZone.style.display = 'none';
  videoWrapper.style.display = 'flex';
  timelineSection.style.display = 'block';
  btnProcess.disabled = true;

  toast(`Loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`, 'success');
  setStatus(`Video loaded — play and click Mark to add timestamps`);

  // preload FFmpeg in background
  loadFFmpeg();
}

// Drop zone
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => loadVideoFile(e.target.files[0]));
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  loadVideoFile(e.dataTransfer.files[0]);
});

// ─── Video controls ───────────────────────────────────────────────────────────
video.addEventListener('loadedmetadata', () => {
  videoDuration = video.duration;
  timeDisplay.textContent = `0:00.0 / ${fmt(videoDuration)}`;
  updateTimeline();
});

video.addEventListener('timeupdate', () => {
  updateTimeline();
  timeDisplay.textContent = `${fmt(video.currentTime, 1)} / ${fmt(videoDuration)}`;
  btnPlay.textContent = video.paused ? '▶ Play' : '⏸ Pause';
});

video.addEventListener('play',  () => { btnPlay.textContent = '⏸ Pause'; });
video.addEventListener('pause', () => { btnPlay.textContent = '▶ Play'; });
video.addEventListener('ended', () => { btnPlay.textContent = '▶ Play'; });

btnPlay.addEventListener('click', () => {
  if (video.paused) video.play(); else video.pause();
});

// ─── Timeline interaction ─────────────────────────────────────────────────────
function updateTimeline() {
  const pct = videoDuration ? (video.currentTime / videoDuration) * 100 : 0;
  timelineProgress.style.width = pct + '%';
  renderMarkerLines();
}

timelineBar.addEventListener('click', e => {
  if (!videoDuration) return;
  const rect = timelineBar.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  video.currentTime = ratio * videoDuration;
});

function renderMarkerLines() {
  // Remove old markers (leave progress div)
  timelineBar.querySelectorAll('.timeline-marker, .timeline-cursor').forEach(el => el.remove());

  // Cursor
  const cursor = document.createElement('div');
  cursor.className = 'timeline-cursor';
  const cursorPct = videoDuration ? (video.currentTime / videoDuration) * 100 : 0;
  cursor.style.left = cursorPct + '%';
  timelineBar.appendChild(cursor);

  marks.forEach((t, i) => {
    const m = document.createElement('div');
    m.className = 'timeline-marker';
    m.dataset.index = i + 1;
    m.style.left = ((t / videoDuration) * 100) + '%';
    m.title = `Mark ${i + 1}: ${fmt(t, 2)}`;
    m.addEventListener('click', e => {
      e.stopPropagation();
      video.currentTime = t;
    });
    timelineBar.appendChild(m);
  });
}

// ─── Marking ─────────────────────────────────────────────────────────────────
btnMark.addEventListener('click', () => {
  if (!videoFile) return;
  const t = video.currentTime;
  if (marks.includes(t)) { toast('Already marked at this time', 'info'); return; }
  marks.push(t);
  marks.sort((a, b) => a - b);
  renderMarks();
  rebuildClips();
  toast(`Mark added at ${fmt(t, 2)}`, 'success');
});

// Space bar = mark while playing
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); btnMark.click(); }
  if (e.code === 'KeyP') { if (video.paused) video.play(); else video.pause(); }
});

btnClearMarks.addEventListener('click', () => {
  marks = [];
  renderMarks();
  rebuildClips();
  toast('All marks cleared', 'info');
});

function renderMarks() {
  if (marks.length === 0) {
    marksList.innerHTML = '<span style="font-size:.78rem;color:var(--text-muted);font-style:italic;">No marks yet — play the video and click Mark</span>';
    return;
  }
  marksList.innerHTML = marks.map((t, i) => `
    <span class="mark-chip" data-index="${i}">
      <span onclick="seekTo(${t})">${i + 1}: ${fmt(t, 2)}</span>
      <span class="del" onclick="deleteMark(${i})">×</span>
    </span>
  `).join('');
}

window.seekTo = (t) => { video.currentTime = t; };
window.deleteMark = (i) => {
  marks.splice(i, 1);
  renderMarks();
  rebuildClips();
};

// ─── Clips ────────────────────────────────────────────────────────────────────
function rebuildClips() {
  // Free old blob URLs
  clips.forEach(c => { if (c.url) URL.revokeObjectURL(c.url); });

  if (!videoDuration || marks.length === 0) {
    clips = [];
    renderClips();
    btnProcess.disabled = true;
    return;
  }

  const boundaries = [0, ...marks, videoDuration];
  clips = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end   = boundaries[i + 1];
    if (end - start < 0.01) continue;
    clips.push({
      id:     uid(),
      index:  i + 1,
      start,
      end,
      name:   String(i + 1),   // suffix after "hcj_"
      blob:   null,
      url:    null,
      selected: true,
    });
  }

  renderClips();
  btnProcess.disabled = clips.length === 0;
  setStatus(`${clips.length} clip${clips.length !== 1 ? 's' : ''} ready — click "Extract MP3" to process`);
}

function renderClips() {
  if (clips.length === 0) {
    clipsList.innerHTML = `
      <div class="empty-state">
        <div class="icon">✂️</div>
        <div>Load a video and add marks<br>to create clips</div>
      </div>`;
    btnDownloadAll.disabled = true;
    return;
  }

  clipsList.innerHTML = clips.map(c => `
    <div class="clip-card ${c.selected ? 'selected' : ''}" id="card-${c.id}">
      <div class="clip-card-top">
        <input type="checkbox" id="chk-${c.id}" ${c.selected ? 'checked' : ''}
          onchange="toggleSelect('${c.id}', this.checked)" />
        <span class="clip-label">
          Clip ${c.index} &nbsp;·&nbsp; ${fmt(c.start, 2)} → ${fmt(c.end, 2)}
          &nbsp;·&nbsp; ${fmtDur(c.end - c.start)}
        </span>
        ${c.url ? `
        <button class="btn btn-success btn-sm" onclick="downloadClip('${c.id}')">⬇</button>
        <button class="btn btn-outline btn-sm" onclick="previewClip('${c.id}')">▶</button>
        ` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="filename-input-wrap">
          <span class="filename-prefix">hcj_</span>
          <input class="filename-input" type="text"
            value="${escHtml(c.name)}"
            placeholder="1"
            onchange="renameClip('${c.id}', this.value)"
            title="N in hcj_N.mp3" />
          <span class="filename-suffix">.mp3</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteClip('${c.id}')" title="Remove clip">✕</button>
      </div>
      ${c.url ? `<audio id="audio-${c.id}" src="${c.url}" style="display:none"></audio>` : ''}
    </div>
  `).join('');

  updateDownloadBtn();
}

function fmtDur(s) {
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${fmt(s)}`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.toggleSelect = (id, checked) => {
  const c = clips.find(x => x.id === id);
  if (!c) return;
  c.selected = checked;
  const card = document.getElementById('card-' + id);
  if (card) card.classList.toggle('selected', checked);
  updateDownloadBtn();
};

window.renameClip = (id, val) => {
  const c = clips.find(x => x.id === id);
  if (c) c.name = val.trim() || String(c.index);
};

window.deleteClip = (id) => {
  const i = clips.findIndex(x => x.id === id);
  if (i !== -1) {
    if (clips[i].url) URL.revokeObjectURL(clips[i].url);
    clips.splice(i, 1);
  }
  renderClips();
};

window.downloadClip = (id) => {
  const c = clips.find(x => x.id === id);
  if (!c || !c.url) { toast('Extract MP3 first', 'info'); return; }
  triggerDownload(c.url, `hcj_${c.name}.mp3`);
};

window.previewClip = (id) => {
  const el = document.getElementById('audio-' + id);
  if (!el) return;
  if (el.paused) el.play(); else el.pause();
};

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function updateDownloadBtn() {
  const readySelected = clips.filter(c => c.selected && c.url);
  btnDownloadAll.disabled = readySelected.length === 0;
}

btnSelectAll.addEventListener('click', () => {
  const allSelected = clips.every(c => c.selected);
  clips.forEach(c => { c.selected = !allSelected; });
  renderClips();
});

// ─── Extract MP3 ─────────────────────────────────────────────────────────────
btnProcess.addEventListener('click', async () => {
  if (!videoFile) return;

  if (!ffmpegReady) {
    toast('FFmpeg is loading, please wait…', 'info');
    await loadFFmpeg();
    if (!ffmpegReady) return;
  }

  const toProcess = clips.filter(c => c.selected);
  if (toProcess.length === 0) { toast('No clips selected', 'info'); return; }

  btnProcess.disabled = true;
  btnDownloadAll.disabled = true;

  try {
    setStatus('Writing video to FFmpeg…', 0);
    const inputName = 'input_video';
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

    for (let i = 0; i < toProcess.length; i++) {
      const c = toProcess[i];
      const outName = `out_${c.id}.mp3`;

      setStatus(`Extracting clip ${i + 1}/${toProcess.length}: hcj_${c.name}.mp3…`, i / toProcess.length);

      await ffmpeg.exec([
        '-i', inputName,
        '-ss', String(c.start),
        '-to', String(c.end),
        '-vn',
        '-acodec', 'libmp3lame',
        '-q:a', '2',
        outName
      ]);

      const data = await ffmpeg.readFile(outName);
      await ffmpeg.deleteFile(outName);

      if (c.url) URL.revokeObjectURL(c.url);
      c.blob = new Blob([data.buffer], { type: 'audio/mpeg' });
      c.url  = URL.createObjectURL(c.blob);
    }

    await ffmpeg.deleteFile(inputName);

    renderClips();
    setStatus(`✓ ${toProcess.length} clip${toProcess.length !== 1 ? 's' : ''} extracted`);
    toast(`Done! ${toProcess.length} MP3 file${toProcess.length !== 1 ? 's' : ''} ready`, 'success');
    btnProcess.disabled = false;
    updateDownloadBtn();
  } catch (err) {
    setStatus('Error: ' + err.message);
    toast('Extraction failed: ' + err.message, 'error', 7000);
    console.error(err);
    btnProcess.disabled = false;
  }
});

// ─── Download Selected (single or ZIP) ───────────────────────────────────────
btnDownloadAll.addEventListener('click', async () => {
  const ready = clips.filter(c => c.selected && c.url);
  if (ready.length === 0) { toast('No extracted clips selected', 'info'); return; }

  if (ready.length === 1) {
    triggerDownload(ready[0].url, `hcj_${ready[0].name}.mp3`);
    return;
  }

  // Multiple → ZIP
  setStatus('Building ZIP…', 0);
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();

    for (const c of ready) {
      zip.file(`hcj_${c.name}.mp3`, c.blob);
    }

    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      setStatus(`Building ZIP… ${Math.round(meta.percent)}%`, meta.percent / 100);
    });

    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'hcj_clips.zip');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(`✓ ZIP downloaded (${ready.length} files)`);
    toast(`ZIP downloaded — ${ready.length} clips`, 'success');
  } catch (err) {
    setStatus('ZIP error: ' + err.message);
    toast('ZIP failed: ' + err.message, 'error', 6000);
  }
});
