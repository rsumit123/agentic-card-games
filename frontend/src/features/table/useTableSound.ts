import { useEffect, useRef } from 'react';
import type { Street } from '../../domain/game';

/** Small synthesised cues, armed on the first tap.
 *
 *  Browsers will not let a page make a sound until somebody has interacted
 *  with it, and `navigator.vibrate` does not exist on iOS at all, so sound is
 *  the only cue that works everywhere. It stays off until the player turns it
 *  on, and the preference is remembered. */
const KEY = 'commontable.sound';

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}
export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

let context: AudioContext | null = null;
function tone(frequency: number, seconds: number, gain = 0.05, delay = 0) {
  if (!soundEnabled()) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context = context ?? new Ctor();
    if (context.state === 'suspended') void context.resume();
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, at);
    volume.gain.exponentialRampToValueAtTime(gain, at + 0.015);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + seconds + 0.02);
  } catch { /* audio is a nicety, never a failure */ }
}

function buzz(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not on iOS */ }
}

export function useTableSound({ myTurn, street, handComplete, won }: {
  myTurn: boolean; street: Street | null; handComplete: boolean; won: boolean;
}) {
  const wasMyTurn = useRef(myTurn);
  const lastStreet = useRef(street);
  const wasComplete = useRef(handComplete);

  useEffect(() => {
    if (myTurn && !wasMyTurn.current) { tone(660, 0.13); tone(880, 0.13, 0.045, 0.12); buzz(30); }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  useEffect(() => {
    if (street && street !== lastStreet.current && street !== 'complete' && street !== 'preflop') tone(440, 0.07, 0.03);
    lastStreet.current = street;
  }, [street]);

  useEffect(() => {
    if (handComplete && !wasComplete.current) {
      if (won) { tone(523, 0.12, 0.05); tone(659, 0.12, 0.05, 0.1); tone(784, 0.22, 0.05, 0.2); buzz([25, 60, 25]); }
      else tone(300, 0.16, 0.028);
    }
    wasComplete.current = handComplete;
  }, [handComplete, won]);
}
