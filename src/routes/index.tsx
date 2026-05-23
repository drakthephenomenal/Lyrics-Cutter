import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HCJ Lyrics Cutter — Mark & Download MP3 Clips" },
      {
        name: "description",
        content:
          "Mark start/end on a video and download each clip as hcj_1.mp3, hcj_2.mp3 — fully in-browser, no upload.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Space+Mono:wght@400;700&display=swap",
      },
    ],
  }),
  component: App,
});

type Clip = { id: string; name: string; start: number; end: number; busy?: boolean };

const fmt = (s: number) => {
  if (!isFinite(s)) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(2).padStart(5, "0");
  return `${m}:${sec}`;
};

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoURL, setVideoURL] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [start, setStart] = useState<number | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const counter = useRef(1);

  // load file
  const onPick = (f: File | null | undefined) => {
    if (!f) return;
    if (videoURL) URL.revokeObjectURL(videoURL);
    setVideoURL(URL.createObjectURL(f));
    setFileName(f.name);
    setClips([]);
    setStart(null);
    counter.current = 1;
  };

  // keyboard shortcuts
  useEffect(() => {
    const v = videoRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (!v) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (e.key === "[") { setStart(v.currentTime); }
      else if (e.key === "]") {
        const s = start;
        const end = v.currentTime;
        if (s != null && end > s) {
          const id = crypto.randomUUID();
          setClips((c) => [...c, { id, name: String(counter.current++), start: s, end }]);
          setStart(null);
        }
      } else if (e.key === "ArrowLeft") { v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 5 : 1)); }
      else if (e.key === "ArrowRight") { v.currentTime = Math.min(v.duration, v.currentTime + (e.shiftKey ? 5 : 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  const markStart = () => { const v = videoRef.current; if (v) setStart(v.currentTime); };
  const markEnd = () => {
    const v = videoRef.current; if (!v || start == null) return;
    const end = v.currentTime;
    if (end <= start) return;
    setClips((c) => [...c, { id: crypto.randomUUID(), name: String(counter.current++), start, end }]);
    setStart(null);
  };

  const renameClip = (id: string, name: string) =>
    setClips((c) => c.map((x) => (x.id === id ? { ...x, name: name.replace(/[^\w-]/g, "") } : x)));
  const removeClip = (id: string) => setClips((c) => c.filter((x) => x.id !== id));
  const seek = (s: number) => { const v = videoRef.current; if (v) v.currentTime = s; };

  const downloadClip = async (clip: Clip) => {
    if (!videoURL) return;
    setClips((c) => c.map((x) => (x.id === clip.id ? { ...x, busy: true } : x)));
    try {
      const blob = await extractMp3(videoURL, clip.start, clip.end);
      const fname = `hcj_${clip.name || "clip"}.mp3`;
      triggerDownload(blob, fname);
    } catch (err) {
      console.error(err);
      alert("Couldn't export this clip: " + (err as Error).message);
    } finally {
      setClips((c) => c.map((x) => (x.id === clip.id ? { ...x, busy: false } : x)));
    }
  };

  return (
    <div className="relative z-10 mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <div
          className="mb-3 text-[11px] font-bold tracking-[0.3em] text-primary uppercase"
          style={{ fontFamily: "var(--font-display)" }}
        >
          HCJ · Lyrics Cutter
        </div>
        <h1
          className="text-4xl md:text-5xl font-extrabold leading-none tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Mark it. <span className="text-accent">Slice it.</span>
        </h1>
        <p className="mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground">
          Pick a video, scrub through, press <kbd className="rounded bg-muted px-1.5 py-0.5">[</kbd> for start
          and <kbd className="rounded bg-muted px-1.5 py-0.5">]</kbd> for end. Each clip appears below — rename
          the number and hit Download to get <span className="text-primary">hcj_N.mp3</span>. Everything runs in
          your browser; no upload.
        </p>
      </header>

      {!videoURL ? (
        <label className="block cursor-pointer rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center transition hover:border-primary hover:bg-card">
          <input
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <div
            className="text-lg font-bold text-primary"
            style={{ fontFamily: "var(--font-display)" }}
          >
            + Choose a video or audio file
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Big files welcome — streamed locally, never uploaded.
          </div>
        </label>
      ) : (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <video
              ref={videoRef}
              src={videoURL}
              controls
              className="w-full"
              onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
              onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
            <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{fileName}</span>
            <span className="font-mono text-xs text-primary">{fmt(t)} / {fmt(duration)}</span>
            <button
              onClick={markStart}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20"
              style={{ fontFamily: "var(--font-display)" }}
            >
              [ MARK START
            </button>
            <button
              onClick={markEnd}
              disabled={start == null}
              className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent disabled:opacity-40 hover:bg-accent/20"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ] MARK END
            </button>
            <button
              onClick={() => { onPick(null as any); setVideoURL(null); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              change file
            </button>
          </div>

          {start != null && (
            <div className="rounded-xl border border-primary/40 bg-primary/5 px-4 py-2 text-xs">
              <span className="text-muted-foreground">START set at </span>
              <span className="font-mono text-primary">{fmt(start)}</span>
              <span className="text-muted-foreground"> — play to the end and press </span>
              <kbd className="rounded bg-muted px-1 py-0.5">]</kbd>
            </div>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2
                className="text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Clips · {clips.length}
              </h2>
              {clips.length > 0 && (
                <button
                  onClick={() => { setClips([]); counter.current = 1; }}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  clear all
                </button>
              )}
            </div>

            {clips.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                No clips yet — mark a start and an end to add one.
              </div>
            ) : (
              <ul className="space-y-2">
                {clips.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
                  >
                    <div className="flex items-center rounded-lg border border-border bg-input overflow-hidden">
                      <span
                        className="px-2 py-1.5 text-xs font-bold text-primary select-none"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        hcj_
                      </span>
                      <input
                        value={c.name}
                        onChange={(e) => renameClip(c.id, e.target.value)}
                        placeholder="1"
                        className="w-20 bg-transparent px-1 py-1.5 text-xs outline-none"
                      />
                      <span className="px-2 py-1.5 text-xs text-muted-foreground select-none">.mp3</span>
                    </div>

                    <button
                      onClick={() => seek(c.start)}
                      className="font-mono text-[11px] text-muted-foreground hover:text-primary"
                      title="jump to start"
                    >
                      {fmt(c.start)} → {fmt(c.end)} <span className="text-primary">({(c.end - c.start).toFixed(2)}s)</span>
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => downloadClip(c)}
                        disabled={c.busy}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {c.busy ? "encoding…" : "↓ download"}
                      </button>
                      <button
                        onClick={() => removeClip(c.id)}
                        className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <footer className="mt-16 text-center text-[10px] tracking-widest text-muted-foreground uppercase">
        Local-only · No upload · MP3 192kbps
      </footer>
    </div>
  );
}

/* ---------- helpers ---------- */

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Real-time capture → MP3. Works on huge source files because nothing is fully decoded.
async function extractMp3(srcURL: string, startSec: number, endSec: number): Promise<Blob> {
  const url = "https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/+esm";
  const lameMod: any = await (new Function("u", "return import(u)")(url));
  const lamejs = lameMod.default ?? lameMod;

  const video = document.createElement("video");
  video.src = srcURL;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  (video as any).playsInline = true;

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("video load failed"));
  });

  video.currentTime = Math.max(0, startSec);
  await new Promise<void>((res) => { video.onseeked = () => res(); });

  const AC = (window.AudioContext || (window as any).webkitAudioContext);
  const ctx: AudioContext = new AC();
  const sampleRate = ctx.sampleRate;

  const stream = (video as any).captureStream
    ? (video as any).captureStream()
    : (video as any).mozCaptureStream();
  const audioTracks: MediaStreamTrack[] = stream.getAudioTracks();
  if (!audioTracks.length) {
    ctx.close();
    throw new Error("This file has no audio track.");
  }
  const src = ctx.createMediaStreamSource(new MediaStream(audioTracks));

  const bufSize = 4096;
  const sp = ctx.createScriptProcessor(bufSize, 2, 2);
  const encoder = new lamejs.Mp3Encoder(2, sampleRate, 192);
  const mp3Chunks: Uint8Array[] = [];

  const toInt16 = (f: Float32Array) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };

  let stopped = false;
  sp.onaudioprocess = (e) => {
    if (stopped) return;
    const L = e.inputBuffer.getChannelData(0);
    const R = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : L;
    const buf = encoder.encodeBuffer(toInt16(L), toInt16(R));
    if (buf.length) mp3Chunks.push(new Uint8Array(buf));
  };

  src.connect(sp);
  sp.connect(ctx.destination);
  // mute playback (we still process the captured stream)
  video.muted = true;
  video.volume = 0;

  await video.play();

  await new Promise<void>((res) => {
    const tick = () => {
      if (video.currentTime >= endSec || video.ended) return res();
      requestAnimationFrame(tick);
    };
    tick();
  });

  stopped = true;
  video.pause();
  try { src.disconnect(); sp.disconnect(); } catch {}
  await ctx.close();
  audioTracks.forEach((t) => t.stop());

  const tail = encoder.flush();
  if (tail.length) mp3Chunks.push(new Uint8Array(tail));

  return new Blob(mp3Chunks as BlobPart[], { type: "audio/mpeg" });
}
