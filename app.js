// ─── State ───────────────────────────────────────────────────────────────────
let videoFile = null;
let videoDuration = 0;
let marks = [];
let markHistory = [];   // stack of timestamps for undo
let clips = [];
let decodedAudioBuffer = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const videoWrapper    = document.getElementById('video-wrapper');
const video           = document.getElementById('video');
const timelineSection = document.getElementById('timeline-section');
const timelineBar     = document.getElementById('timeline-bar');
const timelineProgress= document.getElementById('timeline-progress');
const marksList       = document.getElementById('marks-list');
const clipsList       = document.getElementById('clips-list');
const btnMark         = document.getElementById('btn-mark');
const btnUndo         = document.getElementById('btn-undo');
const btnPlay         = document.getElementById('btn-play');
const btnClearMarks   = document.getElementById('btn-clear-marks');
const btnProcess      = document.getElementById('btn-process');
const btnDownloadAll  = document.getElementById('btn-download-all');
const btnSelectAll    = document.getElementById('btn-select-all');
const timeDisplay     = document.getElementById('time-display');
const statusText      = document.getElementById('status-text');
const progressWrap    = document.getElementById('progress-wrap');
const progressFill    = document.getElementById('progress-fill');
const procLoading     = document.getElementById('proc-loading');
const procLoadText    = document.getElementById('proc-load-text');
const toastContainer  = document.getElementById('toast-container');

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

function fmtDur(s) {
  if (s < 60) return `${s.toFixed(1)}s`;
  return fmt(s);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function uid() { return Math.random().toString(36).slice(2, 9); }

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

function showOverlay(msg) {
  procLoadText.textContent = msg;
  procLoading.classList.add('show');
}

function hideOverlay() {
  procLoading.classList.remove('show');
}

// ─── File Loading ─────────────────────────────────────────────────────────────
function loadVideoFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    toast('Please select a valid video file', 'error');
    return;
  }
  videoFile = file;
  decodedAudioBuffer = null;
  marks = [];
  markHistory = [];
  clips = [];
  syncUndoBtn();
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
  setStatus('Video loaded — play and click Mark to add timestamps');
}

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
});

video.addEventListener('timeupdate', () => {
  updateTimeline();
  timeDisplay.textContent = `${fmt(video.currentTime, 1)} / ${fmt(videoDuration)}`;
});

video.addEventListener('play',  () => { btnPlay.textContent = '⏸ Pause'; });
video.addEventListener('pause', () => { btnPlay.textContent = '▶ Play'; });
video.addEventListener('ended', () => { btnPlay.textContent = '▶ Play'; });

btnPlay.addEventListener('click', () => {
  if (video.paused) video.play(); else video.pause();
});

// ─── Timeline ────────────────────────────────────────────────────────────────
function updateTimeline() {
  if (!videoDuration) return;
  timelineProgress.style.width = ((video.currentTime / videoDuration) * 100) + '%';
  renderMarkerLines();
}

timelineBar.addEventListener('click', e => {
  if (!videoDuration) return;
  const rect = timelineBar.getBoundingClientRect();
  video.currentTime = ((e.clientX - rect.left) / rect.width) * videoDuration;
});

function renderMarkerLines() {
  timelineBar.querySelectorAll('.timeline-marker, .timeline-cursor').forEach(el => el.remove());

  const cursor = document.createElement('div');
  cursor.className = 'timeline-cursor';
  cursor.style.left = ((video.currentTime / videoDuration) * 100) + '%';
  timelineBar.appendChild(cursor);

  marks.forEach((t, i) => {
    const m = document.createElement('div');
    m.className = 'timeline-marker';
    m.dataset.index = i + 1;
    m.style.left = ((t / videoDuration) * 100) + '%';
    m.title = `Mark ${i + 1}: ${fmt(t, 2)}`;
    m.addEventListener('click', e => { e.stopPropagation(); video.currentTime = t; });
    timelineBar.appendChild(m);
  });
}

// ─── Marking ─────────────────────────────────────────────────────────────────
function syncUndoBtn() {
  btnUndo.disabled = markHistory.length === 0;
}

btnMark.addEventListener('click', () => {
  if (!videoFile) return;
  const t = parseFloat(video.currentTime.toFixed(3));
  if (marks.some(m => Math.abs(m - t) < 0.05)) { toast('Already marked near this time', 'info'); return; }
  marks.push(t);
  marks.sort((a, b) => a - b);
  markHistory.push(t);     // push to undo stack AFTER adding
  syncUndoBtn();
  renderMarks();
  rebuildClips();
  toast(`Mark ${marks.indexOf(t) + 1} at ${fmt(t, 2)}`, 'success');
});

btnUndo.addEventListener('click', undoLastMark);

function undoLastMark() {
  if (markHistory.length === 0) return;
  const last = markHistory.pop();
  const idx = marks.indexOf(last);
  if (idx !== -1) marks.splice(idx, 1);
  syncUndoBtn();
  renderMarks();
  rebuildClips();
  toast(`Undone mark at ${fmt(last, 2)}`, 'info');
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); btnMark.click(); }
  if (e.code === 'KeyP')  { if (video.paused) video.play(); else video.pause(); }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undoLastMark(); }
});

btnClearMarks.addEventListener('click', () => {
  marks = [];
  markHistory = [];
  syncUndoBtn();
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
    <span class="mark-chip">
      <span onclick="seekTo(${t})">${i + 1}: ${fmt(t, 2)}</span>
      <span class="del" onclick="deleteMark(${i})">×</span>
    </span>
  `).join('');
}

window.seekTo = t => { video.currentTime = t; };
window.deleteMark = i => {
  const removed = marks[i];
  marks.splice(i, 1);
  // Remove from undo history too so it can't be "undone" back
  const hi = markHistory.lastIndexOf(removed);
  if (hi !== -1) markHistory.splice(hi, 1);
  syncUndoBtn();
  renderMarks();
  rebuildClips();
};

// ─── Clips ────────────────────────────────────────────────────────────────────
function rebuildClips() {
  // Preserve existing names & locked status by matching on position index
  const prevNames = {};
  clips.forEach(c => { prevNames[c.index] = { name: c.name, locked: c.locked }; });
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
    if (end - start < 0.05) continue;
    const prev = prevNames[i + 1];
    clips.push({
      id:       uid(),
      index:    i + 1,
      start, end,
      name:     prev ? prev.name : String(i + 1),
      locked:   prev ? prev.locked : false,
      blob:     null,
      url:      null,
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
          Clip ${c.index} &nbsp;·&nbsp; ${fmt(c.start, 2)} → ${fmt(c.end, 2)} &nbsp;·&nbsp; ${fmtDur(c.end - c.start)}
        </span>
        ${c.url ? `
          <button class="btn btn-success btn-sm" onclick="downloadClip('${c.id}')" title="Download">⬇</button>
          <button class="btn btn-outline btn-sm" onclick="previewClip('${c.id}')" title="Preview">▶</button>
        ` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="filename-input-wrap" title="${c.locked ? 'Manually named' : 'Auto-numbered'}">
          <span class="filename-prefix">hcj_</span>
          <input class="filename-input" type="text"
            value="${escHtml(c.name)}"
            placeholder="${c.index}"
            id="name-${c.id}"
            onchange="renameClip('${c.id}', this.value)"
            title="N in hcj_N.mp3" />
          <span class="filename-suffix">.mp3</span>
          ${c.locked ? '<span class="lock-icon" title="Manually set · click to unlock" onclick="unlockClip(\''+c.id+'\')">🔒</span>' : ''}
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteClip('${c.id}')" title="Remove clip">✕</button>
      </div>
      ${c.url ? `<audio id="audio-${c.id}" src="${c.url}" style="display:none" preload="none"></audio>` : ''}
    </div>
  `).join('');

  updateDownloadBtn();
}

window.toggleSelect = (id, checked) => {
  const c = clips.find(x => x.id === id);
  if (!c) return;
  c.selected = checked;
  document.getElementById('card-' + id)?.classList.toggle('selected', checked);
  updateDownloadBtn();
};

// Auto-number subsequent unlocked clips when a clip is renamed
window.renameClip = (id, val) => {
  const idx = clips.findIndex(x => x.id === id);
  if (idx === -1) return;
  const trimmed = val.trim() || String(clips[idx].index);
  clips[idx].name   = trimmed;
  clips[idx].locked = true;

  // If the entered value is a number, cascade to subsequent unlocked clips
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && String(num) === trimmed) {
    for (let j = idx + 1; j < clips.length; j++) {
      if (!clips[j].locked) {
        clips[j].name = String(num + (j - idx));
        // Update the input in-place without full re-render
        const inp = document.getElementById('name-' + clips[j].id);
        if (inp) inp.value = clips[j].name;
      }
    }
  }
  // Re-render only to update lock icons
  renderClips();
};

// Unlock a clip so auto-numbering can affect it again
window.unlockClip = id => {
  const c = clips.find(x => x.id === id);
  if (c) { c.locked = false; renderClips(); }
};

window.deleteClip = id => {
  const i = clips.findIndex(x => x.id === id);
  if (i !== -1) { if (clips[i].url) URL.revokeObjectURL(clips[i].url); clips.splice(i, 1); }
  renderClips();
};

window.downloadClip = id => {
  const c = clips.find(x => x.id === id);
  if (!c?.url) { toast('Extract MP3 first', 'info'); return; }
  triggerDownload(c.url, `hcj_${c.name}.mp3`);
};

window.previewClip = id => {
  const el = document.getElementById('audio-' + id);
  if (!el) return;
  if (el.paused) el.play(); else el.pause();
};

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

function updateDownloadBtn() {
  btnDownloadAll.disabled = !clips.some(c => c.selected && c.url);
}

btnSelectAll.addEventListener('click', () => {
  const allSelected = clips.every(c => c.selected);
  clips.forEach(c => { c.selected = !allSelected; });
  renderClips();
});

// ─── MP3 Encoding via Web Audio API + lamejs ──────────────────────────────────
async function decodeAudio() {
  if (decodedAudioBuffer) return decodedAudioBuffer;
  showOverlay('Decoding audio from video… (this may take a moment for large files)');
  setStatus('Decoding audio…', 0.1);
  const arrayBuffer = await videoFile.arrayBuffer();
  const audioCtx = new AudioContext();
  decodedAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();
  return decodedAudioBuffer;
}

function encodeClipToMp3(audioBuffer, start, end, onProgress) {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.floor(start * sr);
  const endSample   = Math.min(Math.ceil(end * sr), audioBuffer.length);
  const length      = endSample - startSample;
  const numCh       = Math.min(audioBuffer.numberOfChannels, 2);

  const leftF32  = audioBuffer.getChannelData(0).subarray(startSample, endSample);
  const rightF32 = numCh > 1
    ? audioBuffer.getChannelData(1).subarray(startSample, endSample)
    : leftF32;

  function toInt16(f32) {
    const buf = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buf;
  }

  const leftI16  = toInt16(leftF32);
  const rightI16 = numCh > 1 ? toInt16(rightF32) : leftI16;

  const mp3enc   = new lamejs.Mp3Encoder(numCh, sr, 128);
  const chunkSz  = 1152;
  const mp3Parts = [];

  for (let i = 0; i < length; i += chunkSz) {
    const lChunk = leftI16.subarray(i, i + chunkSz);
    const rChunk = rightI16.subarray(i, i + chunkSz);
    const enc = numCh > 1 ? mp3enc.encodeBuffer(lChunk, rChunk) : mp3enc.encodeBuffer(lChunk);
    if (enc.length > 0) mp3Parts.push(new Uint8Array(enc));
    if (onProgress && i % (chunkSz * 100) === 0) onProgress(i / length);
  }

  const flush = mp3enc.flush();
  if (flush.length > 0) mp3Parts.push(new Uint8Array(flush));

  const total = mp3Parts.reduce((s, p) => s + p.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const p of mp3Parts) { merged.set(p, offset); offset += p.length; }

  return new Blob([merged], { type: 'audio/mpeg' });
}

function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

btnProcess.addEventListener('click', async () => {
  if (!videoFile) return;

  const toProcess = clips.filter(c => c.selected);
  if (toProcess.length === 0) { toast('No clips selected', 'info'); return; }

  btnProcess.disabled = true;
  btnDownloadAll.disabled = true;

  try {
    const audioBuffer = await decodeAudio();
    hideOverlay();

    for (let i = 0; i < toProcess.length; i++) {
      const c = toProcess[i];
      setStatus(`Encoding clip ${i + 1}/${toProcess.length}: hcj_${c.name}.mp3…`, i / toProcess.length);
      await yieldToUI();

      const blob = encodeClipToMp3(audioBuffer, c.start, c.end, p => {
        const overall = (i + p) / toProcess.length;
        setStatus(`Encoding clip ${i + 1}/${toProcess.length}: ${Math.round(p * 100)}%…`, overall);
      });

      if (c.url) URL.revokeObjectURL(c.url);
      c.blob = blob;
      c.url  = URL.createObjectURL(blob);
    }

    renderClips();
    setStatus(`✓ ${toProcess.length} clip${toProcess.length !== 1 ? 's' : ''} extracted`);
    toast(`Done! ${toProcess.length} MP3 file${toProcess.length !== 1 ? 's' : ''} ready`, 'success');
  } catch (err) {
    hideOverlay();
    setStatus('Error: ' + err.message);
    toast('Failed: ' + err.message, 'error', 7000);
    console.error(err);
  } finally {
    btnProcess.disabled = false;
    updateDownloadBtn();
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

  setStatus('Building ZIP…', 0);
  showOverlay('Building ZIP file…');
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    for (const c of ready) zip.file(`hcj_${c.name}.mp3`, c.blob);

    const blob = await zip.generateAsync({ type: 'blob' }, meta => {
      setStatus(`Building ZIP… ${Math.round(meta.percent)}%`, meta.percent / 100);
    });

    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'hcj_clips.zip');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(`✓ ZIP downloaded (${ready.length} files)`);
    toast(`ZIP with ${ready.length} clips downloaded`, 'success');
  } catch (err) {
    setStatus('ZIP error: ' + err.message);
    toast('ZIP failed: ' + err.message, 'error', 6000);
  } finally {
    hideOverlay();
  }
});
