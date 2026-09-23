import ast
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import runtime_setup as setup
from update_notebooks import NAMES, ROOT
from video_export import save_video_ffmpeg


class SetupTests(unittest.TestCase):
    def test_valid_environment_key_is_preserved(self):
        with patch.dict(os.environ, {"MISSING_LINK_TOKEN": "test-secret"}), patch.object(setup, "getpass") as prompt:
            self.assertEqual(setup.ml_token(), "test-secret")
            prompt.assert_not_called()

    def test_failed_command_stops_and_redacts_key(self):
        result = types.SimpleNamespace(returncode=1, stdout="error https://test-secret@missinglink.build/wheel?t=test-secret")
        output = io.StringIO()
        with patch.dict(os.environ, {"MISSING_LINK_TOKEN": "test-secret"}), patch.object(setup.subprocess, "run", return_value=result), redirect_stdout(output):
            with self.assertRaises(RuntimeError):
                setup.ml_run(["pip", "install"])
        self.assertNotIn("test-secret", output.getvalue())

    def test_no_gpu_stops_before_install(self):
        with patch.object(setup.sys, "version_info", (3, 12)), patch.object(setup.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(RuntimeError, "GPU unavailable"):
                setup.ml_preflight()

    def test_existing_directory_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(setup, "ml_run") as command:
            with self.assertRaisesRegex(RuntimeError, "existing files were preserved"):
                setup.ml_clone("https://example.com/repo", folder)
            command.assert_not_called()
            (Path(folder) / ".git").mkdir()
            setup.ml_clone("https://example.com/repo", folder)
            command.assert_not_called()

    def test_wheel_installs_from_temporary_file_not_authenticated_url(self):
        def download(route, target):
            Path(target).write_bytes(b"test wheel")
        with patch.object(setup, "ml_download", side_effect=download), patch.object(setup, "ml_run") as command:
            setup.ml_install_wheel("test.whl")
            local = command.call_args.args[0][-1]
            self.assertNotIn("https:", local)
            self.assertFalse(Path(local).exists())


class NotebookTests(unittest.TestCase):
    def test_model_loading_and_generation_calls_preserved_from_git(self):
        git = r"C:\Users\tyler\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
        paths = [ROOT / prefix / name for prefix in (".", "notebooks") for name in NAMES]
        paths.append(ROOT / "Trellis.2-MissingLink-Colab-Optimized.ipynb")
        def calls(notebook):
            result = []
            for cell in notebook["cells"]:
                source = "".join(cell.get("source", []))
                if cell["cell_type"] != "code" or ("MISSING_LINK_TOKEN" in source and ("!pip" in source or "ml_preflight" in source)):
                    continue
                source = "\n".join("pass" if line.startswith("!") else line for line in source.splitlines())
                for node in ast.walk(ast.parse(source)):
                    if isinstance(node, ast.Call):
                        name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
                        if name in ("StableDiffusion", "from_pretrained", "generate_video", "generate_image", "pipe"):
                            result.append(ast.dump(node))
            return result
        for path in paths:
            relative = path.relative_to(ROOT).as_posix()
            old = subprocess.check_output([git, "-c", "safe.directory=" + ROOT.as_posix(), "show", "HEAD:" + relative], cwd=ROOT)
            with self.subTest(path=relative):
                self.assertEqual(calls(json.loads(old)), calls(json.loads(path.read_text(encoding="utf-8"))))

    def test_all_changed_cells_parse_and_have_no_saved_outputs_or_keys(self):
        paths = [ROOT / prefix / name for prefix in (".", "notebooks") for name in NAMES]
        paths.append(ROOT / "Trellis.2-MissingLink-Colab-Optimized.ipynb")
        for path in paths:
            with self.subTest(path=path.name):
                notebook = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(notebook["nbformat"], 4)
                self.assertEqual(sum(c.get("id") == "missinglink-setup-guide" for c in notebook["cells"]), 1)
                for cell in notebook["cells"]:
                    if cell["cell_type"] != "code":
                        continue
                    source = "".join(cell["source"])
                    # One legacy optional !ls cell is IPython syntax; all repaired cells are plain Python.
                    python = "\n".join("pass" if line.startswith("!") else line for line in source.splitlines())
                    ast.parse(python)
                    self.assertEqual(cell["outputs"], [])
                    self.assertIsNone(cell["execution_count"])
                    self.assertNotRegex(source, r"https://ml_[A-Za-z0-9_-]+@")
                    self.assertNotRegex(source, r"os.environ\[.MISSING_LINK_TOKEN.\]\s*=\s*[\"']\*+")

    def test_wan_source_upload_and_text_only_instructions(self):
        i2v = (ROOT / NAMES[1]).read_text(encoding="utf-8")
        t2v = (ROOT / NAMES[2]).read_text(encoding="utf-8")
        self.assertIn("files.upload()", i2v)
        self.assertNotIn("lavafloor.png", i2v)
        self.assertNotIn("Upload an image and change the prompt", t2v)
        self.assertNotIn('b\\\"\\\".join', t2v)


class ExportTests(unittest.TestCase):
    def test_encoding_streams_frames_and_preserves_existing_file_on_failure(self):
        from PIL import Image
        frames = [Image.new("RGB", (4, 4)) for _ in range(2)]
        class Encoder:
            def __init__(self, command, **kwargs):
                self.stdin = io.BytesIO()
                Path(command[-1]).write_bytes(b"new-video")
            def wait(self, **kwargs): return self.code
            def poll(self): return self.code
            def kill(self): pass
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "out.mp4"
            destination.write_bytes(b"old-video")
            Encoder.code = 1
            with patch.object(subprocess, "Popen", Encoder), self.assertRaisesRegex(RuntimeError, "export failed"):
                save_video_ffmpeg(frames, 16, destination)
            self.assertEqual(destination.read_bytes(), b"old-video")
            Encoder.code = 0
            with patch.object(subprocess, "Popen", Encoder):
                save_video_ffmpeg(frames, 16, destination)
            self.assertEqual(destination.read_bytes(), b"new-video")
            self.assertEqual(len(list(Path(folder).iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
