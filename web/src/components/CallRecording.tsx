import { useState } from "react";
import type { Call } from "../api/types";
import "./CallRecording.css";

export function RecordingPlayer({ call }: { call: Call }) {
  const url = call.recordingUrl || call.stereoRecordingUrl;

  if (!url) {
    return <div className="recording-unavailable">Recording not available</div>;
  }

  return (
    <div className="recording-player">
      <div className="recording-audio-col">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls src={url} className="recording-audio">
          Your browser does not support audio playback.
        </audio>
        {call.stereoRecordingUrl && call.recordingUrl && call.stereoRecordingUrl !== call.recordingUrl && (
          <a className="link-btn" href={call.stereoRecordingUrl} target="_blank" rel="noreferrer">
            Stereo version
          </a>
        )}
      </div>
      <div className="recording-transcript-col">
        <div className="recording-transcript-label">Transcript</div>
        {call.transcriptText ? (
          <div className="recording-transcript-text">{call.transcriptText}</div>
        ) : (
          <div className="recording-transcript-empty">No transcript available.</div>
        )}
      </div>
    </div>
  );
}

export function PlayRecordingToggle({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const hasRecording = Boolean(call.recordingUrl || call.stereoRecordingUrl);

  if (!hasRecording) {
    return <span className="recording-unavailable-inline">Recording not available</span>;
  }

  return (
    <div className="recording-toggle">
      <button className="link-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide recording" : "Play Recording"}
      </button>
      {open && <RecordingPlayer call={call} />}
    </div>
  );
}
