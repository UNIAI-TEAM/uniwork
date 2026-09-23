"use client";

import { create } from "zustand";

export type ChatVoicePlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

type ChatVoicePlaybackState = {
  /** The voice message that owns the player, if any. */
  activeId: string | null;
  status: ChatVoicePlaybackStatus;
  positionMs: number;
  /** From the media element once it knows; 0 until then (webm often never says). */
  durationMs: number;
};

const IDLE: ChatVoicePlaybackState = {
  activeId: null,
  status: "idle",
  positionMs: 0,
  durationMs: 0,
};

/**
 * One voice player for the whole chat. The audio element lives here, not in
 * a message row, so playback keeps going when the virtual list unmounts the
 * row that started it, and starting another message pauses the first.
 */
export const useChatVoicePlaybackStore = create<ChatVoicePlaybackState>()(() => IDLE);

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let loadToken = 0;

function set(partial: Partial<ChatVoicePlaybackState>) {
  useChatVoicePlaybackStore.setState(partial);
}

function releaseSource() {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = "auto";
  el.ontimeupdate = () => set({ positionMs: Math.round(el.currentTime * 1000) });
  el.onloadedmetadata = () => {
    if (Number.isFinite(el.duration)) set({ durationMs: Math.round(el.duration * 1000) });
  };
  el.onplay = () => set({ status: "playing" });
  el.onpause = () => {
    if (useChatVoicePlaybackStore.getState().status === "playing") set({ status: "paused" });
  };
  el.onended = () => set({ status: "paused", positionMs: 0 });
  el.onerror = () => {
    if (el.getAttribute("src")) set({ status: "error" });
  };
  audio = el;
  return el;
}

/**
 * Play or pause one voice message. A different message takes the player
 * over: the one playing stops, its blob URL is released.
 */
export async function toggleChatVoicePlayback(id: string, load: () => Promise<Blob>): Promise<void> {
  const state = useChatVoicePlaybackStore.getState();
  if (state.activeId === id && audio && objectUrl) {
    if (state.status === "playing") {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      set({ status: "error" });
    }
    return;
  }
  if (state.activeId === id && state.status === "loading") return;

  const token = ++loadToken;
  releaseSource();
  useChatVoicePlaybackStore.setState({ ...IDLE, activeId: id, status: "loading" });
  try {
    const blob = await load();
    if (token !== loadToken) return;
    const el = ensureAudio();
    objectUrl = URL.createObjectURL(blob);
    el.src = objectUrl;
    await el.play();
  } catch {
    if (token === loadToken) set({ status: "error" });
  }
}

/** Move the playhead of the active message. */
export function seekChatVoicePlayback(id: string, positionMs: number): void {
  const state = useChatVoicePlaybackStore.getState();
  if (state.activeId !== id || !audio) return;
  const clamped = Math.max(0, positionMs);
  audio.currentTime = clamped / 1000;
  set({ positionMs: Math.round(clamped) });
}

/** Stop and forget whatever is playing (leaving the room, signing out). */
export function stopChatVoicePlayback(): void {
  loadToken += 1;
  releaseSource();
  useChatVoicePlaybackStore.setState(IDLE);
}
