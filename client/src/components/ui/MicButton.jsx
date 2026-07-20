import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

const MAX_RECORDING_MS = 120_000;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const pickSupportedMimeType = () => {
  for (const candidate of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(candidate)) {
      return candidate;
    }
  }
  return '';
};

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const formatElapsed = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Mic button: click to record, click again to stop. On stop, uploads the
 * recording for transcription and hands the resulting text to onTranscript.
 */
export default function MicButton({ onTranscript, className = '', disabled = false }) {
  const [status, setStatus] = useState('idle'); // idle | recording | transcribing
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const autoStopRef = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      clearTimeout(autoStopRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearInterval(timerRef.current);
    clearTimeout(autoStopRef.current);
  };

  const startRecording = async () => {
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      toast.error('Voice recording is not supported in this browser.');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('Microphone access denied.');
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];

      if (blob.size === 0) {
        setStatus('idle');
        setElapsedMs(0);
        return;
      }

      setStatus('transcribing');
      try {
        const audioBase64 = await blobToBase64(blob);
        const { data } = await api.post('/ai/transcribe', { audioBase64, mimeType });
        const text = data?.data?.text?.trim();
        if (text) {
          onTranscript(text);
        } else {
          toast.error('No speech detected — try again.');
        }
      } catch (error) {
        toast.error(error.response?.data?.message || 'Transcription failed.');
      } finally {
        setStatus('idle');
        setElapsedMs(0);
      }
    };

    recorder.start();
    startedAtRef.current = Date.now();
    setStatus('recording');
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    autoStopRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleClick = () => {
    if (status === 'idle') startRecording();
    else if (status === 'recording') stopRecording();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || status === 'transcribing'}
      title={
        status === 'recording'
          ? 'Stop recording'
          : status === 'transcribing'
          ? 'Transcribing…'
          : 'Dictate with your voice'
      }
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
        status === 'recording'
          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
          : 'bg-slate-800 text-slate-400 hover:text-indigo-300 hover:bg-slate-700'
      } ${className}`}
    >
      {status === 'transcribing' ? (
        <Loader2 size={13} className="animate-spin" />
      ) : status === 'recording' ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <Square size={11} fill="currentColor" />
        </>
      ) : (
        <Mic size={13} />
      )}
      {status === 'recording' && <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>}
      {status === 'transcribing' && <span>Transcribing…</span>}
    </button>
  );
}
