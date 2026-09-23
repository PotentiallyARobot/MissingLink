def save_video_ffmpeg(frames, fps, out_path):
    """Stream frames to ffmpeg and publish the MP4 only after a successful encode."""
    import os
    import subprocess
    import tempfile
    from pathlib import Path

    if not frames:
        raise ValueError("No frames returned; check the generation output before exporting.")
    if fps <= 0:
        raise ValueError("FPS must be positive.")
    width, height = frames[0].size
    if width % 2 or height % 2:
        raise ValueError("MP4 export requires even image dimensions.")
    destination = Path(out_path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(suffix=".mp4", dir=destination.parent)
    os.close(handle)
    process = None
    try:
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
                "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps),
                "-i", "pipe:0", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", temporary,
            ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
            try:
                for frame in frames:
                    if frame.size != (width, height):
                        raise ValueError("All video frames must have the same dimensions.")
                    process.stdin.write(frame.convert("RGB").tobytes())
                process.stdin.close()
                code = process.wait(timeout=120)
            except BrokenPipeError:
                code = process.wait(timeout=120)
                if code == 0:
                    raise RuntimeError("Encoder closed before all frames were written.") from None
            if code:
                errors.seek(0)
                detail = errors.read()[-2000:].decode("utf-8", "replace")
                raise RuntimeError("MP4 export failed; generated frames remain available. " + detail)
        os.replace(temporary, destination)
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
        Path(temporary).unlink(missing_ok=True)
