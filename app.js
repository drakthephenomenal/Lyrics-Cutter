// ─── State ───────────────────────────────────────────────────────────────────
let mainFile = null;    // the loaded video OR audio file (marking system applies to this)
let videoDuration = 0;  // duration of mainFile, whichever kind it is
let marks = [];
let markHistory = [];   // stack of timestamps for undo
let clips = [];
let decodedAudioBuffer = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const importZone      = document.getElementById('import-zone');
const importInput     = document.getElementById('import-input');
const prefixInput     = document.getElementById('prefix-input');
const videoWrapper    = document.getElementById('video-wrapper');
const video           = document.getElementById('video');
const audioShell      = document.getElementById('audio-player-shell');
const audioPlayer     = document.getElementById('audio-player');
let   mediaEl         = video; // whichever of video/audioPlayer is currently active
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
const btnExportTxt    = document.getElementById('btn-export-txt');
const btnExportCsv    = document.getElementById('btn-export-csv');
const tabButtons      = document.querySelectorAll('.tab');
const paneLyrics      = document.getElementById('pane-lyrics');
const paneClips       = document.getElementById('pane-clips');
const clipBadge       = document.getElementById('clip-badge');
const lyricsProgress  = document.getElementById('lyrics-progress');
const lyricsEditor    = document.getElementById('lyrics-editor');
const lyricsInput     = document.getElementById('lyrics-input');
const lyricsModeSel   = document.getElementById('lyrics-mode');
const lyricsList      = document.getElementById('lyrics-list');
const btnLyricsEdit   = document.getElementById('btn-lyrics-edit');
const btnLyricsSave   = document.getElementById('btn-lyrics-save');
const btnFontUp       = document.getElementById('btn-font-up');
const btnFontDown     = document.getElementById('btn-font-down');
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
    ? sec.toFixed(decimals).padStart(3 + decimals, '0')
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

const VIDEO_EXT = /\.(mp4|mkv|mov|avi|webm|m4v|3gp|ts)$/i;
const AUDIO_EXT  = /\.(mp3|m4a|wav|aac|ogg|flac|wma)$/i;

// Some phone/instagram-saved files report an empty or generic MIME type
// (e.g. "application/octet-stream") instead of "video/mp4" — fall back to
// the file extension so those aren't silently rejected.
function isVideoFile(file) {
  return file.type.startsWith('video/') || (!file.type && VIDEO_EXT.test(file.name));
}
function isAudioFile(file) {
  return file.type.startsWith('audio/') || (!file.type && AUDIO_EXT.test(file.name));
}
function isMediaFile(file) {
  return isVideoFile(file) || isAudioFile(file) ||
    (file.type === 'application/octet-stream' && (VIDEO_EXT.test(file.name) || AUDIO_EXT.test(file.name)));
}

// ─── Pad (verse) number detection from filename ────────────────────────────────
const DEVANAGARI_DIGITS = '०१२३४५६७८९';
function devanagariToLatin(str) {
  return str.replace(/[०-९]/g, d => String(DEVANAGARI_DIGITS.indexOf(d)));
}

// Reads a verse number straight out of a filename like:
// "श्री हित चौरासी जी ❤️ पद ४.श्री हित हरिवंश ... .mp4" → 4
// Looks for a number right after "पद" (Devanagari or Latin digits) first,
// falling back to the first standalone number anywhere in the name.
function extractPadNumber(filename) {
  const nameOnly = filename.replace(/\.[a-zA-Z0-9]{2,4}$/, ''); // drop extension (avoids matching the "4" in ".mp4")
  let m = nameOnly.match(/पद[^0-9०-९]{0,12}([0-9०-९]+)/);
  if (!m) m = nameOnly.match(/([0-9०-९]+)/);
  if (!m) return null;
  const num = parseInt(devanagariToLatin(m[1]), 10);
  return isNaN(num) ? null : num;
}

function prefix() {
  const v = (prefixInput.value || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
  return v || 'hcj';
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

function showOverlay(msg) {
  procLoadText.textContent = msg;
  procLoading.classList.add('show');
}

function hideOverlay() {
  procLoading.classList.remove('show');
}

// Surface otherwise-silent failures as an on-screen toast — there's no
// console to check on a phone/tablet, so this is the only way to see what
// went wrong when something breaks in the field.
window.addEventListener('error', e => {
  toast('Error: ' + (e.message || 'Unknown script error'), 'error', 8000);
});
window.addEventListener('unhandledrejection', e => {
  const reason = e.reason;
  const msg = reason && reason.message ? reason.message : String(reason);
  toast('Error: ' + msg, 'error', 8000);
});

// ─── File Loading ─────────────────────────────────────────────────────────────
// Handles both video files and audio-only files (mp3/wav/m4a/etc). Whichever
// kind is loaded, the same mark/timeline/cut system below operates on it —
// `mediaEl` just points at the <video> or <audio> element that's actually
// playing it.
function loadVideoFile(file) {
  if (!file || !isMediaFile(file)) {
    toast('Please select a valid video or audio file', 'error');
    return;
  }
  const audioOnly = isAudioFile(file) && !isVideoFile(file);

  mainFile = file;
  decodedAudioBuffer = null;
  marks = [];
  markHistory = [];
  clips = [];
  verseOffset = 0;
  syncUndoBtn();
  renderMarks();
  renderClips();

  const url = URL.createObjectURL(file);

  if (audioOnly) {
    mediaEl = audioPlayer;
    video.removeAttribute('src');
    video.style.display = 'none';
    audioShell.style.display = 'flex';
    audioPlayer.src = url;
    audioPlayer.load();
  } else {
    mediaEl = video;
    audioPlayer.removeAttribute('src');
    audioShell.style.display = 'none';
    video.style.display = '';
    video.src = url;
    video.load();
  }

  dropZone.style.display = 'none';
  videoWrapper.style.display = 'flex';
  timelineSection.style.display = 'block';
  btnProcess.disabled = true;

  toast(`Loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`, 'success');
  setStatus(`${audioOnly ? 'Audio' : 'Video'} loaded — play and click Mark to add timestamps`);
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

// ─── Import already-cut clips (one file per verse) ────────────────────────────
// Reads each file's own duration and appends it as a whole-file clip — no
// marking needed, since the file IS the verse already.
function loadFileDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(isAudioFile(file) ? 'audio' : 'video');
    el.preload = 'metadata';
    el.src = url;
    el.onloadedmetadata = () => { resolve(el.duration); URL.revokeObjectURL(url); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read ' + file.name)); };
  });
}

async function addImportedClips(fileList) {
  const files = Array.from(fileList).filter(isMediaFile);
  if (files.length === 0) { toast('No video/audio files found', 'error'); return; }

  // Detect each file's pad (verse) number from its name up front, so both
  // the sort order and the auto-generated name can use it.
  const withPad = files.map(f => ({ file: f, pad: extractPadNumber(f.name) }));

  // Sort: files with a detected pad number go first, in numeric order;
  // anything undetected falls back to natural filename order at the end.
  withPad.sort((a, b) => {
    if (a.pad != null && b.pad != null) return a.pad - b.pad;
    if (a.pad != null) return -1;
    if (b.pad != null) return 1;
    return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
  });

  let nextIndex = clips.length ? Math.max(...clips.map(c => c.index)) + 1 : 1;
  let failed = 0;
  let detected = 0;

  for (const { file: f, pad } of withPad) {
    let dur = 0;
    try {
      dur = await loadFileDuration(f);
    } catch (e) {
      failed++;
      continue;
    }
    if (pad != null) detected++;
    clips.push({
      id: uid(),
      index: pad != null ? pad : nextIndex,
      start: 0,
      end: dur,
      file: f,
      name: pad != null ? String(pad) : String(nextIndex),
      // Lock detected pad numbers so the auto-cascade renumbering (used when
      // you manually rename a clip) doesn't overwrite a name read from file.
      locked: pad != null,
      padDetected: pad != null,
      blob: null,
      url: null,
      selected: true,
    });
    if (pad == null) nextIndex++;
  }

  timelineSection.style.display = 'none'; // marks don't apply to imported clips
  renderClips();
  switchTab('clips');
  btnProcess.disabled = clips.length === 0;
  const added = files.length - failed;
  setStatus(`${added} clip${added !== 1 ? 's' : ''} imported (${detected} pad number${detected !== 1 ? 's' : ''} auto-detected) — click "Extract MP3" to convert`);
  toast(`Imported ${added} clip${added !== 1 ? 's' : ''}${detected ? `, ${detected} pad number${detected !== 1 ? 's' : ''} detected` : ''}${failed ? `, ${failed} failed` : ''}`,
    failed ? 'info' : 'success');
}

importZone.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', e => addImportedClips(e.target.files));
importZone.addEventListener('dragover', e => { e.preventDefault(); importZone.classList.add('dragover'); });
importZone.addEventListener('dragleave', () => importZone.classList.remove('dragover'));
importZone.addEventListener('drop', e => {
  e.preventDefault();
  importZone.classList.remove('dragover');
  addImportedClips(e.dataTransfer.files);
});

// ─── Media controls (shared by both <video> and <audio>) ─────────────────────
// Both elements get the same listeners; each handler checks that it's firing
// on whichever one is currently active (`mediaEl`) before touching shared state,
// so loading a new file — possibly of the other kind — can't leave stale
// listeners on an element nobody's looking at.
function bindMediaEvents(el) {
  el.addEventListener('loadedmetadata', () => {
    if (el !== mediaEl) return;
    videoDuration = el.duration;
    timeDisplay.textContent = `0:00.0 / ${fmt(videoDuration)}`;
  });

  el.addEventListener('timeupdate', () => {
    if (el !== mediaEl) return;
    updateTimeline();
    timeDisplay.textContent = `${fmt(el.currentTime, 1)} / ${fmt(videoDuration)}`;
  });

  el.addEventListener('play',  () => { if (el === mediaEl) btnPlay.textContent = '⏸ Pause'; });
  el.addEventListener('pause', () => { if (el === mediaEl) btnPlay.textContent = '▶ Play'; });
  el.addEventListener('ended', () => { if (el === mediaEl) btnPlay.textContent = '▶ Play'; });
}
bindMediaEvents(video);
bindMediaEvents(audioPlayer);

btnPlay.addEventListener('click', () => {
  if (mediaEl.paused) mediaEl.play(); else mediaEl.pause();
});

// ─── Timeline ────────────────────────────────────────────────────────────────
function updateTimeline() {
  if (!videoDuration) return;
  timelineProgress.style.width = ((mediaEl.currentTime / videoDuration) * 100) + '%';
  renderMarkerLines();
}

timelineBar.addEventListener('click', e => {
  if (!videoDuration) return;
  const rect = timelineBar.getBoundingClientRect();
  mediaEl.currentTime = ((e.clientX - rect.left) / rect.width) * videoDuration;
});

function renderMarkerLines() {
  timelineBar.querySelectorAll('.timeline-marker, .timeline-cursor').forEach(el => el.remove());

  const cursor = document.createElement('div');
  cursor.className = 'timeline-cursor';
  cursor.style.left = ((mediaEl.currentTime / videoDuration) * 100) + '%';
  timelineBar.appendChild(cursor);

  marks.forEach((t, i) => {
    const m = document.createElement('div');
    m.className = 'timeline-marker';
    m.dataset.index = i + 1;
    m.style.left = ((t / videoDuration) * 100) + '%';
    m.title = `Mark ${i + 1}: ${fmt(t, 2)}`;
    m.addEventListener('click', e => { e.stopPropagation(); mediaEl.currentTime = t; });
    timelineBar.appendChild(m);
  });
}

// ─── Marking ─────────────────────────────────────────────────────────────────
function syncUndoBtn() {
  btnUndo.disabled = markHistory.length === 0;
}

btnMark.addEventListener('click', () => {
  if (!mainFile) return;
  const t = parseFloat(mediaEl.currentTime.toFixed(3));
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
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); btnMark.click(); }
  if (e.code === 'KeyP')  { if (mediaEl.paused) mediaEl.play(); else mediaEl.pause(); }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undoLastMark(); }
});

btnClearMarks.addEventListener('click', () => {
  marks = [];
  markHistory = [];
  verseOffset = 0;
  syncUndoBtn();
  renderMarks();
  rebuildClips();
  toast('All marks cleared', 'info');
});

function renderMarks() {
  btnExportTxt.disabled = btnExportCsv.disabled = marks.length === 0;
  renderLyrics();
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

window.seekTo = t => { mediaEl.currentTime = t; };
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

// ─── Export marks (timestamps) ────────────────────────────────────────────────
// Precise HH:MM:SS.mmm — the format FFmpeg, subtitle tools and most editors accept.
function stamp(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec.toFixed(3).padStart(6,'0')}`;
}

function saveTextFile(text, filename, mime) {
  // BOM so Excel/Notepad read Devanagari or other non-Latin filenames correctly
  const blob = new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportBaseName() {
  const base = mainFile ? mainFile.name.replace(/\.[^.]+$/, '') : 'marks';
  return base.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'marks';
}

// Clip ranges derived from the current marks (same boundaries rebuildClips uses)
function markRanges() {
  const b = [0, ...marks, videoDuration];
  const out = [];
  for (let i = 0; i < b.length - 1; i++) {
    if (b[i + 1] - b[i] < 0.05) continue;
    out.push({ n: i + 1, start: b[i], end: b[i + 1] });
  }
  return out;
}

function exportMarksTxt() {
  if (!marks.length) { toast('No marks to export', 'info'); return; }
  const lines = [];
  lines.push(`Source: ${mainFile ? mainFile.name : '-'}`);
  lines.push(`Duration: ${stamp(videoDuration)} (${videoDuration.toFixed(3)} s)`);
  lines.push(`Marks: ${marks.length}`);
  lines.push('');
  lines.push('MARKS');
  marks.forEach((t, i) => lines.push(`${String(i + 1).padStart(2,' ')}.  ${stamp(t)}   (${t.toFixed(3)} s)`));
  lines.push('');
  lines.push('CLIPS (start -> end)');
  markRanges().forEach(r => {
    const clip = clips.find(c => !c.file && c.index === r.n);
    const name = `${prefix()}_${clip ? clip.name : r.n}.mp3`;
    lines.push(`${String(r.n).padStart(2,' ')}.  ${stamp(r.start)} -> ${stamp(r.end)}   [${(r.end - r.start).toFixed(3)} s]   ${name}`);
    const ly = verseForClip(r.n);
    if (ly) lines.push('      ' + ly.replace(/\s*\n\s*/g, ' / '));
  });
  lines.push('');
  saveTextFile(lines.join('\r\n'), `${exportBaseName()}_marks.txt`, 'text/plain');
  toast(`Exported ${marks.length} mark${marks.length !== 1 ? 's' : ''} (.txt)`, 'success');
}

function exportMarksCsv() {
  if (!marks.length) { toast('No marks to export', 'info'); return; }
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['clip', 'filename', 'start', 'end', 'start_seconds', 'end_seconds', 'duration_seconds', 'lyrics']];
  markRanges().forEach(r => {
    const clip = clips.find(c => !c.file && c.index === r.n);
    rows.push([
      r.n,
      `${prefix()}_${clip ? clip.name : r.n}.mp3`,
      stamp(r.start), stamp(r.end),
      r.start.toFixed(3), r.end.toFixed(3), (r.end - r.start).toFixed(3),
      verseForClip(r.n).replace(/\s*\n\s*/g, ' / '),
    ]);
  });
  saveTextFile(rows.map(r => r.map(q).join(',')).join('\r\n'), `${exportBaseName()}_marks.csv`, 'text/csv');
  toast(`Exported ${marks.length} mark${marks.length !== 1 ? 's' : ''} (.csv)`, 'success');
}

btnExportTxt.addEventListener('click', exportMarksTxt);
btnExportCsv.addEventListener('click', exportMarksCsv);

// ─── Lyrics panel + tabs ─────────────────────────────────────────────────────
// Verses map to clips: clip N = N-th segment between marks, so verse 1 ends at
// Mark 1. `verseOffset` shifts that mapping (tap a later verse to skip an intro).
const LYRICS_KEY = 'hcj_lyrics_v1';
let lyricsRaw     = '';
let lyricsModeVal = 'blank';
let lyricsSize    = 1.05;
let verses        = [];
let verseOffset   = 0;
let lyricsEditing = true;
let lastCurVerse  = -1;

function parseLyrics(raw, mode) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const parts = mode === 'line' ? text.split('\n') : text.split(/\n\s*\n+/);
  return parts.map(p => p.trim()).filter(Boolean);
}

function saveLyricsPrefs() {
  try {
    localStorage.setItem(LYRICS_KEY, JSON.stringify({ raw: lyricsRaw, mode: lyricsModeVal, size: lyricsSize }));
  } catch (e) { /* storage unavailable — fine, just not remembered */ }
}

function loadLyricsPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(LYRICS_KEY) || 'null');
    if (s) {
      lyricsRaw = s.raw || '';
      lyricsModeVal = s.mode === 'line' ? 'line' : 'blank';
      lyricsSize = Math.min(2.2, Math.max(0.8, Number(s.size) || 1.05));
    }
  } catch (e) { /* ignore corrupt data */ }
}

function currentVerseIdx() { return Math.max(0, marks.length + verseOffset); }

function verseForClip(n) { return verses[n - 1 + verseOffset] || ''; }

function verseState(i) {
  const clipN = i - verseOffset + 1;
  if (clipN < 1) return 'skipped';
  if (clipN <= marks.length) return 'done';
  if (clipN === marks.length + 1) return 'current';
  return 'pending';
}

function scrollToCurrentVerse() {
  if (paneLyrics.hidden || lyricsList.hidden || verses.length === 0) return;
  const idx = Math.min(currentVerseIdx(), verses.length - 1);
  const el = document.getElementById('verse-' + idx);
  if (!el) return;
  lyricsList.scrollTo({ top: Math.max(0, el.offsetTop - lyricsList.clientHeight * 0.2), behavior: 'smooth' });
}

function renderLyrics(forceScroll = false) {
  lyricsList.style.setProperty('--lyrics-size', lyricsSize);
  const showEditor = lyricsEditing || verses.length === 0;
  lyricsEditor.hidden = !showEditor;
  lyricsList.hidden = showEditor;
  btnLyricsEdit.hidden = verses.length === 0;
  btnLyricsEdit.textContent = showEditor ? '✕ Cancel' : '✎ Edit';

  if (verses.length === 0) {
    lyricsProgress.textContent = 'Paste lyrics to follow along';
    lyricsList.innerHTML = '';
    return;
  }

  const cur = currentVerseIdx();
  lyricsProgress.textContent = cur >= verses.length
    ? `All ${verses.length} verses marked ✓`
    : `Verse ${cur + 1} of ${verses.length}`;

  const ranges = {};
  markRanges().forEach(r => { ranges[r.n] = r; });

  lyricsList.innerHTML = verses.map((text, i) => {
    const st = verseState(i);
    const n = i - verseOffset + 1;
    let label = '';
    if (st === 'done') {
      const r = ranges[n];
      label = r ? `✓ ${fmt(r.start, 1)} → ${fmt(r.end, 1)}` : '✓';
    } else if (st === 'current') {
      label = i === verses.length - 1 ? '● cutting now · last verse (ends at end of file)' : '● cutting now · Mark at its end';
    } else if (st === 'skipped') {
      label = 'skipped';
    }
    return `<div class="verse ${st}" id="verse-${i}" onclick="verseTap(${i})">
      <div class="verse-head"><span>Verse ${i + 1}</span><span class="verse-status">${label}</span></div>
      <div class="verse-text">${escHtml(text)}</div>
    </div>`;
  }).join('');

  if (!showEditor && (forceScroll || cur !== lastCurVerse)) scrollToCurrentVerse();
  lastCurVerse = cur;
}

window.verseTap = i => {
  const st = verseState(i);
  if (st === 'done') {
    // jump back to that verse's clip to re-listen
    const r = markRanges().find(x => x.n === i - verseOffset + 1);
    if (r) { mediaEl.currentTime = r.start; mediaEl.play().catch(() => {}); }
  } else if (st !== 'current') {
    // make this the verse being cut now (e.g. skip an intro or instrumental)
    verseOffset = i - marks.length;
    renderLyrics(true);
    renderClips();
    toast(`Now cutting verse ${i + 1}`, 'info', 1800);
  }
};

function switchTab(name) {
  const lyricsOn = name === 'lyrics';
  paneLyrics.hidden = !lyricsOn;
  paneClips.hidden = lyricsOn;
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (lyricsOn) renderLyrics(true);
}
tabButtons.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

btnLyricsEdit.addEventListener('click', () => {
  lyricsEditing = !lyricsEditing;
  if (lyricsEditing) { lyricsInput.value = lyricsRaw; lyricsModeSel.value = lyricsModeVal; }
  renderLyrics();
  if (lyricsEditing) lyricsInput.focus();
});

btnLyricsSave.addEventListener('click', () => {
  lyricsRaw = lyricsInput.value;
  lyricsModeVal = lyricsModeSel.value;
  verses = parseLyrics(lyricsRaw, lyricsModeVal);
  verseOffset = 0;
  lyricsEditing = false;
  saveLyricsPrefs();
  renderLyrics(true);
  renderClips();
  toast(verses.length ? `${verses.length} verse${verses.length !== 1 ? 's' : ''} loaded` : 'No lyrics entered', verses.length ? 'success' : 'info');
});

function changeLyricsSize(delta) {
  lyricsSize = Math.min(2.2, Math.max(0.8, Math.round((lyricsSize + delta) * 100) / 100));
  saveLyricsPrefs();
  renderLyrics();
}
btnFontUp.addEventListener('click',   () => changeLyricsSize(0.1));
btnFontDown.addEventListener('click', () => changeLyricsSize(-0.1));

loadLyricsPrefs();
lyricsInput.value = lyricsRaw;
lyricsModeSel.value = lyricsModeVal;
verses = parseLyrics(lyricsRaw, lyricsModeVal);
lyricsEditing = verses.length === 0;
renderLyrics();

// ─── Clips ────────────────────────────────────────────────────────────────────
function rebuildClips() {
  // Imported (whole-file) clips aren't derived from marks — keep them as-is.
  const imported = clips.filter(c => c.file);
  const markBased = clips.filter(c => !c.file);

  // Preserve existing names & locked status by matching on position index
  const prevNames = {};
  markBased.forEach(c => { prevNames[c.index] = { name: c.name, locked: c.locked }; });
  markBased.forEach(c => { if (c.url) URL.revokeObjectURL(c.url); });

  if (!videoDuration || marks.length === 0) {
    clips = imported;
    renderClips();
    btnProcess.disabled = clips.length === 0;
    return;
  }

  const boundaries = [0, ...marks, videoDuration];
  const rebuilt = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end   = boundaries[i + 1];
    if (end - start < 0.05) continue;
    const prev = prevNames[i + 1];
    rebuilt.push({
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

  clips = [...rebuilt, ...imported];
  renderClips();
  btnProcess.disabled = clips.length === 0;
  setStatus(`${clips.length} clip${clips.length !== 1 ? 's' : ''} ready — open the Clips tab and click "Extract MP3"`);
}

function renderClips() {
  clipBadge.textContent = clips.length;
  clipBadge.hidden = clips.length === 0;
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
          ${c.file ? '📥 ' : ''}Clip ${c.index} &nbsp;·&nbsp; ${c.file ? escHtml(c.file.name) : `${fmt(c.start, 2)} → ${fmt(c.end, 2)}`} &nbsp;·&nbsp; ${fmtDur(c.end - c.start)}
        </span>
        ${c.url ? `
          <button class="btn btn-success btn-sm" onclick="downloadClip('${c.id}')" title="Download">⬇</button>
          <button class="btn btn-outline btn-sm" onclick="previewClip('${c.id}')" title="Preview">▶</button>
        ` : ''}
      </div>
      ${!c.file && verseForClip(c.index) ? `<div class="clip-lyric">${escHtml(verseForClip(c.index))}</div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="filename-input-wrap" title="${c.padDetected ? 'Pad number detected from filename' : c.locked ? 'Manually named' : 'Auto-numbered'}">
          <span class="filename-prefix">${prefix()}_</span>
          <input class="filename-input" type="text"
            value="${escHtml(c.name)}"
            placeholder="${c.index}"
            id="name-${c.id}"
            onchange="renameClip('${c.id}', this.value)"
            title="N in ${prefix()}_N.mp3" />
          <span class="filename-suffix">.mp3</span>
          ${c.padDetected ? '<span class="lock-icon" title="Pad number detected from filename · click to edit manually" onclick="unlockClip(\''+c.id+'\')">🔢</span>' : c.locked ? '<span class="lock-icon" title="Manually set · click to unlock" onclick="unlockClip(\''+c.id+'\')">🔒</span>' : ''}
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
  clips[idx].padDetected = false; // user edited it, so it's a manual lock now

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
  if (c) { c.locked = false; c.padDetected = false; renderClips(); }
};

window.deleteClip = id => {
  const i = clips.findIndex(x => x.id === id);
  if (i !== -1) { if (clips[i].url) URL.revokeObjectURL(clips[i].url); clips.splice(i, 1); }
  renderClips();
};

window.downloadClip = id => {
  const c = clips.find(x => x.id === id);
  if (!c?.url) { toast('Extract MP3 first', 'info'); return; }
  triggerDownload(c.url, `${prefix()}_${c.name}.mp3`);
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

prefixInput.addEventListener('input', () => renderClips());

// ─── MP3 Encoding via Web Audio API + lamejs ──────────────────────────────────
// A single shared AudioContext, reused across every decode. This matters on
// iOS Safari — especially when the app is installed as a home-screen PWA —
// where an AudioContext only inherits the "started by a user tap" permission
// if it's created synchronously inside the click handler, before any `await`.
// Creating a fresh context later (after an await) leaves it silently suspended,
// so decodeAudioData never resolves with real audio. We create/resume this one
// context right at the top of the Extract click handler, then reuse it.
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

async function decodeAudio() {
  if (decodedAudioBuffer) return decodedAudioBuffer;
  showOverlay('Decoding audio… (this may take a moment for large files)');
  setStatus('Decoding audio…', 0.1);
  const arrayBuffer = await mainFile.arrayBuffer();
  const audioCtx = getAudioCtx();
  decodedAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  return decodedAudioBuffer;
}

// Resolves the AudioBuffer to encode a clip from — the shared main-video
// buffer for mark-based clips, or the clip's own file for imported clips
// (decoded once and cached on the clip).
async function getBufferForClip(c) {
  if (c.file) {
    if (c._buf) return c._buf;
    showOverlay(`Decoding ${c.file.name}…`);
    const arrayBuffer = await c.file.arrayBuffer();
    const ctx = getAudioCtx();
    c._buf = await ctx.decodeAudioData(arrayBuffer);
    return c._buf;
  }
  return decodeAudio();
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
  if (!mainFile && !clips.some(c => c.file)) return;

  const toProcess = clips.filter(c => c.selected);
  if (toProcess.length === 0) { toast('No clips selected', 'info'); return; }

  btnProcess.disabled = true;
  btnDownloadAll.disabled = true;

  // Create/resume the AudioContext synchronously, right here at the top of the
  // click handler and before any `await` — see note above getAudioCtx(). This
  // is what makes Extract work on iOS home-screen PWAs.
  const audioCtx = getAudioCtx();
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (e) { console.error('AudioContext resume failed', e); }
  }

  try {
    for (let i = 0; i < toProcess.length; i++) {
      const c = toProcess[i];
      setStatus(`Encoding clip ${i + 1}/${toProcess.length}: ${prefix()}_${c.name}.mp3…`, i / toProcess.length);
      await yieldToUI();

      const audioBuffer = await getBufferForClip(c);
      hideOverlay();
      const start = c.file ? 0 : c.start;
      const end   = c.file ? audioBuffer.duration : c.end;

      const blob = encodeClipToMp3(audioBuffer, start, end, p => {
        const overall = (i + p) / toProcess.length;
        setStatus(`Encoding clip ${i + 1}/${toProcess.length}: ${Math.round(p * 100)}%…`, overall);
      });

      if (c.url) URL.revokeObjectURL(c.url);
      c.blob = blob;
      c.url  = URL.createObjectURL(blob);
    }

    renderClips();
    switchTab('clips');
    setStatus(`✓ ${toProcess.length} clip${toProcess.length !== 1 ? 's' : ''} extracted`);
    toast(`Done! ${toProcess.length} MP3 file${toProcess.length !== 1 ? 's' : ''} ready`, 'success');
  } catch (err) {
    hideOverlay();
    const detail = (err && err.name ? `${err.name}: ` : '') + (err && err.message ? err.message : String(err));
    setStatus('Error: ' + detail);
    toast('Failed: ' + detail, 'error', 8000);
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
    triggerDownload(ready[0].url, `${prefix()}_${ready[0].name}.mp3`);
    return;
  }

  setStatus('Building ZIP…', 0);
  showOverlay('Building ZIP file…');
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    for (const c of ready) zip.file(`${prefix()}_${c.name}.mp3`, c.blob);

    const blob = await zip.generateAsync({ type: 'blob' }, meta => {
      setStatus(`Building ZIP… ${Math.round(meta.percent)}%`, meta.percent / 100);
    });

    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${prefix()}_clips.zip`);
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
