"use client";

import { useEffect, useRef, useState } from "react";

// Web Speech API (feature-detected; ADR-2). Only the parts used here are typed.
interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function SvgIcon({ d, size = 20 }: { readonly d: string; readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

const MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3";
const SEND = "M5 12h14M13 6l6 6l-6 6";
const STOP = "M7 7h10v10H7z";

/**
 * The composer (AGT-7): multiline input (Enter sends, Shift+Enter adds a line), suggestion chips
 * that fill it, voice input where the browser has it, and a stop button while a reply streams.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabled,
  placeholder,
  suggestions,
  compact = false,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly running: boolean;
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly suggestions: readonly string[];
  /** The side panel's smaller composer. */
  readonly compact?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setVoice(recognitionCtor() !== null);
    return () => {
      recognition.current?.stop();
    };
  }, []);

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = input.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${String(Math.min(el.scrollHeight, 160))}px`;
  }, [value]);

  function toggleVoice() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (Ctor === null) return;
    const r = new Ctor();
    r.lang = document.documentElement.lang || "en-GB";
    r.interimResults = false;
    r.continuous = false;
    const before = value;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said !== "") onChange(before.trim() === "" ? said : `${before.trimEnd()} ${said}`);
    };
    r.onend = () => {
      setListening(false);
    };
    r.onerror = () => {
      setListening(false);
    };
    recognition.current = r;
    setListening(true);
    r.start();
  }

  const button = compact ? "size-[42px]" : "size-11";
  return (
    <div className="flex flex-col gap-2.5">
      {suggestions.length > 0 && !running && (
        <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(s);
                input.current?.focus();
              }}
              className="min-h-11 rounded-full border-[1.5px] border-line-strong bg-card px-3 text-left text-sm font-bold text-ink hover:bg-flour disabled:opacity-60"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 rounded-[18px] border-2 border-agent bg-card py-1.5 pr-1.5 pl-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (running) onStop();
          else if (value.trim() !== "" && !disabled) onSend();
        }}
      >
        <label className="flex grow">
          <span className="sr-only">Message</span>
          <textarea
            ref={input}
            rows={1}
            value={value}
            maxLength={4000}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!running && value.trim() !== "" && !disabled) onSend();
              }
            }}
            className={`grow resize-none border-none bg-transparent py-2.5 font-body text-ink outline-none placeholder:text-ink-muted ${compact ? "text-[15px]" : "text-base"}`}
          />
        </label>
        {voice && !running && (
          <button
            type="button"
            aria-label={listening ? "Stop listening" : "Voice input"}
            aria-pressed={listening}
            disabled={disabled}
            onClick={toggleVoice}
            className={`flex ${button} shrink-0 items-center justify-center rounded-md ${listening ? "bg-tomato-tint text-tomato-text" : "bg-flour text-ink"}`}
          >
            <SvgIcon d={MIC} />
          </button>
        )}
        <button
          type="submit"
          aria-label={running ? "Stop" : "Send"}
          disabled={!running && (disabled || value.trim() === "")}
          className={`flex ${button} shrink-0 items-center justify-center rounded-md bg-agent text-on-agent hover:bg-agent-raised disabled:opacity-60`}
        >
          <SvgIcon d={running ? STOP : SEND} />
        </button>
      </form>
    </div>
  );
}
