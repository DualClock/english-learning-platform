'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_RECORDING_SECONDS = 15;

/**
 * Запись с микрофона через MediaRecorder.
 * Останавливается сама на 15 секундах: длинные записи не нужны ни для
 * проверки произношения, ни для голосового ввода, а лимит размера бережёт API.
 */
export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const finish = useCallback(
    (blob: Blob | null) => {
      const resolve = resolveRef.current;
      resolveRef.current = null;
      setIsRecording(false);
      cleanup();
      resolve?.(blob);
    },
    [cleanup]
  );

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Браузер не поддерживает запись с микрофона.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          : null;
        finish(blob);
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setSeconds(0);

      timerRef.current = window.setInterval(() => {
        setSeconds((value) => {
          const next = value + 1;
          if (next >= MAX_RECORDING_SECONDS && recorder.state === 'recording') {
            recorder.stop();
          }
          return next;
        });
      }, 1000);

      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Нет доступа к микрофону. Разрешите запись в настройках браузера.'
          : 'Не удалось включить микрофон. Проверьте, что он подключён.'
      );
      cleanup();
      return false;
    }
  }, [cleanup, finish]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') {
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      resolveRef.current = resolve;
      recorder.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    resolveRef.current = null;
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null;
      recorder.stop();
    }
    setIsRecording(false);
    setSeconds(0);
    cleanup();
  }, [cleanup]);

  useEffect(() => cancel, [cancel]);

  return {
    isRecording,
    seconds,
    error,
    start,
    stop,
    cancel,
    maxSeconds: MAX_RECORDING_SECONDS,
  };
}
