"use client";

// Provides the restored FrameShift ambient station as a compact persistent desktop control.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";

// Describes one royalty-free track restored from the original site archive.
interface AmbientTrack {
  name: string;
  src: string;
}

// Defines the complete restored station in its original running order.
const TRACKS: readonly AmbientTrack[] = [
  { name: "Moonlit Dreams", src: "/audio/moonlit-dreams.mp3" },
  { name: "Game Edit", src: "/audio/game-edit.mp3" },
  { name: "Electronic / Danix", src: "/audio/electronic-danix.mp3" },
  { name: "Electronic / Nastelbom", src: "/audio/electronic-nastelbom.mp3" },
  { name: "Soft Bee Pulse", src: "/audio/soft-bee-pulse.mp3" },
  { name: "Cyberpunk Authentic", src: "/audio/cyberpunk-authentic.mp3" },
  {
    name: "Bounce On It / Alex Grohl",
    src: "/audio/alexgrohl-no-copyright-music-bounce-on-it-184234.mp3",
  },
  {
    name: "Rap Beats / Diephoanghai",
    src: "/audio/diephoanghai-rap-beats-music-161432.mp3",
  },
  {
    name: "Hype Drill / Kontraa",
    src: "/audio/kontraa-hype-drill-music-438398.mp3",
  },
  { name: "Loksii", src: "/audio/loksii-no-copyright-music-211881.mp3" },
  {
    name: "Hard Rap Beat / Panda Beats",
    src: "/audio/panda-beats-royalty-free-element-hard-rap-beat-231463.mp3",
  },
  {
    name: "Revenge Guitar Rap / Watermelon Beats",
    src: "/audio/watermelon_beats-revenge-guitar-rap-beat-beats-music-2026-478872.mp3",
  },
] as const;

// Names the browser preferences owned by the desktop station.
const STORAGE_KEYS = {
  track: "frameshift-ambient-track",
  shuffle: "frameshift-ambient-shuffle",
  volume: "frameshift-ambient-volume",
} as const;

// Wraps an arbitrary track index into the valid station range.
function normalizeTrackIndex(index: number): number {
  return ((index % TRACKS.length) + TRACKS.length) % TRACKS.length;
}

// Picks a different random track while shuffle is enabled.
function pickRandomTrack(currentIndex: number): number {
  if (TRACKS.length < 2) {
    return 0;
  }
  let candidate = currentIndex;
  while (candidate === currentIndex) {
    candidate = Math.floor(Math.random() * TRACKS.length);
  }
  return candidate;
}

// Renders the explicit-start station and persists only non-playing preferences.
export function AmbientPlayer(): ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const historyRef = useRef<number[]>([0]);
  const historyPositionRef = useRef(0);
  const [trackIndex, setTrackIndex] = useState(0);
  const [shuffle, setShuffle] = useState(true);
  const [volume, setVolume] = useState(0.35);
  const [restored, setRestored] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restores stable preferences while deliberately leaving playback paused.
  useEffect(() => {
    try {
      const savedTrack = Number.parseInt(
        window.localStorage.getItem(STORAGE_KEYS.track) ?? "0",
        10,
      );
      const savedVolume = Number.parseFloat(
        window.localStorage.getItem(STORAGE_KEYS.volume) ?? "0.35",
      );
      const savedShuffle = window.localStorage.getItem(STORAGE_KEYS.shuffle);
      const safeTrack = Number.isFinite(savedTrack)
        ? normalizeTrackIndex(savedTrack)
        : 0;
      const safeVolume = Number.isFinite(savedVolume)
        ? Math.min(1, Math.max(0, savedVolume))
        : 0.35;
      setTrackIndex(safeTrack);
      setVolume(safeVolume);
      setShuffle(savedShuffle !== "0");
      historyRef.current = [safeTrack];
      historyPositionRef.current = 0;
    } catch {
      setTrackIndex(0);
      setVolume(0.35);
      setShuffle(true);
    } finally {
      setRestored(true);
    }
  }, []);

  // Keeps the live audio element synchronized with the volume control.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Persists the current track only after stored preferences have been restored.
  useEffect(() => {
    if (!restored) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.track, String(trackIndex));
    } catch {
      // Playback remains available when browser storage is restricted.
    }
  }, [restored, trackIndex]);

  // Persists shuffle state without treating it as playback consent.
  useEffect(() => {
    if (!restored) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.shuffle, shuffle ? "1" : "0");
    } catch {
      // Playback remains available when browser storage is restricted.
    }
  }, [restored, shuffle]);

  // Persists the chosen listening level without starting the station.
  useEffect(() => {
    if (!restored) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.volume, String(volume));
    } catch {
      // Playback remains available when browser storage is restricted.
    }
  }, [restored, volume]);

  // Loads one selected track and starts it only from a user or audio-ended event.
  const loadAndPlay = useCallback(async (nextIndex: number): Promise<void> => {
    const safeIndex = normalizeTrackIndex(nextIndex);
    const audio = audioRef.current;
    setTrackIndex(safeIndex);
    setError(null);
    if (!audio) {
      return;
    }
    audio.src = TRACKS[safeIndex].src;
    audio.load();
    try {
      await audio.play();
    } catch {
      setPlaying(false);
      setExpanded(true);
      setError("Playback was blocked. Press play to try this track again.");
    }
  }, []);

  // Records and plays the next sequential or shuffled track.
  const playNext = useCallback(async (): Promise<void> => {
    const nextIndex = shuffle
      ? pickRandomTrack(trackIndex)
      : normalizeTrackIndex(trackIndex + 1);
    const retainedHistory = historyRef.current.slice(0, historyPositionRef.current + 1);
    retainedHistory.push(nextIndex);
    historyRef.current = retainedHistory;
    historyPositionRef.current = retainedHistory.length - 1;
    await loadAndPlay(nextIndex);
  }, [loadAndPlay, shuffle, trackIndex]);

  // Walks backward through shuffle history or the sequential station order.
  const playPrevious = useCallback(async (): Promise<void> => {
    let previousIndex = normalizeTrackIndex(trackIndex - 1);
    if (shuffle && historyPositionRef.current > 0) {
      historyPositionRef.current -= 1;
      previousIndex = historyRef.current[historyPositionRef.current];
    }
    await loadAndPlay(previousIndex);
  }, [loadAndPlay, shuffle, trackIndex]);

  // Toggles playback without ever starting audio during application load.
  const togglePlayback = useCallback(async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setError(null);
    try {
      await audio.play();
    } catch {
      setPlaying(false);
      setExpanded(true);
      setError("Playback was blocked. Press play to try again.");
    }
  }, []);

  // Updates the current listening level from the labeled range control.
  const changeVolume = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setVolume(Number.parseFloat(event.target.value));
  }, []);

  const track = TRACKS[trackIndex];

  return (
    <section
      className={`desktop-station${expanded ? " is-expanded" : ""}${playing ? " is-playing" : ""}`}
      role="region"
      aria-label="Ambient station"
    >
      <audio
        ref={audioRef}
        src={track.src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => void playNext()}
        onError={() => {
          setPlaying(false);
          setExpanded(true);
          setError("This track could not be played. Skip to another track.");
        }}
      />

      <div className="desktop-station-topline">
        <span>Ambient station</span>
        <span className="desktop-station-state">
          <i aria-hidden="true" /> {playing ? "On air" : "Standby"}
        </span>
      </div>

      <div className="desktop-station-now">
        <button
          type="button"
          className="desktop-station-play"
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Pause ambient station" : "Play ambient station"}
        >
          <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
        </button>
        <button
          type="button"
          className="desktop-station-track"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls="desktop-station-details"
        >
          <span>Track {String(trackIndex + 1).padStart(2, "0")} / {TRACKS.length}</span>
          <strong>{track.name}</strong>
        </button>
        <button
          type="button"
          className="desktop-station-expand"
          onClick={() => setExpanded((current) => !current)}
          aria-label={expanded ? "Collapse ambient station" : "Expand ambient station"}
          aria-expanded={expanded}
          aria-controls="desktop-station-details"
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>

      <div id="desktop-station-details" className="desktop-station-details" hidden={!expanded}>
        <div className="desktop-station-wave" aria-hidden="true" />
        <div className="desktop-station-transport" aria-label="Playback controls">
          <button type="button" onClick={() => void playPrevious()} aria-label="Previous track">‹</button>
          <button type="button" onClick={() => void playNext()} aria-label="Next track">›</button>
          <button
            type="button"
            className="desktop-station-shuffle"
            onClick={() => setShuffle((enabled) => !enabled)}
            aria-label="Shuffle tracks"
            aria-pressed={shuffle}
          >
            <span aria-hidden="true">⤨</span> {shuffle ? "On" : "Off"}
          </button>
        </div>
        <label className="desktop-station-volume">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={changeVolume}
            aria-label="Ambient station volume"
          />
          <output>{Math.round(volume * 100)}%</output>
        </label>
        {error ? <p className="desktop-station-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
